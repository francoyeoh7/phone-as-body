export function createWristGestureDetector({
  startSpeed = 170,
  releaseSpeed = 70,
  rotationThreshold = 55,
  minimumExcursion = 24,
  pairWindowMs = 900,
  minimumSeparationMs = 120,
  cooldownMs = 700,
  onCandidate,
  onInteract,
} = {}) {
  let stage = "idle";
  let lastTimeMs = null;
  let direction = 0;
  let excursion = 0;
  let armed = true;
  let firstCandidate = null;
  let cooldownUntilMs = Number.NEGATIVE_INFINITY;

  function clearAccumulation() {
    direction = 0;
    excursion = 0;
  }

  function registerCandidate(timeMs) {
    const candidateDirection = direction;
    armed = false;
    clearAccumulation();

    if (
      firstCandidate &&
      candidateDirection !== firstCandidate.direction
    ) {
      if (timeMs - firstCandidate.timeMs < minimumSeparationMs) return;

      firstCandidate = null;
      stage = "interact";
      cooldownUntilMs = timeMs + cooldownMs;
      onInteract?.();
      return;
    }

    firstCandidate = { direction: candidateDirection, timeMs };
    stage = "first";
    onCandidate?.();
  }

  return {
    update(sample) {
      if (stage === "interact") stage = "idle";

      const timeMs = sample?.timeMs;
      const twistRate = sample?.twistRate;
      if (
        !Number.isFinite(timeMs) ||
        !Number.isFinite(twistRate) ||
        (lastTimeMs !== null && timeMs <= lastTimeMs)
      ) {
        return { rotating: false, stage };
      }

      const speed = Math.abs(twistRate);
      const rotating = speed >= rotationThreshold;
      const deltaSeconds = lastTimeMs === null ? 0 : Math.min(timeMs - lastTimeMs, 50) / 1000;
      lastTimeMs = timeMs;

      if (firstCandidate && timeMs - firstCandidate.timeMs > pairWindowMs) {
        firstCandidate = null;
        stage = "idle";
      }

      if (speed <= releaseSpeed) {
        armed = true;
        clearAccumulation();
      } else if (armed && timeMs >= cooldownUntilMs) {
        if (speed < startSpeed) {
          clearAccumulation();
        } else {
          const sampleDirection = Math.sign(twistRate);
          if (direction === 0) {
            direction = sampleDirection;
          } else if (sampleDirection !== direction) {
            direction = sampleDirection;
            excursion = 0;
          } else {
            excursion += speed * deltaSeconds;
            if (excursion >= minimumExcursion) registerCandidate(timeMs);
          }
        }
      }

      return { rotating, stage };
    },

    reset() {
      stage = "idle";
      lastTimeMs = null;
      armed = true;
      firstCandidate = null;
      cooldownUntilMs = Number.NEGATIVE_INFINITY;
      clearAccumulation();
    },

    get stage() {
      return stage;
    },
  };
}
