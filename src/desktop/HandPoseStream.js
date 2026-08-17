const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
const lerp = (a, b, alpha) => a + (b - a) * alpha;
const lerpArray = (a, b, alpha) => (Array.isArray(a) && Array.isArray(b) && a.length === b.length
  ? a.map((value, index) => (Array.isArray(value) && Array.isArray(b[index])
    ? lerpArray(value, b[index], alpha) : lerp(value, b[index], alpha))) : b);
const clone = (value) => Array.isArray(value) ? value.map(clone)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const normalize = (v) => {
  const length = Math.hypot(...v);
  return length > 1e-9 ? v.map((x) => x / length) : v.map(() => 0);
};

function basisQuaternion(wrist = {}) {
  if (Array.isArray(wrist.wristQuaternion)) return canonicalize(wrist.wristQuaternion);
  const right = normalize(wrist.right ?? [1, 0, 0]);
  const up = normalize(wrist.up ?? [0, 1, 0]);
  const forward = normalize(wrist.forward ?? [0, 0, 1]);
  const m00 = right[0], m01 = up[0], m02 = forward[0];
  const m10 = right[1], m11 = up[1], m12 = forward[1];
  const m20 = right[2], m21 = up[2], m22 = forward[2];
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return canonicalize(q);
}

function canonicalize(q) {
  const n = normalize(q);
  const sign = n[3] < 0 || (n[3] === 0 && n.find((value) => value !== 0) < 0) ? -1 : 1;
  return n.map((value) => value * sign);
}

function slerp(a, b, alpha) {
  let dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  let target = b;
  if (dot < 0) { dot = -dot; target = b.map((value) => -value); }
  if (dot > 0.9995) return canonicalize(a.map((value, index) => lerp(value, target[index], alpha)));
  const theta = Math.acos(clamp(dot, -1, 1));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - alpha) * theta) / sinTheta;
  const wb = Math.sin(alpha * theta) / sinTheta;
  return canonicalize(a.map((value, index) => value * wa + target[index] * wb));
}

const WRIST_FIELDS = ["center", "visualWrist", "relativeScale", "velocity", "depth", "palmSpan", "reachProgress"];
const FINGER_FIELDS = ["curls", "landmarks", "worldLandmarks"];
const WRIST_CENTER_DEAD_ZONE = 0.006;
const WRIST_SCALE_DEAD_ZONE = 0.015;
const VISUAL_WRIST_DEAD_ZONE = 0.008;
const VISUAL_WRIST_ANGLE_DEAD_ZONE = 0.035;

function arrayDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

function quaternionAngle(a, b) {
  const dot = Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0));
  return 2 * Math.acos(clamp(dot, -1, 1));
}

function softVectorDeadZone(anchor, target, radius) {
  const distance = arrayDistance(anchor, target);
  if (!Number.isFinite(distance)) return clone(target);
  if (distance <= radius) return clone(anchor);
  const alpha = (distance - radius) / distance;
  return anchor.map((value, index) => lerp(value, target[index], alpha));
}

function softQuaternionDeadZone(anchor, target, radius) {
  const angle = quaternionAngle(anchor, target);
  if (!Number.isFinite(angle)) return clone(target);
  if (angle <= radius) return clone(anchor);
  return slerp(anchor, target, (angle - radius) / angle);
}

function wristFromQuaternion(value) {
  const [x, y, z, w] = canonicalize(value);
  return {
    right: [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    up: [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    forward: [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  };
}

function smoothingAlpha(interval, timeConstant) {
  if (!Number.isFinite(timeConstant) || timeConstant <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, interval) / timeConstant);
}

function adaptiveWristTimeConstant(frame, configured) {
  const baseline = clamp(configured, 42, 68);
  const velocity = Math.max(0, Number(frame?.velocity) || 0);
  const confidence = clamp(frame?.trackingConfidence);
  const motionBoost = clamp(velocity / 2) * 18;
  const confidencePenalty = clamp((0.9 - confidence) / 0.28) * 8;
  return clamp(baseline - motionBoost + confidencePenalty, 42, 68);
}

export class HandPoseStream {
  constructor(options = {}) {
    const wristTimeConstantMs = options.wristTimeConstantMs ?? options.smoothingMs ?? 60;
    this.options = {
      silenceMs: 350,
      fingerTimeConstantMs: 28,
      ...options,
      wristTimeConstantMs,
    };
    this.reset();
  }

  reset() {
    this.modeEpoch = null;
    this.lastSeq = -1;
    this.lastReceivedAt = null;
    this.previousAcceptedAt = null;
    this.lastStableAt = null;
    this.lastFrame = null;
    this.pose = null;
    this.gesturePose = null;
  }

  accept(frame) {
    if (!frame || !Number.isFinite(frame.receivedAt) || frame.receivedAt < 0
      || !Number.isInteger(frame.seq) || frame.seq < 0 || !Number.isInteger(frame.modeEpoch) || frame.modeEpoch < 0) return false;
    if (frame.state === "tracked" && frame.handedness !== "left") return false;
    if (this.modeEpoch !== null && frame.modeEpoch < this.modeEpoch) {
      return false;
    }
    if (this.modeEpoch !== null && frame.modeEpoch === this.modeEpoch && frame.seq <= this.lastSeq) {
      return false;
    }
    if (this.modeEpoch !== null && frame.modeEpoch > this.modeEpoch) this.resetEpoch(frame.modeEpoch);
    this.modeEpoch = frame.modeEpoch;
    this.lastSeq = frame.seq;
    this.lastReceivedAt = frame.receivedAt;
    this.lastFrame = clone(frame);
    if (frame.state === "tracked") this.acceptTracked(frame);
    this.previousAcceptedAt = frame.receivedAt;
    return true;
  }

  resetEpoch(epoch) {
    this.modeEpoch = epoch;
    this.lastSeq = -1;
    this.lastReceivedAt = null;
    this.previousAcceptedAt = null;
    this.lastStableAt = null;
    this.lastFrame = null;
    this.pose = null;
    this.gesturePose = null;
  }

  acceptTracked(frame) {
    const target = clone(frame);
    target.handedness = "left";
    target.wristQuaternion = Array.isArray(frame.wristQuaternion)
      ? canonicalize(frame.wristQuaternion) : basisQuaternion(frame.wrist);
    this.gesturePose = clone(target);
    target.visualWrist = clone(frame.visualWrist ?? frame.landmarks?.[0] ?? frame.center);
    const prior = this.pose;
    if (prior) {
      if (arrayDistance(prior.center, target.center) < WRIST_CENTER_DEAD_ZONE) {
        target.center = clone(prior.center);
      }
      if (Number.isFinite(prior.relativeScale) && Number.isFinite(target.relativeScale)
        && Math.abs(prior.relativeScale - target.relativeScale) < WRIST_SCALE_DEAD_ZONE) {
        target.relativeScale = prior.relativeScale;
      }
      const priorQuaternion = prior.wristQuaternion ?? basisQuaternion(prior.wrist);
      const priorVisualWrist = prior.visualWrist ?? prior.landmarks?.[0] ?? prior.center;
      target.visualWrist = softVectorDeadZone(priorVisualWrist, target.visualWrist, VISUAL_WRIST_DEAD_ZONE);
      target.wristQuaternion = softQuaternionDeadZone(
        priorQuaternion,
        target.wristQuaternion,
        VISUAL_WRIST_ANGLE_DEAD_ZONE,
      );
    }
    const interval = prior && Number.isFinite(this.previousAcceptedAt)
      ? Math.max(0, frame.receivedAt - this.previousAcceptedAt) : 0;
    const wristTimeConstant = adaptiveWristTimeConstant(frame, this.options.wristTimeConstantMs);
    let wristAlpha = prior ? smoothingAlpha(interval, wristTimeConstant) : 1;
    let fingerAlpha = prior ? smoothingAlpha(interval, this.options.fingerTimeConstantMs) : 1;
    if (!prior || (wristAlpha >= 1 && fingerAlpha >= 1)) this.pose = target;
    else {
      this.pose = { ...prior, ...target };
      for (const field of WRIST_FIELDS) {
        if (Array.isArray(target[field])) this.pose[field] = lerpArray(prior[field], target[field], wristAlpha);
        else if (Number.isFinite(target[field]) && Number.isFinite(prior[field])) this.pose[field] = lerp(prior[field], target[field], wristAlpha);
      }
      for (const field of FINGER_FIELDS) {
        if (Array.isArray(target[field])) this.pose[field] = lerpArray(prior[field], target[field], fingerAlpha);
      }
      this.pose.wristQuaternion = slerp(prior.wristQuaternion ?? basisQuaternion(prior.wrist), target.wristQuaternion, wristAlpha);
    }
    this.pose.wrist = wristFromQuaternion(this.pose.wristQuaternion);
    this.lastStableAt = frame.receivedAt;
  }

  sample(now) {
    if (!this.lastFrame) return null;
    const ageMs = Math.max(0, now - this.lastReceivedAt);
    const rawConfidence = {
      modeEpoch: this.lastFrame.modeEpoch,
      seq: this.lastFrame.seq,
      trackingConfidence: this.lastFrame.trackingConfidence,
      handConfidence: this.lastFrame.handConfidence,
    };
    if (this.lastFrame.state === "unavailable") return { state: "unavailable", pose: null, gesturePose: null, opacity: 0, fresh: false, receivedAt: this.lastReceivedAt, ageMs, ...rawConfidence };
    const silent = ageMs >= this.options.silenceMs;
    const lost = this.lastFrame.state === "lost" || silent;
    if (lost) return { state: "lost", pose: this.pose ? clone(this.pose) : null, gesturePose: this.gesturePose ? clone(this.gesturePose) : null, opacity: 0, fresh: false, receivedAt: this.lastReceivedAt, ageMs, ...rawConfidence };
    return { state: "tracked", pose: this.pose ? clone(this.pose) : null, gesturePose: this.gesturePose ? clone(this.gesturePose) : null, opacity: this.pose ? 1 : 0, fresh: true, receivedAt: this.lastReceivedAt, ageMs, ...rawConfidence };
  }

  visualOpacity(now) {
    if (this.lastStableAt === null || this.pose === null) return 0;
    const age = Math.max(0, now - this.lastStableAt);
    return age < this.options.silenceMs ? 1 : 0;
  }
}

export { basisQuaternion, canonicalize, slerp };
