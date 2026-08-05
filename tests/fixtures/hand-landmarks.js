export const MEDIAPIPE_HAND_LANDMARKS = Object.freeze({
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexDip: 7,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleDip: 11,
  middleTip: 12,
  ringMcp: 13,
  ringPip: 14,
  ringDip: 15,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyDip: 19,
  pinkyTip: 20,
});

const OPEN_POINTS = [
  [0.50, 0.82, 0.000],
  [0.42, 0.72, -0.010], [0.34, 0.64, -0.020], [0.27, 0.56, -0.025], [0.20, 0.49, -0.030],
  [0.42, 0.59, 0.000], [0.40, 0.43, -0.010], [0.39, 0.29, -0.015], [0.38, 0.16, -0.020],
  [0.50, 0.56, 0.000], [0.50, 0.38, -0.010], [0.50, 0.23, -0.015], [0.50, 0.09, -0.020],
  [0.58, 0.59, 0.000], [0.60, 0.43, -0.005], [0.61, 0.30, -0.010], [0.62, 0.18, -0.015],
  [0.65, 0.64, 0.000], [0.68, 0.51, -0.005], [0.70, 0.41, -0.010], [0.72, 0.32, -0.015],
];

const CURLED_POINTS = [
  [0.50, 0.82, 0.000],
  [0.42, 0.72, -0.010], [0.38, 0.65, -0.025], [0.45, 0.64, -0.045], [0.51, 0.68, -0.055],
  [0.42, 0.59, 0.000], [0.40, 0.48, -0.020], [0.48, 0.51, -0.060], [0.44, 0.60, -0.075],
  [0.50, 0.56, 0.000], [0.50, 0.44, -0.020], [0.59, 0.48, -0.065], [0.53, 0.58, -0.080],
  [0.58, 0.59, 0.000], [0.60, 0.48, -0.020], [0.68, 0.53, -0.060], [0.61, 0.61, -0.075],
  [0.65, 0.64, 0.000], [0.68, 0.55, -0.015], [0.74, 0.61, -0.050], [0.67, 0.67, -0.065],
];

function makeSample(points, {
  physicalHandedness = "Right",
  rawHandedness,
  inputMirrored = false,
  handednessScore = 0.96,
  capturedAt = 100,
  translate = [0, 0, 0],
  scale = 1,
  worldScale = 0.38,
  x,
  degenerate = false,
  ...extra
} = {}) {
  const isPhysicalLeft = String(physicalHandedness).toLowerCase() === "left";
  const mirrorGeometry = isPhysicalLeft !== (inputMirrored === true);
  const semanticLabel = isPhysicalLeft ? "Left" : "Right";
  const modelLabel = rawHandedness ?? (
    inputMirrored ? semanticLabel : isPhysicalLeft ? "Right" : "Left"
  );
  const transformed = points.map(([sourceX, sourceY, sourceZ]) => {
    const mirroredX = mirrorGeometry ? 1 - sourceX : sourceX;
    return [
      0.5 + (mirroredX - 0.5) * scale + translate[0],
      0.82 + (sourceY - 0.82) * scale + translate[1],
      sourceZ * scale + translate[2],
    ];
  });
  const normalized = degenerate
    ? transformed.map(() => [...transformed[0]])
    : transformed;
  if (x !== undefined) normalized[0][0] = x;

  const landmarks = normalized.map(([pointX, pointY, pointZ]) => ({
    x: pointX,
    y: pointY,
    z: pointZ,
  }));
  const worldLandmarks = normalized.map(([pointX, pointY, pointZ]) => ({
    x: (pointX - 0.5) * worldScale,
    y: (pointY - 0.82) * worldScale,
    z: pointZ * worldScale,
  }));

  return {
    ...extra,
    landmarks,
    worldLandmarks,
    handedness: modelLabel,
    inputMirrored,
    handednessScore,
    capturedAt,
  };
}

export const openHand = (options) => makeSample(OPEN_POINTS, options);

export const curledHand = (options) => makeSample(CURLED_POINTS, options);
