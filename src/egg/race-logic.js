export const TRACK_HALF = 4.6;

// Bump bars span the full track width with gaps to dodge through.
// Hitbox = racer center over the bar (no extra margin) so hits feel fair.
export const BUMPS = [
  { d: 10, segments: [{ x: -3.0, w: 2.2 }, { x: 0.6, w: 2.0 }] },
  { d: 18, segments: [{ x: -1.0, w: 2.6 }, { x: 2.9, w: 2.2 }] },
  { d: 26, segments: [{ x: -3.4, w: 1.8 }, { x: -0.2, w: 1.6 }, { x: 3.0, w: 2.0 }] },
  { d: 34, segments: [{ x: -1.8, w: 2.4 }, { x: 1.9, w: 2.4 }] },
  { d: 42, segments: [{ x: -3.2, w: 2.0 }, { x: 0.2, w: 1.8 }, { x: 3.4, w: 1.6 }] },
  { d: 50, segments: [{ x: -1.2, w: 3.0 }, { x: 3.0, w: 2.0 }] },
];

export function bumpHit(bumpRow, worldX, prevDist, dist) {
  if (!(prevDist < bumpRow.d && dist >= bumpRow.d)) return false;
  return bumpRow.segments.some((segment) => Math.abs(worldX - segment.x) < segment.w / 2);
}

export const GRAB_RANGE_X = 1.6;
export const GRAB_RANGE_Z = 2.4;

export function chooseGrabTarget(racers, attackerSlot) {
  const attacker = racers.get(attackerSlot);
  if (!attacker) return null;
  let best = null;
  let bestScore = Infinity;
  for (const racer of racers.values()) {
    if (racer.slot === attackerSlot || racer.finished || racer.dropTimer > 0) continue;
    const dx = (racer.renderX ?? 0) - (attacker.renderX ?? 0);
    const dz = racer.dist - attacker.dist;
    if (Math.abs(dx) > GRAB_RANGE_X || Math.abs(dz) > GRAB_RANGE_Z) continue;
    const score = Math.abs(dx) + Math.abs(dz) * 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = racer;
    }
  }
  return best;
}

export function aiControl(racer, bumps, { trackHalf = TRACK_HALF, plateRadius = 0.52 } = {}) {
  const eggDist = Math.hypot(racer.eggPos.x, racer.eggPos.y);
  const forward = eggDist > plateRadius * 0.55 ? 0.4 : 0.85;

  let steer = -racer.worldX * 0.08;
  for (const row of bumps) {
    const ahead = row.d - racer.dist;
    if (ahead <= 0.5 || ahead > 5.5) continue;
    for (const segment of row.segments) {
      const dx = racer.worldX - segment.x;
      if (Math.abs(dx) < segment.w / 2 + 0.3) {
        steer += (dx >= 0 ? 1 : -1) * 0.9;
      }
    }
  }
  steer = Math.max(-1, Math.min(1, steer));
  if (Math.abs(racer.worldX) > trackHalf - 0.4) {
    steer = racer.worldX > 0 ? -1 : 1;
  }
  return { x: steer, y: forward };
}
