import {
  createOrientationTracker,
  deviceOrientationToQuaternion,
} from "../shared/orientation.js";

const IMPACT_THRESHOLD = 13;
const IMPACT_RELEASE = 4;
const IMPACT_RELEASE_MS = 140;
const IMPACT_COOLDOWN_MS = 450;
const REORIENTATION_GRACE_MS = 350;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const zeroViewDelta = () => ({ yaw: 0, pitch: 0 });

function finiteVector(value) {
  return value && [value.x, value.y, value.z].every(Number.isFinite);
}

export function accelerationMagnitude(acceleration) {
  return finiteVector(acceleration) ? Math.hypot(acceleration.x, acceleration.y, acceleration.z) : 0;
}

export function highPassAcceleration(previous, current, alpha = 0.85) {
  if (!finiteVector(current)) return { x: 0, y: 0, z: 0 };
  if (!finiteVector(previous)) return { x: 0, y: 0, z: 0 };
  const smoothing = clamp(Number.isFinite(alpha) ? alpha : 0.85, 0, 1);
  return {
    x: current.x - previous.x * smoothing,
    y: current.y - previous.y * smoothing,
    z: current.z - previous.z * smoothing,
  };
}

export class MotionController {
  constructor({
    onSample,
    onState,
    onInteract,
    eventTarget,
    window: injectedWindow,
    motionEventType = "devicemotion",
    orientationEventType = "deviceorientation",
    now = () => Date.now(),
    tracker,
  } = {}) {
    this.onSample = onSample;
    this.onState = onState;
    this.onInteract = onInteract;
    this.eventTarget = eventTarget ?? injectedWindow ?? (typeof window !== "undefined" ? window : globalThis);
    this.motionEventType = motionEventType;
    this.orientationEventType = orientationEventType;
    this.now = typeof now === "function" ? now : () => Date.now();
    this.tracker = tracker ?? createOrientationTracker();
    this.motionGranted = false;
    this.permissionPromise = null;
    this.lifecycleGeneration = 0;
    this.listenersStarted = false;
    this.suspended = false;
    this.destroyed = false;
    this.reorienting = false;
    this.lastOrientation = null;
    this.previousGravity = null;
    this.impactStartedAt = null;
    this.lastImpactAt = -Infinity;
    this.resumeTimer = null;

    this.handleMotion = this.handleMotion.bind(this);
    this.handleOrientation = this.handleOrientation.bind(this);
    this.handleScreenOrientation = this.handleScreenOrientation.bind(this);
  }

  get supported() {
    return typeof this.eventTarget.DeviceMotionEvent !== "undefined"
      && typeof this.eventTarget.DeviceOrientationEvent !== "undefined";
  }

  requestStaticPermission(EventType) {
    const request = EventType?.requestPermission;
    return typeof request === "function" ? request.call(EventType) : Promise.resolve("granted");
  }

  requestPermission() {
    if (this.permissionPromise) return this.permissionPromise;
    const generation = this.lifecycleGeneration;
    const permission = this.requestPermissionInternal(generation);
    this.permissionPromise = permission;
    permission.finally(() => {
      if (this.permissionPromise === permission) this.permissionPromise = null;
    });
    return permission;
  }

  async requestPermissionInternal(permissionGeneration) {
    if (this.destroyed) return { motionGranted: false };
    const location = this.eventTarget.location ?? globalThis.location;
    if (!this.eventTarget.isSecureContext && location?.hostname !== "localhost") {
      this.onState?.("insecure");
      return { motionGranted: false };
    }
    if (!this.supported) {
      this.onState?.("unsupported");
      return { motionGranted: false };
    }
    if (!this.motionGranted) {
      try {
        const [motionPermission, orientationPermission] = await Promise.all([
          this.requestStaticPermission(this.eventTarget.DeviceMotionEvent),
          this.requestStaticPermission(this.eventTarget.DeviceOrientationEvent),
        ]);
        if (motionPermission !== "granted" || orientationPermission !== "granted") throw new Error("denied");
        this.motionGranted = true;
      } catch {
        this.onState?.("denied");
        return { motionGranted: false };
      }
    }
    if (this.destroyed || this.lifecycleGeneration !== permissionGeneration) return { motionGranted: true };
    this.suspended = false;
    this.start();
    return { motionGranted: true };
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

  getTimestamp(event) {
    if (Number.isFinite(event?.timeStamp)) return event.timeStamp;
    const timestamp = this.now();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  orientationQuaternion(event) {
    if (event?.quaternion) return event.quaternion;
    return deviceOrientationToQuaternion({
      alpha: event?.alpha,
      beta: event?.beta,
      gamma: event?.gamma,
      screenAngle: this.eventTarget.screen?.orientation?.angle ?? 0,
    });
  }

  handleOrientation(event) {
    if (this.destroyed || this.suspended || this.reorienting) return;
    const quaternion = this.orientationQuaternion(event);
    if (quaternion) {
      this.lastOrientation = quaternion;
      if (this.tracker.calibrated) this.onSample?.(this.tracker.update(quaternion));
    }
  }

  handleMotion(event) {
    if (this.destroyed || this.suspended || this.reorienting) return;
    const timestamp = this.getTimestamp(event);
    const acceleration = event?.acceleration;
    const gravity = event?.accelerationIncludingGravity;
    const impulse = finiteVector(acceleration)
      ? acceleration
      : highPassAcceleration(this.previousGravity, gravity);
    this.previousGravity = finiteVector(gravity) ? gravity : this.previousGravity;
    const magnitude = accelerationMagnitude(impulse);
    if (magnitude >= IMPACT_THRESHOLD && timestamp - this.lastImpactAt >= IMPACT_COOLDOWN_MS) {
      this.impactStartedAt = timestamp;
    }
    if (
      this.impactStartedAt !== null
      && magnitude <= IMPACT_RELEASE
      && timestamp - this.impactStartedAt <= IMPACT_RELEASE_MS
    ) {
      this.lastImpactAt = timestamp;
      this.impactStartedAt = null;
      this.onInteract?.();
    } else if (this.impactStartedAt !== null && timestamp - this.impactStartedAt > IMPACT_RELEASE_MS) {
      this.impactStartedAt = null;
    }
  }

  reset() {
    if (this.destroyed) return false;
    const quaternion = this.lastOrientation;
    this.previousGravity = null;
    this.impactStartedAt = null;
    if (!quaternion || !this.tracker.calibrate(quaternion)) return false;
    this.onSample?.(zeroViewDelta());
    return true;
  }

  suspend() {
    if (this.destroyed) return;
    this.lifecycleGeneration += 1;
    this.suspended = true;
    this.reorienting = false;
    this.clearResumeTimer();
    this.tracker = createOrientationTracker();
    this.previousGravity = null;
    this.impactStartedAt = null;
    this.onSample?.(zeroViewDelta());
  }

  resumeSensors() {
    if (this.destroyed || !this.motionGranted) return false;
    this.suspended = false;
    return true;
  }

  async resume() {
    return this.resumeSensors();
  }

  clearResumeTimer() {
    if (this.resumeTimer === null) return;
    (this.eventTarget.clearTimeout ?? clearTimeout)(this.resumeTimer);
    this.resumeTimer = null;
  }

  handleScreenOrientation() {
    if (this.destroyed || this.suspended) return;
    this.reorienting = true;
    this.tracker = createOrientationTracker();
    this.onSample?.(zeroViewDelta());
    this.onState?.("reorienting");
    this.clearResumeTimer();
    const timer = this.eventTarget.setTimeout?.bind(this.eventTarget) ?? setTimeout;
    this.resumeTimer = timer(() => {
      this.resumeTimer = null;
      if (this.destroyed || this.suspended) return;
      this.reorienting = false;
      this.onState?.("waiting");
    }, REORIENTATION_GRACE_MS);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lifecycleGeneration += 1;
    this.clearResumeTimer();
    if (this.listenersStarted) {
      this.eventTarget.removeEventListener(this.orientationEventType, this.handleOrientation, true);
      this.eventTarget.removeEventListener(this.motionEventType, this.handleMotion, true);
      this.eventTarget.screen?.orientation?.removeEventListener("change", this.handleScreenOrientation);
      this.eventTarget.removeEventListener("orientationchange", this.handleScreenOrientation);
      this.listenersStarted = false;
    }
  }
}
