const DEFAULTS = Object.freeze({
  entryWristY: 0.66,
  entryPalmY: 0.52,
  entryLeftX: 0.02,
  entryRightX: 0.55,
  minCoverage: 16,
  acquireFrames: 3,
  acquireMs: 120,
  topResetWristY: 0.28,
  corridorBottomY: 0.96,
  corridorLeftX: 0,
  corridorRightX: 0.95,
  topResetMs: 120,
  sideResetMs: 120,
  depthRange: 0.55,
  verticalRange: 0.36,
  depthWeight: 0.65,
  verticalWeight: 0.35,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function landmarksInFrame(landmarks) {
  if (!Array.isArray(landmarks)) return 0;
  return landmarks.reduce((count, point) => (
    count + (Number.isFinite(point?.[0] ?? point?.x) && Number.isFinite(point?.[1] ?? point?.y)
      && (point?.[0] ?? point.x) >= 0 && (point?.[0] ?? point.x) <= 1
      && (point?.[1] ?? point.y) >= 0 && (point?.[1] ?? point.y) <= 1 ? 1 : 0)
  ), 0);
}

function landmarkCoordinate(pose, index, axis) {
  const point = pose?.landmarks?.[index];
  const value = point?.[axis] ?? point?.[axis === 0 ? "x" : axis === 1 ? "y" : "z"];
  return Number.isFinite(value) ? value : Number.NaN;
}

function palmCoordinate(pose, axis) {
  const value = pose?.center?.[axis];
  return Number.isFinite(value) ? value : Number.NaN;
}

function pointDistance(pose, leftIndex, rightIndex) {
  const left = [0, 1, 2].map((axis) => landmarkCoordinate(pose, leftIndex, axis));
  const right = [0, 1, 2].map((axis) => landmarkCoordinate(pose, rightIndex, axis));
  return [...left, ...right].every(Number.isFinite)
    ? Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
    : Number.NaN;
}

function palmSpan(pose) {
  if (Number.isFinite(pose?.palmSpan) && pose.palmSpan > 0) return pose.palmSpan;
  const wristMiddle = pointDistance(pose, 0, 9);
  const acrossPalm = pointDistance(pose, 5, 17);
  return Number.isFinite(wristMiddle) && Number.isFinite(acrossPalm)
    ? (wristMiddle + acrossPalm) / 2
    : Number.NaN;
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return Number.NaN;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function resetState(settings) {
  return {
    acquired: false,
    entryFrames: 0,
    entryStartedAt: null,
    entrySpans: [],
    entryWristYs: [],
    baselinePalmSpan: null,
    baselineWristY: null,
    topExitedAt: null,
    sideExitedAt: null,
    settings,
  };
}

function reachProgress(pose, state, settings) {
  const span = palmSpan(pose);
  const wristY = landmarkCoordinate(pose, 0, 1);
  const depth = Number.isFinite(span) && Number.isFinite(state.baselinePalmSpan) && state.baselinePalmSpan > 0
    ? clamp((span / state.baselinePalmSpan - 1) / settings.depthRange, 0, 1)
    : 0;
  const vertical = Number.isFinite(wristY) && Number.isFinite(state.baselineWristY)
    ? clamp((state.baselineWristY - wristY) / settings.verticalRange, 0, 1)
    : 0;
  return clamp(depth * settings.depthWeight + vertical * settings.verticalWeight, 0, 1);
}

export function createReachState(options = {}) {
  return resetState({ ...DEFAULTS, ...options });
}

export function updateReachState(state, pose, now, options = {}) {
  const prior = state && typeof state === "object" ? state : createReachState(options);
  const settings = { ...DEFAULTS, ...prior.settings, ...options };
  const timestamp = Number.isFinite(now) ? now : 0;
  const centerY = palmCoordinate(pose, 1);
  const centerX = palmCoordinate(pose, 0);
  const wristY = landmarkCoordinate(pose, 0, 1);
  const span = palmSpan(pose);
  const coverage = landmarksInFrame(pose?.landmarks);
  const entryValid = Number.isFinite(centerY)
    && Number.isFinite(centerX)
    && Number.isFinite(wristY)
    && Number.isFinite(span)
    && span > 0
    && wristY >= settings.entryWristY
    && centerY >= settings.entryPalmY
    && centerX >= settings.entryLeftX
    && centerX <= settings.entryRightX
    && coverage >= settings.minCoverage;

  if (!prior.acquired) {
    const entryFrames = entryValid ? prior.entryFrames + 1 : 0;
    const entryStartedAt = entryValid ? (prior.entryStartedAt ?? timestamp) : null;
    const entrySpans = entryValid ? [...(prior.entrySpans ?? []), span].slice(-settings.acquireFrames) : [];
    const entryWristYs = entryValid ? [...(prior.entryWristYs ?? []), wristY].slice(-settings.acquireFrames) : [];
    const dwell = entryStartedAt == null ? 0 : timestamp - entryStartedAt;
    const acquired = entryFrames >= settings.acquireFrames && dwell >= settings.acquireMs;
    const next = acquired ? {
      acquired: true,
      entryFrames: settings.acquireFrames,
      entryStartedAt: null,
      entrySpans: [],
      entryWristYs: [],
      baselinePalmSpan: median(entrySpans),
      baselineWristY: median(entryWristYs),
      topExitedAt: null,
      sideExitedAt: null,
      settings,
    } : {
      ...resetState(settings),
      entryFrames,
      entryStartedAt,
      entrySpans,
      entryWristYs,
    };
    return {
      state: next,
      eligible: acquired,
      progress: acquired ? 0 : clamp(entryFrames / settings.acquireFrames, 0, 1),
      entered: acquired,
    };
  }

  const aboveCorridor = !Number.isFinite(wristY) || wristY < settings.topResetWristY;
  const belowCorridor = Number.isFinite(centerY) && centerY > settings.corridorBottomY;
  const outsideSide = !Number.isFinite(centerX)
    || centerX < settings.corridorLeftX
    || centerX > settings.corridorRightX;
  const topExitedAt = aboveCorridor ? (prior.topExitedAt ?? timestamp) : null;
  const sideExitedAt = outsideSide ? (prior.sideExitedAt ?? timestamp) : null;
  const reset = belowCorridor
    || (topExitedAt != null && timestamp - topExitedAt >= settings.topResetMs)
    || (sideExitedAt != null && timestamp - sideExitedAt >= settings.sideResetMs);
  if (reset) return { state: resetState(settings), eligible: false, progress: 0, entered: false };
  const next = { ...prior, topExitedAt, sideExitedAt, settings };
  return { state: next, eligible: true, progress: reachProgress(pose, next, settings), entered: false };
}
