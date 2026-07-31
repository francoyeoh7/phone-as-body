export function chooseAssistedTarget(targets, cameraPosition, forward, { maxDistance = 2.6, minAlignment = 0.84 } = {}) {
  let best = null;
  let bestScore = -Infinity;
  for (const target of targets) {
    if (!target.enabled || !target.visible) continue;
    const dx = target.position.x - cameraPosition.x;
    const dy = target.position.y - cameraPosition.y;
    const dz = target.position.z - cameraPosition.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= Number.EPSILON || distance > maxDistance) continue;
    const alignment = (dx * forward.x + dy * forward.y + dz * forward.z) / distance;
    if (alignment < minAlignment) continue;
    const score = alignment * 2 - distance * 0.1;
    if (score > bestScore) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}
