const DEG_PER_RAD = 180 / Math.PI;
const LONG_AXIS = { x: 0, y: 1, z: 0 };
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function normalizeQuaternion(value) {
  if (!value || ![value.x, value.y, value.z, value.w].every(Number.isFinite)) return null;
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (length <= Number.EPSILON) return null;
  return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
}

export function inverseQuaternion(value) {
  const normalized = normalizeQuaternion(value);
  return normalized ? { x: -normalized.x, y: -normalized.y, z: -normalized.z, w: normalized.w } : null;
}

export function multiplyQuaternions(left, right) {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  if (!a || !b) return null;
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function relativeQuaternion(baseline, current) {
  const inverse = inverseQuaternion(baseline);
  return inverse ? multiplyQuaternions(inverse, current) : null;
}

function rotateVector(quaternion, vector) {
  const q = normalizeQuaternion(quaternion);
  if (!q) return null;
  const point = { x: vector.x, y: vector.y, z: vector.z };
  const uv = {
    x: q.y * point.z - q.z * point.y,
    y: q.z * point.x - q.x * point.z,
    z: q.x * point.y - q.y * point.x,
  };
  const uuv = {
    x: q.y * uv.z - q.z * uv.y,
    y: q.z * uv.x - q.x * uv.z,
    z: q.x * uv.y - q.y * uv.x,
  };
  return {
    x: point.x + 2 * (q.w * uv.x + uuv.x),
    y: point.y + 2 * (q.w * uv.y + uuv.y),
    z: point.z + 2 * (q.w * uv.z + uuv.z),
  };
}

export function quaternionToAimVector(value) {
  const rotated = rotateVector(value, LONG_AXIS);
  if (!rotated) return null;
  const length = Math.hypot(rotated.x, rotated.y, rotated.z);
  return length > Number.EPSILON
    ? { x: rotated.x / length, y: rotated.y / length, z: rotated.z / length }
    : null;
}

function axisQuaternion(axis, degrees) {
  const halfAngle = degrees * Math.PI / 360;
  const sine = Math.sin(halfAngle);
  return normalizeQuaternion({
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
    w: Math.cos(halfAngle),
  });
}

export function deviceOrientationToQuaternion({ alpha, beta, gamma } = {}) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const alphaRotation = axisQuaternion({ x: 0, y: 0, z: 1 }, alpha);
  const betaRotation = axisQuaternion({ x: 1, y: 0, z: 0 }, beta);
  const gammaRotation = axisQuaternion({ x: 0, y: 1, z: 0 }, gamma);
  return multiplyQuaternions(multiplyQuaternions(alphaRotation, betaRotation), gammaRotation);
}

function vectorAngles(vector) {
  const horizontal = Math.hypot(vector.x, vector.y);
  return {
    yaw: Math.atan2(-vector.x, vector.y) * DEG_PER_RAD,
    pitch: Math.atan2(vector.z, horizontal) * DEG_PER_RAD,
  };
}

function angularDistanceDegrees(previous, current) {
  const a = normalizeQuaternion(previous);
  const b = normalizeQuaternion(current);
  if (!a || !b) return 0;
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(clamp(dot, -1, 1)) * DEG_PER_RAD;
}

function vectorDistanceDegrees(previous, current) {
  if (!previous || !current) return 0;
  const dot = clamp(previous.x * current.x + previous.y * current.y + previous.z * current.z, -1, 1);
  return Math.acos(dot) * DEG_PER_RAD;
}

function gripRollDegrees(previousQuaternion, currentQuaternion, previousAim, currentAim) {
  const total = angularDistanceDegrees(previousQuaternion, currentQuaternion);
  const swing = vectorDistanceDegrees(previousAim, currentAim);
  return Math.max(0, total - swing);
}

const noDelta = (valid = false) => ({
  yaw: 0,
  pitch: 0,
  physicalYaw: 0,
  physicalPitch: 0,
  transitionScale: 0,
  roll: 0,
  valid,
});

export function createOrientationTracker({
  deadZoneDeg = 0.8,
  neutralConeDeg = 2.5,
  maxPhysicalDeltaDeg = 25,
  maxPitchDeg = 90,
  gain = 4,
  smoothingStrength = 0,
} = {}) {
  let baselineAim = null;
  let previousAim = null;
  let previousQuaternion = null;
  let positiveYaw = 0;
  let negativeYaw = 0;
  let positivePitch = 0;
  let negativePitch = 0;

  const resetExcursion = () => {
    positiveYaw = 0;
    negativeYaw = 0;
    positivePitch = 0;
    negativePitch = 0;
  };

  const relativeAngles = (aim) => {
    const baseline = vectorAngles(baselineAim);
    const current = vectorAngles(aim);
    let yaw = current.yaw - baseline.yaw;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    return {
      yaw: clamp(yaw, -maxPhysicalDeltaDeg, maxPhysicalDeltaDeg),
      pitch: clamp(current.pitch - baseline.pitch, -maxPhysicalDeltaDeg, maxPhysicalDeltaDeg),
    };
  };

  const excursionDelta = (value, positive, negative) => {
    if (Math.abs(value) <= deadZoneDeg) return { delta: 0, positive, negative };
    if (value > positive) return { delta: value - positive, positive: value, negative };
    if (value < negative) return { delta: value - negative, positive, negative: value };
    return { delta: 0, positive, negative };
  };

  return {
    calibrate(sample) {
      const normalized = normalizeQuaternion(sample);
      const aim = quaternionToAimVector(normalized);
      if (!normalized || !aim) return false;
      baselineAim = aim;
      previousAim = aim;
      previousQuaternion = normalized;
      resetExcursion();
      return true;
    },

    update(sample) {
      const normalized = normalizeQuaternion(sample);
      const aim = quaternionToAimVector(normalized);
      if (!normalized || !aim || !baselineAim) return noDelta(false);

      const angles = relativeAngles(aim);
      const roll = gripRollDegrees(previousQuaternion, normalized, previousAim, aim);
      const rollDominates = roll >= 25 && roll >= vectorDistanceDegrees(previousAim, aim) * 2.5;
      const transitionScale = rollDominates
        ? angles.yaw * angles.yaw + angles.pitch * angles.pitch < 9
          ? 0
          : Math.hypot(angles.yaw, angles.pitch) < 6 ? 0.35 : 1
        : 1;

      if (Math.abs(angles.yaw) <= neutralConeDeg && Math.abs(angles.pitch) <= neutralConeDeg) {
        resetExcursion();
        previousAim = aim;
        previousQuaternion = normalized;
        return {
          yaw: 0,
          pitch: 0,
          physicalYaw: angles.yaw,
          physicalPitch: angles.pitch,
          transitionScale,
          roll,
          valid: true,
        };
      }

      const shouldRememberExcursion = transitionScale > 0;
      const yawResult = excursionDelta(angles.yaw, positiveYaw, negativeYaw);
      const pitchResult = excursionDelta(angles.pitch, positivePitch, negativePitch);
      if (shouldRememberExcursion) {
        positiveYaw = yawResult.positive;
        negativeYaw = yawResult.negative;
        positivePitch = pitchResult.positive;
        negativePitch = pitchResult.negative;
      }

      previousAim = aim;
      previousQuaternion = normalized;
      const smooth = clamp(Number.isFinite(smoothingStrength) ? smoothingStrength : 0, 0, 1);
      const smoothing = 1 - smooth * 0.35;
      return {
        yaw: yawResult.delta * transitionScale * gain * smoothing,
        pitch: clamp(pitchResult.delta * transitionScale * gain * smoothing, -maxPitchDeg, maxPitchDeg),
        physicalYaw: angles.yaw,
        physicalPitch: angles.pitch,
        transitionScale,
        roll,
        valid: true,
      };
    },

    get calibrated() {
      return baselineAim !== null;
    },
  };
}
