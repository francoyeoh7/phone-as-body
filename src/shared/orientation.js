const DEG_PER_RAD = 180 / Math.PI;
const LONG_AXIS = { x: 0, y: 1, z: 0 };
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const DEFAULT_RAPID_LIMIT_DEG = 120;
const DEFAULT_RAPID_START_SPEED = 90;
const DEFAULT_RAPID_FULL_SPEED = 300;
const DEFAULT_RAPID_GAIN_MULTIPLIER = 1.6;
const DEFAULT_RAPID_MAX_CAMERA_DELTA_DEG = 180;

const smoothstep = (value) => value * value * (3 - 2 * value);

/**
 * Converts a measured angular velocity into a bounded rapid-turn response.
 * The base excursion remains unchanged until the start threshold is crossed.
 */
export function adaptiveTurnProfile(
  speedDegPerSecond,
  {
    baseLimitDeg = 25,
    rapidLimitDeg = DEFAULT_RAPID_LIMIT_DEG,
    startSpeedDegPerSecond = DEFAULT_RAPID_START_SPEED,
    fullSpeedDegPerSecond = DEFAULT_RAPID_FULL_SPEED,
    maxGainMultiplier = DEFAULT_RAPID_GAIN_MULTIPLIER,
    maxCameraDeltaDeg = DEFAULT_RAPID_MAX_CAMERA_DELTA_DEG,
    baseGain = 3,
  } = {},
) {
  const speed = Number.isFinite(speedDegPerSecond) ? Math.max(0, speedDegPerSecond) : 0;
  const base = Number.isFinite(baseLimitDeg) ? Math.max(0, baseLimitDeg) : 25;
  const rapid = Number.isFinite(rapidLimitDeg) ? Math.max(base, rapidLimitDeg) : DEFAULT_RAPID_LIMIT_DEG;
  const start = Number.isFinite(startSpeedDegPerSecond) ? Math.max(0, startSpeedDegPerSecond) : DEFAULT_RAPID_START_SPEED;
  const full = Number.isFinite(fullSpeedDegPerSecond) ? Math.max(start + 1, fullSpeedDegPerSecond) : DEFAULT_RAPID_FULL_SPEED;
  const gain = Number.isFinite(maxGainMultiplier)
    ? Math.max(1, maxGainMultiplier)
    : DEFAULT_RAPID_GAIN_MULTIPLIER;
  const cameraLimit = Number.isFinite(maxCameraDeltaDeg)
    ? Math.max(base * (Number.isFinite(baseGain) ? Math.abs(baseGain) : 1), maxCameraDeltaDeg)
    : DEFAULT_RAPID_MAX_CAMERA_DELTA_DEG;
  const baseCameraLimit = base * (Number.isFinite(baseGain) ? Math.abs(baseGain) : 1);
  const normalized = clamp((speed - start) / (full - start), 0, 1);
  const progress = smoothstep(normalized);
  return {
    progress,
    gainMultiplier: 1 + (gain - 1) * progress,
    physicalLimitDeg: base + (rapid - base) * progress,
    maxCameraDeltaDeg: baseCameraLimit + (cameraLimit - baseCameraLimit) * progress,
  };
}

function wrapDegrees(value) {
  let wrapped = value;
  while (wrapped > 180) wrapped -= 360;
  while (wrapped < -180) wrapped += 360;
  return wrapped;
}

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
  maxPhysicalDeltaDeg = 25,
  maxPitchDeg = 90,
  gain = 3,
  smoothingStrength = 0,
  rapidMaxPhysicalDeltaDeg = DEFAULT_RAPID_LIMIT_DEG,
  rapidTurnStartSpeedDegPerSecond = DEFAULT_RAPID_START_SPEED,
  rapidTurnFullSpeedDegPerSecond = DEFAULT_RAPID_FULL_SPEED,
  rapidGainMultiplier = DEFAULT_RAPID_GAIN_MULTIPLIER,
  rapidMaxCameraDeltaDeg = DEFAULT_RAPID_MAX_CAMERA_DELTA_DEG,
  rapidRampMs = 60,
  rapidReleaseMs = 180,
  maxOutputStepDeg = 45,
} = {}) {
  let baselineAim = null;
  let previousAim = null;
  let previousQuaternion = null;
  let previousTargetYaw = 0;
  let previousTargetPitch = 0;
  let previousRawYaw = 0;
  let previousRawPitch = 0;
  let previousTimestamp = null;
  let lastIntervalMs = null;
  let yawVelocity = 0;
  let pitchVelocity = 0;
  let rapidActivation = 0;
  let rapidProgress = 0;
  let previousStepYaw = 0;
  let previousStepPitch = 0;
  let hasPreviousStep = false;

  const relativeAngles = (aim) => {
    const baseline = vectorAngles(baselineAim);
    const current = vectorAngles(aim);
    const yaw = wrapDegrees(current.yaw - baseline.yaw);
    return {
      yaw,
      pitch: current.pitch - baseline.pitch,
    };
  };

  const profileForProgress = (progress) => {
    const normalized = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
    const baseLimit = Number.isFinite(maxPhysicalDeltaDeg) ? Math.max(0, maxPhysicalDeltaDeg) : 25;
    const rapidLimit = Number.isFinite(rapidMaxPhysicalDeltaDeg)
      ? Math.max(baseLimit, rapidMaxPhysicalDeltaDeg)
      : DEFAULT_RAPID_LIMIT_DEG;
    const baseCameraLimit = baseLimit * (Number.isFinite(gain) ? Math.abs(gain) : 1);
    const rapidCameraLimit = Number.isFinite(rapidMaxCameraDeltaDeg)
      ? Math.max(baseCameraLimit, rapidMaxCameraDeltaDeg)
      : DEFAULT_RAPID_MAX_CAMERA_DELTA_DEG;
    const multiplier = Number.isFinite(rapidGainMultiplier)
      ? Math.max(1, rapidGainMultiplier)
      : DEFAULT_RAPID_GAIN_MULTIPLIER;
    return {
      progress: normalized,
      gainMultiplier: 1 + (multiplier - 1) * normalized,
      physicalLimitDeg: baseLimit + (rapidLimit - baseLimit) * normalized,
      maxCameraDeltaDeg: baseCameraLimit + (rapidCameraLimit - baseCameraLimit) * normalized,
    };
  };

  const updateRapidProfile = (angles, timestamp) => {
    const hasTimestamp = Number.isFinite(timestamp)
      && Number.isFinite(previousTimestamp)
      && timestamp > previousTimestamp;
    if (!hasTimestamp) {
      if (Number.isFinite(timestamp)) previousTimestamp = timestamp;
      lastIntervalMs = null;
      previousRawYaw = angles.yaw;
      previousRawPitch = angles.pitch;
      return profileForProgress(0);
    }

    const intervalMs = clamp(timestamp - previousTimestamp, 8, 250);
    lastIntervalMs = intervalMs;
    const intervalSeconds = intervalMs / 1000;
    const yawStep = wrapDegrees(angles.yaw - previousRawYaw);
    const pitchStep = angles.pitch - previousRawPitch;
    const smoothing = 1 - Math.exp(-intervalMs / 60);
    yawVelocity += (yawStep / intervalSeconds - yawVelocity) * smoothing;
    pitchVelocity += (pitchStep / intervalSeconds - pitchVelocity) * smoothing;
    const speed = Math.hypot(yawVelocity, pitchVelocity);
    const startSpeed = Number.isFinite(rapidTurnStartSpeedDegPerSecond)
      ? Math.max(0, rapidTurnStartSpeedDegPerSecond)
      : DEFAULT_RAPID_START_SPEED;
    // A still sample cannot keep ramping a rapid-turn envelope. Signed velocity
    // smoothing makes alternating tremor cancel instead of qualifying as a turn.
    const hasMeaningfulStep = Math.hypot(yawStep, pitchStep) >= 0.5;
    const previousStepMagnitude = Math.hypot(previousStepYaw, previousStepPitch);
    const stepMagnitude = Math.hypot(yawStep, pitchStep);
    const directionAlignment = previousStepMagnitude > Number.EPSILON && stepMagnitude > Number.EPSILON
      ? (yawStep * previousStepYaw + pitchStep * previousStepPitch)
        / (stepMagnitude * previousStepMagnitude)
      : 1;
    const sameDirection = !hasPreviousStep || directionAlignment >= 0.25;
    if (hasMeaningfulStep && hasPreviousStep && !sameDirection && rapidProgress < 0.35) {
      // Before a real turn has been established, a reversal is a shake rather
      // than a request to widen the camera envelope.
      rapidActivation = 0;
      rapidProgress = 0;
      yawVelocity = 0;
      pitchVelocity = 0;
    }
    const targetActivation = hasMeaningfulStep && sameDirection && speed >= startSpeed ? 1 : 0;
    const ramp = targetActivation ? rapidRampMs : rapidReleaseMs;
    const activationAlpha = clamp(intervalMs / Math.max(1, Number.isFinite(ramp) ? ramp : 90), 0, 1);
    rapidActivation += (targetActivation - rapidActivation) * activationAlpha;
    const measured = adaptiveTurnProfile(speed, {
      baseLimitDeg: maxPhysicalDeltaDeg,
      rapidLimitDeg: rapidMaxPhysicalDeltaDeg,
      startSpeedDegPerSecond: rapidTurnStartSpeedDegPerSecond,
      fullSpeedDegPerSecond: rapidTurnFullSpeedDegPerSecond,
      maxGainMultiplier: rapidGainMultiplier,
      maxCameraDeltaDeg: rapidMaxCameraDeltaDeg,
      baseGain: gain,
    });
    rapidProgress = Math.max(rapidProgress, measured.progress * rapidActivation);
    previousTimestamp = timestamp;
    previousRawYaw = angles.yaw;
    previousRawPitch = angles.pitch;
    if (hasMeaningfulStep) {
      previousStepYaw = yawStep;
      previousStepPitch = pitchStep;
      hasPreviousStep = true;
    }
    return profileForProgress(rapidProgress);
  };

  const capOutput = (desired, timestamp) => {
    if (!Number.isFinite(timestamp) || !Number.isFinite(lastIntervalMs)) {
      return { value: desired, clipped: false };
    }
    const intervalScale = clamp(lastIntervalMs / (1000 / 60), 0.5, 4);
    const limit = Math.max(1, Number.isFinite(maxOutputStepDeg) ? maxOutputStepDeg : 45) * intervalScale;
    const value = clamp(desired, -limit, limit);
    return { value, clipped: Math.abs(value - desired) > Number.EPSILON };
  };

  return {
    calibrate(sample, timestamp) {
      const normalized = normalizeQuaternion(sample);
      const aim = quaternionToAimVector(normalized);
      if (!normalized || !aim) return false;
      baselineAim = aim;
      previousAim = aim;
      previousQuaternion = normalized;
      previousTargetYaw = 0;
      previousTargetPitch = 0;
      previousRawYaw = 0;
      previousRawPitch = 0;
      previousTimestamp = Number.isFinite(timestamp) ? timestamp : null;
      lastIntervalMs = null;
      yawVelocity = 0;
      pitchVelocity = 0;
      rapidActivation = 0;
      rapidProgress = 0;
      previousStepYaw = 0;
      previousStepPitch = 0;
      hasPreviousStep = false;
      return true;
    },

    update(sample, timestamp) {
      const normalized = normalizeQuaternion(sample);
      const aim = quaternionToAimVector(normalized);
      if (!normalized || !aim || !baselineAim) return noDelta(false);

      const rawAngles = relativeAngles(aim);
      const profile = updateRapidProfile(rawAngles, timestamp);
      const angles = {
        yaw: clamp(rawAngles.yaw, -profile.physicalLimitDeg, profile.physicalLimitDeg),
        pitch: clamp(rawAngles.pitch, -profile.physicalLimitDeg, profile.physicalLimitDeg),
      };
      const roll = gripRollDegrees(previousQuaternion, normalized, previousAim, aim);
      const rollDominates = roll >= 25 && roll >= vectorDistanceDegrees(previousAim, aim) * 2.5;
      const transitionScale = rollDominates
        ? angles.yaw * angles.yaw + angles.pitch * angles.pitch < 9
          ? 0
          : Math.hypot(angles.yaw, angles.pitch) < 6 ? 0.35 : 1
        : 1;

      const smooth = clamp(Number.isFinite(smoothingStrength) ? smoothingStrength : 0, 0, 1);
      const smoothing = 1 - smooth * 0.35;
      const turnGain = (Number.isFinite(gain) ? gain : 1) * profile.gainMultiplier * smoothing;
      const maxCameraDelta = profile.maxCameraDeltaDeg;
      const targetYaw = clamp(
        (Math.abs(angles.yaw) <= deadZoneDeg ? 0 : angles.yaw) * turnGain,
        -maxCameraDelta,
        maxCameraDelta,
      );
      const targetPitch = clamp(
        (Math.abs(angles.pitch) <= deadZoneDeg ? 0 : angles.pitch) * turnGain,
        -Math.min(maxPitchDeg, maxCameraDelta),
        Math.min(maxPitchDeg, maxCameraDelta),
      );
      const yawStep = capOutput(targetYaw - previousTargetYaw, timestamp);
      const pitchStep = capOutput(targetPitch - previousTargetPitch, timestamp);
      const yaw = yawStep.value * transitionScale;
      const pitch = pitchStep.value * transitionScale;

      // Track the target that was actually emitted so temporary roll suppression cannot
      // leave a hidden target offset that later becomes a phantom turn.
      previousTargetYaw = yawStep.clipped && transitionScale === 1 ? targetYaw : previousTargetYaw + yaw;
      previousTargetPitch = pitchStep.clipped && transitionScale === 1 ? targetPitch : previousTargetPitch + pitch;
      previousAim = aim;
      previousQuaternion = normalized;
      return {
        yaw,
        pitch,
        physicalYaw: angles.yaw,
        physicalPitch: angles.pitch,
        transitionScale,
        roll,
        turnGain,
        rapidProgress: profile.progress,
        valid: true,
      };
    },

    get calibrated() {
      return baselineAim !== null;
    },
  };
}
