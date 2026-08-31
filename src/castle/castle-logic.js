import { PLAYER_RADIUS } from "./castle-layout.js";

// ---------- movement / collision ----------

// Push a circle (px,pz,r) out of a wall AABB. Returns corrected [x, z].
export function resolveWallCollision(px, pz, radius, wall) {
  const dx = px - wall.x;
  const dz = pz - wall.z;
  const pushX = wall.hw + radius - Math.abs(dx);
  const pushZ = wall.hd + radius - Math.abs(dz);
  if (pushX <= 0 || pushZ <= 0) return [px, pz];
  if (pushX < pushZ) return [wall.x + Math.sign(dx || 1) * (wall.hw + radius), pz];
  return [px, wall.z + Math.sign(dz || 1) * (wall.hd + radius)];
}

export function collideWithWalls(px, pz, radius, walls, floorY) {
  let x = px;
  let z = pz;
  for (const wall of walls) {
    if (Math.abs(wall.y - floorY) > 1.5) continue;
    [x, z] = resolveWallCollision(x, z, radius, wall);
  }
  return [x, z];
}

// Ground height at (x, z) given the player's current height (can only step up
// a little; stairs interpolate along their run).
export function groundHeightAt(x, z, currentY, slabs, stairs) {
  let best = -Infinity;
  for (const slab of slabs) {
    if (x < slab.x0 || x > slab.x1 || z < slab.z0 || z > slab.z1) continue;
    if (slab.y <= currentY + 0.55 && slab.y > best) best = slab.y;
  }
  for (const stair of stairs) {
    if (x < Math.min(stair.x0, stair.x1) - 0.5 || x > Math.max(stair.x0, stair.x1) + 0.5) continue;
    if (z < Math.min(stair.z0, stair.z1) - 0.5 || z > Math.max(stair.z0, stair.z1) + 0.5) continue;
    const t = (z - stair.z0) / (stair.z1 - stair.z0);
    const y = stair.fromY + (stair.toY - stair.fromY) * Math.max(0, Math.min(1, t));
    if (y <= currentY + 0.6 && y > best) best = y;
  }
  return best === -Infinity ? currentY : best;
}

// ---------- camera clipping (third person) ----------

// Ray (eye → desired) vs wall AABB in 3D; returns the entry t in [0,1] or null.
function rayHitsWall3D(eye, desired, wall, wallHeight) {
  const min = { x: wall.x - wall.hw, y: wall.y, z: wall.z - wall.hd };
  const max = { x: wall.x + wall.hw, y: wall.y + wallHeight, z: wall.z + wall.hd };
  const d = { x: desired.x - eye.x, y: desired.y - eye.y, z: desired.z - eye.z };
  let tMin = 0;
  let tMax = 1;
  for (const axis of ["x", "y", "z"]) {
    const p = eye[axis];
    const dir = d[axis];
    if (Math.abs(dir) < 1e-9) {
      if (p < min[axis] || p > max[axis]) return null;
    } else {
      let t1 = (min[axis] - p) / dir;
      let t2 = (max[axis] - p) / dir;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
  }
  return tMin;
}

// Pull the camera in front of the nearest wall the boom would cross.
export function clipCameraToWalls(eye, desired, walls, wallHeight, { padding = 0.25 } = {}) {
  let nearest = 1;
  for (const wall of walls) {
    const t = rayHitsWall3D(eye, desired, wall, wallHeight);
    if (t !== null && t < nearest) nearest = t;
  }
  if (nearest >= 1) return { ...desired };
  const dx = desired.x - eye.x;
  const dy = desired.y - eye.y;
  const dz = desired.z - eye.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return { ...eye };
  const t = Math.max(0, nearest - padding / length);
  return { x: eye.x + dx * t, y: eye.y + dy * t, z: eye.z + dz * t };
}

// ---------- line of sight (2D, walls block) ----------

function rayHitsWall(ax, az, bx, bz, wall) {
  // Slab method for segment vs AABB (expanded slightly).
  const pad = 0.05;
  const minX = wall.x - wall.hw - pad;
  const maxX = wall.x + wall.hw + pad;
  const minZ = wall.z - wall.hd - pad;
  const maxZ = wall.z + wall.hd + pad;
  const dx = bx - ax;
  const dz = bz - az;
  let tMin = 0;
  let tMax = 1;
  for (const [p, d, lo, hi] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

export function hasLineOfSight(ax, az, bx, bz, walls, floorY) {
  for (const wall of walls) {
    if (Math.abs(wall.y - floorY) > 1.5) continue;
    if (rayHitsWall(ax, az, bx, bz, wall)) return false;
  }
  return true;
}

// ---------- guards ----------

export function guardCanSeePlayer(guard, player, walls, config) {
  if (Math.abs(guard.y - player.y) > 1.6) return false;
  const dx = player.x - guard.x;
  const dz = player.z - guard.z;
  const dist = Math.hypot(dx, dz);
  const crouchFactor = player.crouch ? 0.62 : 1;
  const range = (player.lightOn ? config.sightRange : config.sightRangeDark) * crouchFactor;
  if (dist > range) return false;
  if (dist > 1.4) {
    const gx = Math.sin(guard.heading);
    const gz = Math.cos(guard.heading);
    const dot = (dx / dist) * gx + (dz / dist) * gz;
    if (dot < config.fovCos) return false;
  }
  return hasLineOfSight(guard.x, guard.z, player.x, player.z, walls, guard.y);
}

export function stepGuard(guard, player, walls, stairs, slabs, config, dt) {
  const sees = guardCanSeePlayer(guard, player, walls, config);
  if (sees) {
    guard.state = "chase";
    guard.alert = Math.min(1, (guard.alert ?? 0) + dt * 2.5);
  } else if (guard.state === "chase") {
    guard.alert = Math.max(0, (guard.alert ?? 0) - dt * 0.4);
    if (guard.alert <= 0) guard.state = "patrol";
  }

  let tx;
  let tz;
  let speed;
  if (guard.state === "chase") {
    tx = player.x;
    tz = player.z;
    speed = config.chaseSpeed;
  } else {
    const wp = guard.waypoints[guard.wpIndex % guard.waypoints.length];
    tx = wp[0];
    tz = wp[1];
    speed = guard.speed;
    if (Math.hypot(tx - guard.x, tz - guard.z) < 0.4) {
      guard.wpIndex = (guard.wpIndex + 1) % guard.waypoints.length;
    }
  }

  const dx = tx - guard.x;
  const dz = tz - guard.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-4) {
    const step = Math.min(speed * dt, dist);
    guard.x += (dx / dist) * step;
    guard.z += (dz / dist) * step;
    guard.heading = Math.atan2(dx, dz);
  }
  guard.y = groundHeightAt(guard.x, guard.z, guard.y, slabs, stairs);
  return dist <= config.catchDist && guard.state === "chase";
}

// ---------- treasure grab ----------

// Nearest collectible within reach and roughly inside the flashlight cone.
export function findGrabbable(player, treasures, config) {
  let best = null;
  let bestDist = Infinity;
  const fx = -Math.sin(player.yaw) * Math.cos(player.pitch);
  const fy = Math.sin(player.pitch);
  const fz = -Math.cos(player.yaw) * Math.cos(player.pitch);
  for (const treasure of treasures) {
    if (treasure.collected) continue;
    const dx = treasure.x - player.x;
    const dy = treasure.y + 0.5 - (player.y + 1.5);
    const dz = treasure.z - player.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > config.grabRange || dist >= bestDist) continue;
    const dot = dist > 1e-4 ? (dx * fx + dy * fy + dz * fz) / dist : 1;
    if (dot < config.grabConeCos && dist > 1.0) continue;
    best = treasure;
    bestDist = dist;
  }
  return best;
}
