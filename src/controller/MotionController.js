import { CameraMotionTracker } from "./CameraMotionTracker.js";
import {
  alignMotionToGrip,
  blendVerticalMotion,
  gravityAlignedRoll,
  normalizeViewMotion,
} from "../shared/view-motion.js";
import { createWristGestureDetector } from "../shared/wrist-gesture.js";

const GRAVITY = 9.81;
const ANGULAR_FREEZE_THRESHOLD = 12;
const REORIENTATION_GRACE_MS = 350;

function defaultEventTarget() {
  return typeof window !== "undefined" ? window : globalThis;
}

function zeroViewMotion() {
  return { x: 0, y: 0, confidence: 0 };
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function wrappedAngleDelta(previous, current) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  const rawDelta = current - previous;
  if (!Number.isFinite(rawDelta)) return 0;

  let delta = rawDelta % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  if (delta === -180 && rawDelta > 0) return 180;
  return Object.is(delta, -0) ? 0 : delta;
}

export function chooseTwistRate(rotationRate, derivedGammaRate) {
  if (Number.isFinite(rotationRate?.gamma)) return rotationRate.gamma;
  if (Number.isFinite(derivedGammaRate)) return derivedGammaRate;
  return 0;
}

export function totalRotationSpeed(rotationRate, derivedGammaRate) {
  const speed = Math.hypot(
    finiteOrZero(rotationRate?.alpha),
    finiteOrZero(rotationRate?.beta),
    chooseTwistRate(rotationRate, derivedGammaRate),
  );
  return Number.isFinite(speed) ? speed : Number.MAX_VALUE;
}

export function normalizeRoll(currentGamma, baselineGamma) {
  return wrappedAngleDelta(baselineGamma, currentGamma);
}

export function mapCameraSample(raw, options = {}) {
  if (
    !raw
    || !Number.isFinite(raw.x)
    || !Number.isFinite(raw.y)
    || !Number.isFinite(raw.scaleVelocity)
    || !Number.isFinite(raw.confidence)
  ) {
    return zeroViewMotion();
  }

  const { gravity, currentGamma, baselineGamma } = options ?? {};
  const relativeRoll = normalizeRoll(currentGamma, baselineGamma);
  const gravityRoll = gravityAlignedRoll({ x: gravity?.x, y: gravity?.y }, relativeRoll);
  const aligned = alignMotionToGrip({ x: raw.x, y: raw.y }, gravityRoll);
  const screenUpWeight = Number.isFinite(gravity?.z)
    ? clamp(Math.abs(gravity.z) / GRAVITY, 0, 1)
    : 0;
  const y = blendVerticalMotion({
    imageY: aligned.y,
    scaleVelocity: raw.scaleVelocity,
    screenUpWeight,
  });

  return normalizeViewMotion({ x: aligned.x, y, confidence: raw.confidence });
}

export class MotionController {
  constructor({
    onSample,
    onState,
    onTwistCandidate,
    onInteract,
    cameraTracker,
    eventTarget,
    window: injectedWindow,
    motionEventType = "devicemotion",
    orientationEventType = "deviceorientation",
    now = () => Date.now(),
  } = {}) {
    this.onSample = onSample;
    this.onState = onState;
    this.onTwistCandidate = onTwistCandidate;
    this.onInteract = onInteract;
    this.eventTarget = eventTarget ?? injectedWindow ?? defaultEventTarget();
    this.motionEventType = motionEventType;
    this.orientationEventType = orientationEventType;
    this.now = typeof now === "function" ? now : () => Date.now();

    this.cameraTracker = cameraTracker ?? new CameraMotionTracker({
      onSample: (sample) => this.handleCameraSample(sample),
      onState: (state) => this.handleCameraState(state),
    });
    if (cameraTracker) {
      this.cameraTracker.onSample = (sample) => this.handleCameraSample(sample);
      this.cameraTracker.onState = (state) => this.handleCameraState(state);
    }

    this.motionGranted = false;
    this.permissionPromise = null;
    this.lifecycleGeneration = 0;
    this.cameraActive = false;
    this.listenersStarted = false;
    this.suspended = false;
    this.destroyed = false;
    this.frozen = false;
    this.reorienting = false;
    this.calibrated = false;
    this.resumeTimer = null;
    this.currentGamma = null;
    this.baselineGamma = null;
    this.previousGammaTimestamp = null;
    this.derivedGammaRate = 0;
    this.gravity = null;
    this.wristDetector = createWristGestureDetector({
      onCandidate: () => this.onTwistCandidate?.(),
      onInteract: () => this.onInteract?.(),
    });

    this.handleMotion = this.handleMotion.bind(this);
    this.handleOrientation = this.handleOrientation.bind(this);
    this.handleScreenOrientation = this.handleScreenOrientation.bind(this);
  }

  get supported() {
    return typeof this.eventTarget.DeviceMotionEvent !== "undefined";
  }

  getTimestamp(event) {
    const timestamp = event?.timeStamp;
    if (Number.isFinite(timestamp)) return timestamp;
    const currentTime = this.now();
    return Number.isFinite(currentTime) ? currentTime : 0;
  }

  async requestStaticPermission(EventType) {
    if (!EventType) return "granted";
    const request = EventType.requestPermission;
    return typeof request === "function" ? request.call(EventType) : "granted";
  }

  requestPermission() {
    if (this.permissionPromise) return this.permissionPromise;
    const generation = this.lifecycleGeneration;
    const permission = this.requestPermissionInternal(generation);
    this.permissionPromise = permission;
    permission.then(
      () => {
        if (this.permissionPromise === permission) this.permissionPromise = null;
      },
      () => {
        if (this.permissionPromise === permission) this.permissionPromise = null;
      },
    );
    return permission;
  }

  async requestPermissionInternal(permissionGeneration) {
    if (this.destroyed) return { motionGranted: false, cameraGranted: false };

    const location = this.eventTarget.location ?? globalThis.location;
    if (!this.eventTarget.isSecureContext && location?.hostname !== "localhost") {
      this.onState?.("insecure");
      return { motionGranted: false, cameraGranted: false };
    }
    if (!this.supported) {
      this.onState?.("unsupported");
      return { motionGranted: false, cameraGranted: false };
    }

    if (!this.motionGranted) {
      try {
        const [motionPermission, orientationPermission] = await Promise.all([
          this.requestStaticPermission(this.eventTarget.DeviceMotionEvent),
          this.requestStaticPermission(this.eventTarget.DeviceOrientationEvent),
        ]);
        if (motionPermission !== "granted" || orientationPermission !== "granted") {
          throw new Error("Sensor permission denied");
        }
        this.motionGranted = true;
      } catch {
        this.onState?.("denied");
        return { motionGranted: false, cameraGranted: false };
      }
    }

    if (this.destroyed || this.lifecycleGeneration !== permissionGeneration) {
      return { motionGranted: true, cameraGranted: false };
    }
    this.suspended = false;
    this.start();
    const cameraGranted = await this.startCamera();
    if (this.destroyed || this.suspended || this.lifecycleGeneration !== permissionGeneration) {
      return { motionGranted: true, cameraGranted: false };
    }
    return { motionGranted: true, cameraGranted };
  }

  async startCamera(startGeneration = this.lifecycleGeneration) {
    if (this.destroyed || this.suspended || this.lifecycleGeneration !== startGeneration) return false;
    if (this.cameraActive) return true;
    try {
      const started = Boolean(await this.cameraTracker.start());
      if (this.destroyed || this.suspended || this.lifecycleGeneration !== startGeneration) {
        this.cameraActive = false;
        return false;
      }
      this.cameraActive = started;
      return started;
    } catch {
      this.onState?.("camera-unavailable");
      return false;
    }
  }

  start() {
    if (this.destroyed || this.listenersStarted) return;
    this.listenersStarted = true;
    this.eventTarget.addEventListener(this.orientationEventType, this.handleOrientation, true);
    this.eventTarget.addEventListener(this.motionEventType, this.handleMotion, true);
    this.eventTarget.screen?.orientation?.addEventListener("change", this.handleScreenOrientation);
    this.eventTarget.addEventListener("orientationchange", this.handleScreenOrientation);
    this.onState?.("waiting");
  }

  handleOrientation(event) {
    if (this.destroyed || this.suspended) return;
    const gamma = event?.gamma;
    if (!Number.isFinite(gamma)) return;

    const timestamp = this.getTimestamp(event);
    if (this.currentGamma !== null && this.previousGammaTimestamp !== null) {
      const deltaMs = timestamp - this.previousGammaTimestamp;
      this.derivedGammaRate = deltaMs > 0 && Number.isFinite(deltaMs)
        ? wrappedAngleDelta(this.currentGamma, gamma) * 1000 / deltaMs
        : 0;
      if (!Number.isFinite(this.derivedGammaRate)) this.derivedGammaRate = 0;
    } else {
      this.derivedGammaRate = 0;
    }
    this.currentGamma = gamma;
    this.previousGammaTimestamp = timestamp;
  }

  handleMotion(event) {
    if (this.destroyed || this.suspended) return;

    this.gravity = event?.accelerationIncludingGravity ?? null;
    const derivedGammaRate = this.derivedGammaRate;
    this.derivedGammaRate = 0;
    const twistRate = chooseTwistRate(event?.rotationRate, derivedGammaRate);
    const result = this.wristDetector.update({
      timeMs: this.getTimestamp(event),
      twistRate,
    });
    const rotating = Boolean(result?.rotating)
      || totalRotationSpeed(event?.rotationRate, derivedGammaRate) >= ANGULAR_FREEZE_THRESHOLD;
    this.setCameraFrozen(rotating);
  }

  setCameraFrozen(frozen) {
    const nextFrozen = Boolean(frozen);
    if (nextFrozen === this.frozen) return;
    this.frozen = nextFrozen;
    this.cameraTracker.setFrozen?.(nextFrozen);
  }

  handleCameraSample(raw) {
    if (this.destroyed || this.suspended || this.reorienting || this.frozen || !this.calibrated) {
      this.emitZero();
      return;
    }
    this.onSample?.(mapCameraSample(raw, {
      gravity: this.gravity,
      currentGamma: this.currentGamma,
      baselineGamma: this.baselineGamma,
    }));
  }

  handleCameraState(state) {
    if (state === "camera-active" && !this.destroyed && !this.suspended) this.cameraActive = true;
    if (["camera-denied", "camera-unavailable"].includes(state)) this.cameraActive = false;
    if (!this.destroyed) this.onState?.(state);
  }

  emitZero() {
    this.onSample?.(zeroViewMotion());
  }

  reset() {
    if (this.destroyed) return;
    this.baselineGamma = this.currentGamma;
    this.derivedGammaRate = 0;
    this.previousGammaTimestamp = null;
    this.gravity = null;
    this.wristDetector.reset();
    this.cameraTracker.reset?.();
    this.calibrated = true;
    this.emitZero();
  }

  suspend() {
    if (this.destroyed) return;
    this.lifecycleGeneration += 1;
    this.suspended = true;
    this.reorienting = false;
    this.clearResumeTimer();
    this.derivedGammaRate = 0;
    this.previousGammaTimestamp = null;
    this.gravity = null;
    this.wristDetector.reset();
    this.calibrated = false;
    this.frozen = false;
    this.cameraActive = false;
    this.cameraTracker.stop?.();
    this.emitZero();
  }

  async resume() {
    if (this.destroyed || !this.motionGranted) return false;
    this.suspended = false;
    this.calibrated = false;
    this.cameraTracker.setFrozen?.(false);
    this.frozen = false;
    return this.startCamera();
  }

  clearResumeTimer() {
    if (this.resumeTimer === null) return;
    this.eventTarget.clearTimeout?.(this.resumeTimer);
    this.resumeTimer = null;
  }

  handleScreenOrientation() {
    if (this.destroyed || this.suspended) return;
    this.reorienting = true;
    this.calibrated = false;
    this.cameraTracker.reset?.();
    this.setCameraFrozen(true);
    this.emitZero();
    this.onState?.("reorienting");
    this.clearResumeTimer();
    const setTimeoutFn = this.eventTarget.setTimeout?.bind(this.eventTarget) ?? setTimeout;
    this.resumeTimer = setTimeoutFn(() => {
      this.resumeTimer = null;
      if (this.destroyed || this.suspended) return;
      this.reorienting = false;
      this.baselineGamma = this.currentGamma;
      this.derivedGammaRate = 0;
      this.previousGammaTimestamp = null;
      this.gravity = null;
      this.wristDetector.reset();
      this.setCameraFrozen(false);
      this.onState?.("waiting");
    }, REORIENTATION_GRACE_MS);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lifecycleGeneration += 1;
    this.cameraActive = false;
    this.clearResumeTimer();
    if (this.listenersStarted) {
      this.eventTarget.removeEventListener(this.orientationEventType, this.handleOrientation, true);
      this.eventTarget.removeEventListener(this.motionEventType, this.handleMotion, true);
      this.eventTarget.screen?.orientation?.removeEventListener("change", this.handleScreenOrientation);
      this.eventTarget.removeEventListener("orientationchange", this.handleScreenOrientation);
      this.listenersStarted = false;
    }
    this.cameraTracker.destroy?.();
  }
}
