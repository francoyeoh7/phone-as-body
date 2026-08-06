const DEFAULTS = Object.freeze({
  entryWristY: 0.72,
  entryPalmY: 0.5,
  entryLeftX: 0.05,
  entryRightX: 0.95,
  minCoverage: 16,
  acquireFrames: 3,
  acquireMs: 140,
  topResetWristY: 0.28,
  corridorBottomY: 0.96,
  corridorLeftX: 0,
  corridorRightX: 1,
  topResetMs: 120,
  sideResetMs: 120,
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

function landmarkY(pose, index) {
  const point = pose?.landmarks?.[index];
  return Number.isFinite(point?.[1] ?? point?.y) ? (point?.[1] ?? point.y) : Number.NaN;
}

function palmY(pose) {
  return Number.isFinite(pose?.center?.[1]) ? pose.center[1] : Number.NaN;
}

function palmX(pose) {
  return Number.isFinite(pose?.center?.[0]) ? pose.center[0] : Number.NaN;
}

export function createReachState(options = {}) {
  const settings = { ...DEFAULTS, ...options };
  return {
    acquired: false,
    entryFrames: 0,
    entryStartedAt: null,
    topExitedAt: null,
    sideExitedAt: null,
    settings,
  };
}

export function updateReachState(state, pose, now, options = {}) {
  const prior = state && typeof state === "object" ? state : createReachState(options);
  const settings = { ...DEFAULTS, ...prior.settings, ...options };
  const timestamp = Number.isFinite(now) ? now : 0;
  const centerY = palmY(pose);
  const centerX = palmX(pose);
  const wristY = landmarkY(pose, 0);
  const coverage = landmarksInFrame(pose?.landmarks);
  const entryValid = Number.isFinite(centerY)
    && Number.isFinite(centerX)
    && Number.isFinite(wristY)
    && wristY >= settings.entryWristY
    && centerY >= settings.entryPalmY
    && centerX >= settings.entryLeftX
    && centerX <= settings.entryRightX
    && coverage >= settings.minCoverage;

  if (!prior.acquired) {
    const entryFrames = entryValid ? prior.entryFrames + 1 : 0;
    const entryStartedAt = entryValid ? (prior.entryStartedAt ?? timestamp) : null;
    const dwell = entryStartedAt == null ? 0 : timestamp - entryStartedAt;
    const acquired = entryFrames >= settings.acquireFrames && dwell >= settings.acquireMs;
    const next = {
      acquired,
      entryFrames: acquired ? settings.acquireFrames : entryFrames,
      entryStartedAt: acquired ? null : entryStartedAt,
      topExitedAt: null,
      sideExitedAt: null,
      settings,
    };
    return {
      state: next,
      eligible: acquired,
      progress: acquired ? 1 : clamp(entryFrames / settings.acquireFrames, 0, 1),
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
  const next = reset
    ? { acquired: false, entryFrames: 0, entryStartedAt: null, topExitedAt: null, sideExitedAt: null, settings }
    : { acquired: true, entryFrames: settings.acquireFrames, entryStartedAt: null, topExitedAt, sideExitedAt, settings };
  return { state: next, eligible: !reset, progress: reset ? 0 : 1, entered: false };
}
