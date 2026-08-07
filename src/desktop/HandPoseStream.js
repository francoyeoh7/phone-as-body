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

const WRIST_FIELDS = ["center", "relativeScale", "velocity", "depth", "palmSpan", "reachProgress"];
const FINGER_FIELDS = ["curls", "landmarks", "worldLandmarks"];

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
      fadeMs: 350,
      freezeMs: 250,
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
    if (frame.state === "tracked" && frame.trackingConfidence >= 0.62) this.acceptTracked(frame);
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
    const prior = this.pose;
    const interval = prior && Number.isFinite(this.previousAcceptedAt)
      ? Math.max(0, frame.receivedAt - this.previousAcceptedAt) : 0;
    const wristTimeConstant = adaptiveWristTimeConstant(frame, this.options.wristTimeConstantMs);
    let wristAlpha = prior ? smoothingAlpha(interval, wristTimeConstant) : 1;
    let fingerAlpha = prior ? smoothingAlpha(interval, this.options.fingerTimeConstantMs) : 1;
    if (this.lastStableAt !== null && frame.receivedAt - this.lastStableAt >= this.options.silenceMs) {
      wristAlpha = Math.min(wristAlpha, 0.25);
      fingerAlpha = Math.min(fingerAlpha, 0.25);
    }
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
    const opacity = this.visualOpacity(now);
    if (lost) return { state: "lost", pose: this.pose ? clone(this.pose) : null, gesturePose: this.gesturePose ? clone(this.gesturePose) : null, opacity, fresh: false, receivedAt: this.lastReceivedAt, ageMs, ...rawConfidence };
    if (this.lastFrame.state === "tracked" && this.lastFrame.trackingConfidence < 0.62) {
      return { state: "low-confidence", pose: this.pose ? clone(this.pose) : null, gesturePose: this.gesturePose ? clone(this.gesturePose) : null, opacity, fresh: false, receivedAt: this.lastReceivedAt, ageMs, ...rawConfidence };
    }
    return { state: "tracked", pose: this.pose ? clone(this.pose) : null, gesturePose: this.gesturePose ? clone(this.gesturePose) : null, opacity, fresh: true, receivedAt: this.lastReceivedAt, ageMs, ...rawConfidence };
  }

  visualOpacity(now) {
    if (this.lastStableAt === null || this.pose === null) return 0;
    const age = Math.max(0, now - this.lastStableAt);
    if (age <= this.options.freezeMs) return 1;
    return clamp(1 - (age - this.options.freezeMs) / this.options.fadeMs);
  }
}

export { basisQuaternion, canonicalize, slerp };
