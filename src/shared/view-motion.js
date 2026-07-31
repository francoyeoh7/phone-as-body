const DEGREES_PER_RADIAN = 180 / Math.PI;
const MINIMUM_TRACKS = 6;
const REPROJECTION_ERROR_SCALE = 1.5;
const UNRELIABLE_FIT_CONFIDENCE = 0.45;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return sorted[middle - 1] / 2 + sorted[middle] / 2;
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function neutralPointMotion() {
  return { dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0, inliers: 0 };
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function summarizePointMotion(previousPoints, currentPoints) {
  if (!Array.isArray(previousPoints) || !Array.isArray(currentPoints)) return neutralPointMotion();

  const pairs = [];
  const pairCount = Math.min(previousPoints.length, currentPoints.length);
  for (let index = 0; index < pairCount; index += 1) {
    const previous = previousPoints[index];
    const current = currentPoints[index];
    if (!finitePoint(previous) || !finitePoint(current)) continue;

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (Number.isFinite(dx) && Number.isFinite(dy)) pairs.push({ previous, current, dx, dy });
  }

  if (pairs.length < MINIMUM_TRACKS) return neutralPointMotion();

  const medianDx = median(pairs.map((pair) => pair.dx));
  const medianDy = median(pairs.map((pair) => pair.dy));
  const residuals = pairs.map((pair) => Math.hypot(pair.dx - medianDx, pair.dy - medianDy));
  const medianResidual = median(residuals);
  const residualMad = median(residuals.map((residual) => Math.abs(residual - medianResidual)));
  const inlierThreshold = medianResidual + Math.max(3.5 * 1.4826 * residualMad, 0.5);
  const inliers = pairs.filter((_, index) => residuals[index] <= inlierThreshold);

  if (inliers.length < MINIMUM_TRACKS) return neutralPointMotion();

  const dx = median(inliers.map((pair) => pair.dx));
  const dy = median(inliers.map((pair) => pair.dy));
  const count = inliers.length;
  const previousCenter = inliers.reduce(
    (center, pair) => ({
      x: center.x + pair.previous.x / count,
      y: center.y + pair.previous.y / count,
    }),
    { x: 0, y: 0 },
  );
  const currentCenter = inliers.reduce(
    (center, pair) => ({
      x: center.x + pair.current.x / count,
      y: center.y + pair.current.y / count,
    }),
    { x: 0, y: 0 },
  );
  if (!finitePoint(previousCenter) || !finitePoint(currentCenter)) return neutralPointMotion();

  let denominator = 0;
  let cosineNumerator = 0;
  let sineNumerator = 0;
  for (const pair of inliers) {
    const previousX = pair.previous.x - previousCenter.x;
    const previousY = pair.previous.y - previousCenter.y;
    const currentX = pair.current.x - currentCenter.x;
    const currentY = pair.current.y - currentCenter.y;
    const denominatorTerm = previousX * previousX + previousY * previousY;
    const cosineTerm = previousX * currentX + previousY * currentY;
    const sineTerm = previousX * currentY - previousY * currentX;
    if (![denominatorTerm, cosineTerm, sineTerm].every(Number.isFinite)) {
      return neutralPointMotion();
    }
    denominator += denominatorTerm;
    cosineNumerator += cosineTerm;
    sineNumerator += sineTerm;
    if (![denominator, cosineNumerator, sineNumerator].every(Number.isFinite)) {
      return neutralPointMotion();
    }
  }

  let scale = 1;
  let rotation = 0;
  let fitScore = 0;
  if (denominator > Number.EPSILON) {
    const cosine = cosineNumerator / denominator;
    const sine = sineNumerator / denominator;
    scale = Math.hypot(cosine, sine);
    rotation = Math.atan2(sine, cosine) * DEGREES_PER_RADIAN;
    if (![cosine, sine, scale, rotation].every(Number.isFinite)) return neutralPointMotion();

    const reprojectionErrors = [];
    for (const pair of inliers) {
      const previousX = pair.previous.x - previousCenter.x;
      const previousY = pair.previous.y - previousCenter.y;
      const predictedX = currentCenter.x + cosine * previousX - sine * previousY;
      const predictedY = currentCenter.y + sine * previousX + cosine * previousY;
      const errorX = pair.current.x - predictedX;
      const errorY = pair.current.y - predictedY;
      const error = Math.hypot(errorX, errorY);
      if (![predictedX, predictedY, errorX, errorY, error].every(Number.isFinite)) {
        return neutralPointMotion();
      }
      reprojectionErrors.push(error);
    }

    const normalizedError = median(reprojectionErrors) / REPROJECTION_ERROR_SCALE;
    const squaredError = normalizedError * normalizedError;
    if (![normalizedError, squaredError].every(Number.isFinite)) return neutralPointMotion();
    fitScore = 1 / (1 + squaredError);
  }

  const spread = denominator > 0 ? Math.sqrt(denominator / count) : 0;
  if (!Number.isFinite(spread)) return neutralPointMotion();
  const inlierRatio = count / pairs.length;
  const countScore = clamp(count / 12, 0, 1);
  const spreadScore = spread < 0.001 ? 0 : clamp(spread / 2, 0, 1);
  const confidence = clamp(inlierRatio * countScore * spreadScore * fitScore, 0, 1);
  if (!Number.isFinite(confidence)) return neutralPointMotion();
  const reliable = confidence >= UNRELIABLE_FIT_CONFIDENCE;

  return {
    dx: reliable ? dx : 0,
    dy: reliable ? dy : 0,
    scale: Math.max(0, scale),
    rotation: clamp(rotation, -180, 180),
    confidence,
    inliers: count,
  };
}

function withoutNegativeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function alignMotionToGrip(vector, rollDegrees) {
  if (!finitePoint(vector) || !Number.isFinite(rollDegrees)) return { x: 0, y: 0 };

  const radians = (rollDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = vector.x * cosine + vector.y * sine;
  const y = -vector.x * sine + vector.y * cosine;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  return { x: withoutNegativeZero(x), y: withoutNegativeZero(y) };
}

export function gravityAlignedRoll(vector, fallbackRoll = 0) {
  const fallback = Number.isFinite(fallbackRoll) ? fallbackRoll : 0;
  if (!finitePoint(vector) || Math.hypot(vector.x, vector.y) < 2) return fallback;
  return finiteOr(Math.atan2(vector.x, vector.y) * DEGREES_PER_RADIAN, fallback);
}

export function blendVerticalMotion(sample) {
  const imageY = Number.isFinite(sample?.imageY) ? sample.imageY : 0;
  const scaleVelocity = Number.isFinite(sample?.scaleVelocity) ? sample.scaleVelocity : 0;
  const weight = Number.isFinite(sample?.screenUpWeight)
    ? clamp(sample.screenUpWeight, 0, 1)
    : 0;
  const blended = imageY + scaleVelocity * weight;
  if (Number.isFinite(blended)) return withoutNegativeZero(blended);
  return blended > 0 ? Number.MAX_VALUE : blended < 0 ? -Number.MAX_VALUE : 0;
}

function shapeViewComponent(value, deadZone, fullSpeed) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  const shaped = ((magnitude - deadZone) / (fullSpeed - deadZone)) * Math.sign(value);
  return withoutNegativeZero(clamp(shaped, -1, 1));
}

export function normalizeViewMotion(sample, options = {}) {
  if (
    !sample ||
    !Number.isFinite(sample.x) ||
    !Number.isFinite(sample.y) ||
    !Number.isFinite(sample.confidence)
  ) {
    return { x: 0, y: 0, confidence: 0 };
  }

  const config = options && typeof options === "object" ? options : {};
  let deadZone = Number.isFinite(config.deadZone) && config.deadZone >= 0
    ? config.deadZone
    : 0.1;
  let fullSpeed = Number.isFinite(config.fullSpeed) && config.fullSpeed > 0
    ? config.fullSpeed
    : 1.4;
  if (fullSpeed <= deadZone || !Number.isFinite(fullSpeed - deadZone)) {
    deadZone = 0.1;
    fullSpeed = 1.4;
  }
  const minimumConfidence = Number.isFinite(config.minimumConfidence)
    ? clamp(config.minimumConfidence, 0, 1)
    : 0.45;
  const confidence = clamp(sample.confidence, 0, 1);

  if (confidence < minimumConfidence) return { x: 0, y: 0, confidence };

  return {
    x: shapeViewComponent(sample.x, deadZone, fullSpeed),
    y: shapeViewComponent(sample.y, deadZone, fullSpeed),
    confidence,
  };
}

const DEFAULT_YAW_SPEED = 2.8;
const DEFAULT_PITCH_SPEED = 2.2;
const DEFAULT_MAX_PITCH = 1.25;
const VELOCITY_EPSILON = 0.001;

function integrateDampedVelocity(current, target, duration, responseRate) {
  if (responseRate === Number.POSITIVE_INFINITY) {
    const distance = target * duration;
    return {
      velocity: target,
      distance: Number.isFinite(distance) ? distance : Math.sign(target) * Number.MAX_VALUE,
    };
  }
  const decay = Math.exp(-responseRate * duration);
  const distance = target * duration + ((current - target) * (1 - decay)) / responseRate;
  return {
    velocity: target + (current - target) * decay,
    distance: Number.isFinite(distance) ? distance : Math.sign(target || current) * Number.MAX_VALUE,
  };
}

export function integrateViewMotion(state, input, deltaSeconds, options = {}) {
  const yaw = finiteOr(state?.yaw, 0);
  const pitchLimit = Math.abs(finiteOr(options?.maxPitch, DEFAULT_MAX_PITCH));
  const pitch = clamp(finiteOr(state?.pitch, 0), -pitchLimit, pitchLimit);
  const currentVx = finiteOr(state?.vx, 0);
  const currentVy = finiteOr(state?.vy, 0);
  const duration = Math.max(0, finiteOr(deltaSeconds, 1 / 60));
  const sensitivity = clamp(finiteOr(options?.sensitivity, 1), 0.4, 2);
  const smoothing = clamp(finiteOr(options?.smoothing, 0.55), 0, 1);
  const inputX = clamp(finiteOr(input?.x, 0), -1, 1);
  const inputY = clamp(finiteOr(input?.y, 0), -1, 1);

  if (
    Math.abs(inputX) < VELOCITY_EPSILON
    && Math.abs(inputY) < VELOCITY_EPSILON
    && Math.abs(currentVx) < VELOCITY_EPSILON
    && Math.abs(currentVy) < VELOCITY_EPSILON
  ) {
    return { yaw, pitch, vx: 0, vy: 0 };
  }

  const pitchSign = options?.invertY ? -1 : 1;
  const targetVx = -inputX * DEFAULT_YAW_SPEED * sensitivity;
  const targetVy = inputY * DEFAULT_PITCH_SPEED * sensitivity * pitchSign;
  const responseRate = smoothing === 0 ? Number.POSITIVE_INFINITY : 24 - 18 * smoothing;
  const horizontal = integrateDampedVelocity(currentVx, targetVx, duration, responseRate);
  const vertical = integrateDampedVelocity(currentVy, targetVy, duration, responseRate);
  const rawPitch = pitch + vertical.distance;
  const nextPitch = clamp(rawPitch, -pitchLimit, pitchLimit);
  const pitchBlocked = nextPitch !== rawPitch;

  const rawYaw = yaw + horizontal.distance;

  return {
    yaw: Number.isFinite(rawYaw) ? rawYaw : Math.sign(rawYaw) * Number.MAX_VALUE,
    pitch: nextPitch,
    vx: Math.abs(inputX) < VELOCITY_EPSILON && Math.abs(horizontal.velocity) < VELOCITY_EPSILON
      ? 0
      : horizontal.velocity,
    vy: pitchBlocked || (Math.abs(inputY) < VELOCITY_EPSILON && Math.abs(vertical.velocity) < VELOCITY_EPSILON)
      ? 0
      : vertical.velocity,
  };
}
