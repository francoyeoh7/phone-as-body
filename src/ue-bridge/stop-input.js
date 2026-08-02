const MAX_SEQUENCE = 2_147_483_000;

export function createStoppedControllerInput(previousSequence = -1, sentAt = performance.now()) {
  const previous = Number.isInteger(previousSequence)
    ? Math.min(previousSequence, MAX_SEQUENCE - 1)
    : -1;
  return {
    seq: Math.max(0, previous + 1),
    sentAt: Number.isFinite(sentAt) ? sentAt : 0,
    move: { x: 0, y: 0 },
    viewDelta: { yaw: 0, pitch: 0 },
    clutch: false,
  };
}
