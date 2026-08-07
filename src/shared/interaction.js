export function chooseAssistedTarget(targets, cameraPosition, forward, {
  currentId = null,
  maxDistance = 2.6,
  minAlignment = 0.84,
  hysteresisScore = 0.08,
} = {}) {
  let best = null;
  let bestScore = -Infinity;
  let current = null;
  let currentScore = -Infinity;
  for (const target of targets) {
    const anchor = target.anchor ?? target.position;
    if (!target.enabled || !target.visible || target.occluded || !anchor) continue;
    const dx = anchor.x - cameraPosition.x;
    const dy = anchor.y - cameraPosition.y;
    const dz = anchor.z - cameraPosition.z;
    const distance = Math.hypot(dx, dy, dz);
    const useDistance = Number.isFinite(target.maxUseDistance) ? target.maxUseDistance : maxDistance;
    if (distance <= Number.EPSILON || distance > useDistance) continue;
    const alignment = (dx * forward.x + dy * forward.y + dz * forward.z) / distance;
    if (alignment < minAlignment) continue;
    const approach = target.approachDirection;
    if (approach) {
      const approachLength = Math.hypot(approach.x, approach.y, approach.z);
      const approachAlignment = (-dx * approach.x - dy * approach.y - dz * approach.z) / (distance * approachLength);
      if (!Number.isFinite(approachAlignment) || approachAlignment <= 0) continue;
    }
    const score = alignment * 2 - distance * 0.1;
    if (score > bestScore) {
      best = target;
      bestScore = score;
    }
    if (target.id === currentId) {
      current = target;
      currentScore = score;
    }
  }
  return current && currentScore >= bestScore - hysteresisScore ? current : best;
}
