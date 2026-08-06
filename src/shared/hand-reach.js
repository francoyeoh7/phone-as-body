const DEFAULTS = Object.freeze({
  entryWristY: 0.72,
  entryPalmY: 0.5,
  minCoverage: 16,
  acquireFrames: 3,
  acquireMs: 140,
  corridorTopY: 0.15,
  corridorBottomY: 0.96,
  topResetMs: 120,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function landmarksInFrame(landmarks) {
  if (!Array.isArray(landmarks)) return 0;
  return landmarks.reduce((count, point) => (
    count + (Number.isFinite(point?.x) && Number.isFinite(point?.y)
      && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 ? 1 : 0)
  ), 0);
}

function palmY(pose) {
  return Number.isFinite(pose?.center?.[1]) ? pose.center[1] : Number.NaN;
}

export function createReachState(options = {}) {
  const settings = { ...DEFAULTS, ...options };
  return {
    acquired: false,
    entryFrames: 0,
    entryStartedAt: null,
    topExitedAt: null,
    settings,
  };
}

export function updateReachState(state, pose, now, options = {}) {
  const prior = state && typeof state === "object" ? state : createReachState(options);
  const settings = { ...DEFAULTS, ...prior.settings, ...options };
  const timestamp = Number.isFinite(now) ? now : 0;
  const centerY = palmY(pose);
  const coverage = landmarksInFrame(pose?.landmarks);
  const entryValid = Number.isFinite(centerY)
    && pose?.landmarks?.[0]?.y >= settings.entryWristY
    && centerY >= settings.entryPalmY
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
      settings,
    };
    return {
      state: next,
      eligible: acquired,
      progress: acquired ? 1 : clamp(entryFrames / settings.acquireFrames, 0, 1),
      entered: acquired,
    };
  }

  const aboveCorridor = !Number.isFinite(centerY) || centerY < settings.corridorTopY;
  const belowCorridor = Number.isFinite(centerY) && centerY > settings.corridorBottomY;
  const topExitedAt = aboveCorridor ? (prior.topExitedAt ?? timestamp) : null;
  const reset = belowCorridor || (topExitedAt != null && timestamp - topExitedAt >= settings.topResetMs);
  const next = reset
    ? { acquired: false, entryFrames: 0, entryStartedAt: null, topExitedAt: null, settings }
    : { acquired: true, entryFrames: settings.acquireFrames, entryStartedAt: null, topExitedAt, settings };
  return { state: next, eligible: !reset, progress: reset ? 0 : 1, entered: false };
}
