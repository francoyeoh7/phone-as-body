export const HAND_LANDMARK_COUNT = 21;

const PALM_EPSILON = 1e-6;
const CURL_ANGLE_RANGE = Math.PI * 0.65;
const PALM_CENTER_INDICES = [0, 5, 9, 13, 17];
const DIGIT_CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const subtract = (left, right) => left.map((value, index) => value - right[index]);
const scale = (vector, factor) => vector.map((value) => value * factor);
const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const length = (vector) => Math.hypot(...vector);
const distance = (left, right) => length(subtract(left, right));
const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

function normalize(vector, errorMessage) {
  const magnitude = length(vector);
  if (!Number.isFinite(magnitude) || magnitude < PALM_EPSILON) {
    throw new RangeError(errorMessage);
  }
  return scale(vector, 1 / magnitude);
}

function pointToArray(point, collectionName, index) {
  if (Array.isArray(point) && point.length !== 3) {
    throw new RangeError(`${collectionName}[${index}] must contain three finite coordinates`);
  }
  const coordinates = Array.isArray(point)
    ? [...point]
    : [point?.x, point?.y, point?.z];
  if (coordinates.length !== 3 || !coordinates.every(Number.isFinite)) {
    throw new RangeError(`${collectionName}[${index}] must contain three finite coordinates`);
  }
  return coordinates;
}

function validateLandmarks(value, collectionName) {
  if (!Array.isArray(value) || value.length !== HAND_LANDMARK_COUNT) {
    throw new RangeError(`${collectionName} must contain exactly 21 landmarks`);
  }
  return value.map((point, index) => pointToArray(point, collectionName, index));
}

function average(points) {
  const total = points.reduce((sum, point) => [
    sum[0] + point[0],
    sum[1] + point[1],
    sum[2] + point[2],
  ], [0, 0, 0]);
  return scale(total, 1 / points.length);
}

function palmCenter(landmarks) {
  return average(PALM_CENTER_INDICES.map((index) => landmarks[index]));
}

function palmScale(landmarks) {
  return (
    distance(landmarks[0], landmarks[9])
    + distance(landmarks[5], landmarks[17])
  ) / 2;
}

function palmBasis(worldLandmarks, handedness, inputMirrored) {
  const upRaw = subtract(worldLandmarks[9], worldLandmarks[0]);
  const acrossPalm = subtract(worldLandmarks[17], worldLandmarks[5]);
  if (length(cross(acrossPalm, upRaw)) < PALM_EPSILON) {
    throw new RangeError("degenerate palm basis");
  }
  const upSeed = normalize(upRaw, "degenerate palm basis");
  let right = subtract(acrossPalm, scale(upSeed, dot(acrossPalm, upSeed)));
  if ((handedness === "left") !== inputMirrored) right = scale(right, -1);
  right = normalize(right, "degenerate palm basis");

  const forwardRaw = cross(right, upSeed);
  if (length(forwardRaw) < PALM_EPSILON) throw new RangeError("degenerate palm basis");
  const forward = normalize(forwardRaw, "degenerate palm basis");
  const up = normalize(cross(forward, right), "degenerate palm basis");
  return { right, up, forward };
}

function jointAngle(first, joint, last) {
  const incoming = normalize(subtract(joint, first), "degenerate finger geometry");
  const outgoing = normalize(subtract(last, joint), "degenerate finger geometry");
  return Math.acos(clamp(dot(incoming, outgoing), -1, 1));
}

function digitCurl(worldLandmarks, chain) {
  const angles = [
    jointAngle(worldLandmarks[chain[0]], worldLandmarks[chain[1]], worldLandmarks[chain[2]]),
    jointAngle(worldLandmarks[chain[1]], worldLandmarks[chain[2]], worldLandmarks[chain[3]]),
  ];
  return clamp(((angles[0] + angles[1]) / 2) / CURL_ANGLE_RANGE, 0, 1);
}

function readHandedness(sample) {
  let category = sample?.handedness;
  if (Array.isArray(category)) category = category[0];
  const label = normalizeMediaPipeHandedness(
    typeof category === "object" && category !== null
      ? category.categoryName ?? category.displayName ?? category.label
      : category,
    sample?.inputMirrored,
  );
  if (!label) throw new RangeError("invalid handedness category");

  const categoryScore = typeof category === "object" && category !== null ? category.score : undefined;
  const score = Number.isFinite(sample?.handednessScore)
    ? sample.handednessScore
    : Number.isFinite(categoryScore) ? categoryScore : 0.75;
  return { label, score: clamp(score, 0, 1) };
}

function inFrameCoverage(landmarks) {
  const covered = landmarks.reduce((count, point) => (
    count + (point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= 1 ? 1 : 0)
  ), 0);
  return covered / HAND_LANDMARK_COUNT;
}

function previousCenter(previous) {
  if (Array.isArray(previous?.center)
    && previous.center.length === 3
    && previous.center.every(Number.isFinite)) {
    return previous.center;
  }
  try {
    return palmCenter(validateLandmarks(previous?.landmarks, "previous landmarks"));
  } catch {
    return null;
  }
}

function previousPalmScale(previous) {
  try {
    return palmScale(validateLandmarks(previous?.landmarks, "previous landmarks"));
  } catch {
    return null;
  }
}

function scaleContinuity(currentScale, previous, relativeScale) {
  if (!previous) return 1;
  const previousScale = previousPalmScale(previous);
  const comparison = Number.isFinite(previousScale) && previousScale > PALM_EPSILON
    ? currentScale / previousScale
    : Number.isFinite(previous.relativeScale) && previous.relativeScale > PALM_EPSILON
      ? relativeScale / previous.relativeScale
      : null;
  return Number.isFinite(comparison) && comparison > 0
    ? Math.exp(-Math.abs(Math.log(comparison)) * 3)
    : 0.5;
}

function motionContinuity(center, capturedAt, previous) {
  if (!previous) return { velocity: 0, confidence: 1, valid: true };
  const priorCenter = previousCenter(previous);
  const priorTimestamp = previous.capturedAt;
  if (!priorCenter || !Number.isFinite(capturedAt) || !Number.isFinite(priorTimestamp) || capturedAt <= priorTimestamp) {
    return { velocity: 0, confidence: 0, valid: false };
  }
  const velocity = distance(center, priorCenter) / ((capturedAt - priorTimestamp) / 1000);
  if (!Number.isFinite(velocity)) return { velocity: 0, confidence: 0, valid: false };
  return { velocity, confidence: Math.exp(-velocity * 2.5), valid: true };
}

function assertFiniteDerivedFeatures(pose) {
  const scalars = [
    pose.handConfidence,
    pose.trackingConfidence,
    pose.openness,
    pose.grabStrength,
    pose.palmFacing,
    pose.relativeScale,
    pose.velocity,
  ];
  const vectors = [pose.center, pose.wrist.right, pose.wrist.up, pose.wrist.forward, pose.curls];
  if (!scalars.every(Number.isFinite)
    || !vectors.every((vector) => vector.every(Number.isFinite))) {
    throw new RangeError("derived hand features must be finite");
  }
  return pose;
}

export function normalizeHandedness(value) {
  const label = String(value ?? "").toLowerCase();
  if (label !== "left" && label !== "right") return null;
  return label;
}

export function normalizeMediaPipeHandedness(value, inputMirrored) {
  if (typeof inputMirrored !== "boolean") {
    throw new RangeError("inputMirrored must be boolean");
  }
  const label = normalizeHandedness(value);
  if (!label) return null;
  if (inputMirrored) return label;
  return label === "left" ? "right" : "left";
}

export function deriveHandFeatures(sample, previous = null, calibration = null) {
  const landmarks = validateLandmarks(sample?.landmarks, "landmarks");
  const worldLandmarks = validateLandmarks(sample?.worldLandmarks, "world landmarks");
  const handedness = readHandedness(sample);
  const center = palmCenter(landmarks);
  const measuredPalmScale = palmScale(landmarks);
  if (!Number.isFinite(measuredPalmScale) || measuredPalmScale < PALM_EPSILON) {
    throw new RangeError("degenerate palm geometry");
  }

  const wrist = palmBasis(worldLandmarks, handedness.label, sample.inputMirrored);
  const curls = DIGIT_CHAINS.map((chain) => digitCurl(worldLandmarks, chain));
  const thumbCurl = curls[0];
  const fingerCurl = (curls[1] + curls[2] + curls[3] + curls[4]) / 4;
  const thumbTarget = average([landmarks[5], landmarks[9]]);
  const thumbOpposition = clamp(1 - distance(landmarks[4], thumbTarget) / (measuredPalmScale * 1.2), 0, 1);
  const openness = clamp(1 - (fingerCurl * 0.85 + thumbCurl * 0.15), 0, 1);
  const grabStrength = clamp(fingerCurl * 0.8 + Math.max(thumbCurl, thumbOpposition) * 0.2, 0, 1);
  const palmFacing = clamp(-wrist.forward[2], 0, 1);

  const calibratedPalmSpan = Number.isFinite(calibration?.palmSpan) && calibration.palmSpan > PALM_EPSILON
    ? calibration.palmSpan
    : null;
  const relativeScale = calibratedPalmSpan ? measuredPalmScale / calibratedPalmSpan : 1;
  const motion = motionContinuity(center, sample?.capturedAt, previous);
  const coverage = inFrameCoverage(landmarks);
  const handConfidence = clamp(handedness.score * 0.55 + coverage * 0.45, 0, 1);
  const handednessContinuity = previous?.handedness && previous.handedness !== handedness.label ? 0 : 1;
  const continuity = clamp(
    coverage * 0.3
      + scaleContinuity(measuredPalmScale, previous, relativeScale) * 0.25
      + motion.confidence * 0.25
      + handednessContinuity * 0.2,
    0,
    1,
  );
  const trackingConfidence = motion.valid ? clamp(continuity * handConfidence, 0, 1) : 0;

  return assertFiniteDerivedFeatures({
    ...(Number.isFinite(sample?.capturedAt) ? { capturedAt: sample.capturedAt } : {}),
    handedness: handedness.label,
    handConfidence,
    trackingConfidence,
    landmarks,
    worldLandmarks,
    center,
    wrist,
    curls,
    openness,
    grabStrength,
    palmFacing,
    relativeScale,
    velocity: motion.velocity,
  });
}

export function createTrackedHandFrame({
  seq,
  capturedAt,
  modeEpoch,
  sample,
  previous,
  calibration,
}) {
  const pose = deriveHandFeatures({ ...sample, capturedAt }, previous, calibration);
  return { version: 1, seq, capturedAt, modeEpoch, state: "tracked", ...pose };
}

export function createHandStatusFrame({ seq, capturedAt, modeEpoch, state, reason }) {
  if (!["lost", "unavailable"].includes(state)) throw new RangeError("invalid hand state");
  return {
    version: 1,
    seq,
    capturedAt,
    modeEpoch,
    state,
    reason: String(reason ?? "unknown").slice(0, 48),
  };
}
