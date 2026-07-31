const DEG_PER_RAD = 180 / Math.PI;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function normalizeQuaternion(value) {
  if (!value || ![value.x, value.y, value.z, value.w].every(Number.isFinite)) return null;
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (length <= Number.EPSILON) return null;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

export function inverseQuaternion(value) {
  const normalized = normalizeQuaternion(value);
  if (!normalized) return null;
  return { x: -normalized.x, y: -normalized.y, z: -normalized.z, w: normalized.w };
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

export function quaternionToYawPitch(value) {
  const quaternion = normalizeQuaternion(value);
  if (!quaternion) return null;
  const { x, y, z, w } = quaternion;
  const pitch = Math.asin(clamp(2 * (w * x - z * y), -1, 1));
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  return { yaw: yaw * DEG_PER_RAD, pitch: pitch * DEG_PER_RAD };
}

export function applyDeadZone(value, deadZoneDeg) {
  return Math.abs(value) <= Math.max(0, deadZoneDeg) ? 0 : value;
}

export function clampPitch(value, maxPitchDeg) {
  const limit = Math.abs(maxPitchDeg);
  return clamp(value, -limit, limit);
}

export function adaptiveAlpha(angularSpeedDeg, smoothingStrength = 0.55) {
  const strength = clamp(smoothingStrength, 0, 1);
  if (strength === 0) return 1;
  const response = clamp(Math.abs(angularSpeedDeg) / 240, 0, 1);
  const easedResponse = response * response * (3 - 2 * response);
  const slowAlpha = 1 - 0.92 * strength;
  const fastAlpha = 1 - 0.28 * strength;
  return slowAlpha + (fastAlpha - slowAlpha) * easedResponse;
}

function angularDistanceDegrees(previous, current) {
  if (!previous || !current) return 0;
  const dot = Math.abs(
    previous.x * current.x + previous.y * current.y + previous.z * current.z + previous.w * current.w,
  );
  return 2 * Math.acos(clamp(dot, -1, 1)) * DEG_PER_RAD;
}

function lerpAngle(from, to, alpha) {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * alpha;
}

export function createOrientationTracker({ deadZoneDeg = 0.8, maxPitchDeg = 72, smoothingStrength = 0.55 } = {}) {
  let baseline = null;
  let previousSample = null;
  let yaw = 0;
  let pitch = 0;

  return {
    calibrate(sample) {
      const normalized = normalizeQuaternion(sample);
      if (!normalized) return false;
      baseline = normalized;
      previousSample = normalized;
      yaw = 0;
      pitch = 0;
      return true;
    },

    update(sample, deltaSeconds = 1 / 60) {
      const normalized = normalizeQuaternion(sample);
      if (!normalized || !baseline) return { yaw, pitch, angularSpeed: 0, valid: false };

      const relative = relativeQuaternion(baseline, normalized);
      const angles = quaternionToYawPitch(relative);
      if (!angles) return { yaw, pitch, angularSpeed: 0, valid: false };

      const duration = Math.max(1 / 240, Number.isFinite(deltaSeconds) ? deltaSeconds : 1 / 60);
      const angularSpeed = angularDistanceDegrees(previousSample, normalized) / duration;
      const alpha = adaptiveAlpha(angularSpeed, smoothingStrength);
      const targetYaw = applyDeadZone(angles.yaw, deadZoneDeg);
      const targetPitch = clampPitch(applyDeadZone(angles.pitch, deadZoneDeg), maxPitchDeg);

      yaw = lerpAngle(yaw, targetYaw, alpha);
      pitch += (targetPitch - pitch) * alpha;
      previousSample = normalized;
      return { yaw, pitch, angularSpeed, valid: true };
    },

    get calibrated() {
      return baseline !== null;
    },
  };
}
