// Castle layout: three floors, hand-authored. All units in meters.
// Walls are AABBs {x, z, hw, hd} centered at x,z with y range per floor.
// Coordinates: x = east, z = south. Entrance on south side of floor 0.

export const FLOOR_HEIGHT = 3.3;
export const FLOOR_COUNT = 3;
export const WALL_HEIGHT = 3.2;
export const CASTLE_HALF_X = 12;
export const CASTLE_HALF_Z = 9;

export const ENTRANCE = { x: 0, z: 8.2 };

// Outer walls per floor (with a door gap on the south wall of floor 0).
function outerWalls(floor) {
  const y = floor * FLOOR_HEIGHT;
  const t = 0.4;
  const walls = [
    { x: 0, z: -CASTLE_HALF_Z, hw: CASTLE_HALF_X, hd: t, y },
    { x: -CASTLE_HALF_X, z: 0, hw: t, hd: CASTLE_HALF_Z, y },
    { x: CASTLE_HALF_X, z: 0, hw: t, hd: CASTLE_HALF_Z, y },
  ];
  if (floor === 0) {
    walls.push(
      { x: -7, z: CASTLE_HALF_Z, hw: 5, hd: t, y },
      { x: 7, z: CASTLE_HALF_Z, hw: 5, hd: t, y },
    );
  } else {
    walls.push({ x: 0, z: CASTLE_HALF_Z, hw: CASTLE_HALF_X, hd: t, y });
  }
  return walls;
}

// Floor 0: great hall + two side rooms, door gaps facing the hall.
const floor0Rooms = [
  { x: -8, z: -4.6, hw: 4, hd: 0.35, y: 0 },   // west room south wall
  { x: -4.6, z: -5.5, hw: 0.35, hd: 3.5, y: 0 }, // west room east wall
  { x: 8, z: -4.6, hw: 4, hd: 0.35, y: 0 },   // east room south wall
  { x: 4.6, z: -5.5, hw: 0.35, hd: 3.5, y: 0 }, // east room west wall
];

// Floor 1: ring corridor with four rooms around a central void over the hall.
const f1y = FLOOR_HEIGHT;
const floor1Rooms = [
  { x: -6.5, z: 0, hw: 0.35, hd: 6, y: f1y },
  { x: 6.5, z: 0, hw: 0.35, hd: 6, y: f1y },
  { x: 0, z: -4.5, hw: 6.5, hd: 0.35, y: f1y },
  { x: -3.5, z: 4.5, hw: 3, hd: 0.35, y: f1y },
  { x: 3.5, z: 4.5, hw: 3, hd: 0.35, y: f1y },
];

// Floor 2 (tower level): small treasure vault at the center.
const f2y = FLOOR_HEIGHT * 2;
const floor2Rooms = [
  { x: -3, z: -3, hw: 3, hd: 0.35, y: f2y },
  { x: -4.5, z: 0, hw: 0.35, hd: 3.3, y: f2y },
  { x: 3, z: -3, hw: 3, hd: 0.35, y: f2y },
  { x: 4.5, z: 0.6, hw: 0.35, hd: 3.9, y: f2y },
  { x: -3, z: 3, hw: 3.35, hd: 0.35, y: f2y },
  { x: 3, z: 3, hw: 3.35, hd: 0.35, y: f2y },
];

export const WALLS = [
  ...outerWalls(0), ...outerWalls(1), ...outerWalls(2),
  ...floor0Rooms, ...floor1Rooms, ...floor2Rooms,
];

// Staircase in the east wing, connecting all floors.
export const STAIRS = [
  { x0: 8.2, z0: 6.4, x1: 10.8, z1: 2.0, fromY: 0, toY: FLOOR_HEIGHT },
  { x0: 8.2, z0: -6.4, x1: 10.8, z1: -2.0, fromY: FLOOR_HEIGHT, toY: FLOOR_HEIGHT * 2 },
];

// Pillar rows in the great hall.
export const PILLARS = [];
for (const x of [-4, 0, 4]) {
  for (const z of [-2, 2]) PILLARS.push({ x, z, y: 0, r: 0.55 });
}

// Floor slabs. Upper floors have openings cut above each staircase so the
// stairs pass through (otherwise you clip up through the ceiling and the
// solid slab keeps you from ever walking back down).
export const SLABS = [
  { y: 0, x0: -CASTLE_HALF_X, z0: -CASTLE_HALF_Z, x1: CASTLE_HALF_X, z1: CASTLE_HALF_Z },
  // Floor 1: opening over stairs 1 (x 8.2..10.8, z 2.0..6.4)
  { y: FLOOR_HEIGHT, x0: -CASTLE_HALF_X, z0: -CASTLE_HALF_Z, x1: 8.2, z1: CASTLE_HALF_Z },
  { y: FLOOR_HEIGHT, x0: 8.2, z0: 6.4, x1: CASTLE_HALF_X, z1: CASTLE_HALF_Z },
  { y: FLOOR_HEIGHT, x0: 8.2, z0: -CASTLE_HALF_Z, x1: CASTLE_HALF_X, z1: 2.0 },
  { y: FLOOR_HEIGHT, x0: 10.8, z0: 2.0, x1: CASTLE_HALF_X, z1: 6.4 },
  // Floor 2: opening over stairs 2 (x 8.2..10.8, z -6.4..-2.0)
  { y: FLOOR_HEIGHT * 2, x0: -CASTLE_HALF_X, z0: -CASTLE_HALF_Z, x1: 8.2, z1: CASTLE_HALF_Z },
  { y: FLOOR_HEIGHT * 2, x0: 8.2, z0: -2.0, x1: CASTLE_HALF_X, z1: CASTLE_HALF_Z },
  { y: FLOOR_HEIGHT * 2, x0: 8.2, z0: -CASTLE_HALF_Z, x1: CASTLE_HALF_X, z1: -6.4 },
  { y: FLOOR_HEIGHT * 2, x0: 10.8, z0: -6.4, x1: CASTLE_HALF_X, z1: -2.0 },
];

export const TREASURES = [
  { id: "t0", x: -8, z: -6.5, y: 0, value: 1 },
  { id: "t1", x: 8, z: -6.5, y: 0, value: 1 },
  { id: "t2", x: -10.5, z: 5, y: 0, value: 1 },
  { id: "t3", x: 0, z: -7.5, y: 0, value: 1 },
  { id: "t4", x: -10, z: -7, y: FLOOR_HEIGHT, value: 2 },
  { id: "t5", x: 10, z: 7, y: FLOOR_HEIGHT, value: 2 },
  { id: "t6", x: -3, z: 7, y: FLOOR_HEIGHT, value: 2 },
  { id: "t7", x: 0, z: -7.8, y: FLOOR_HEIGHT, value: 2 },
  { id: "t8", x: 0, z: 0, y: FLOOR_HEIGHT * 2, value: 4 },
  { id: "t9", x: -2.5, z: 1.5, y: FLOOR_HEIGHT * 2, value: 3 },
  { id: "t10", x: 2.5, z: 1.5, y: FLOOR_HEIGHT * 2, value: 3 },
  { id: "t11", x: -10.5, z: 0, y: FLOOR_HEIGHT * 2, value: 3 },
];

// Guard patrol routes (waypoints loop). Two guards: hall + upper corridor.
export const GUARDS = [
  { id: "g0", waypoints: [[-6, 4], [6, 4], [6, -3], [-6, -3]], floorY: 0, speed: 1.6 },
  { id: "g1", waypoints: [[-8, 6.5], [8, 6.5], [8, -6.5], [-8, -6.5]], floorY: FLOOR_HEIGHT, speed: 1.7 },
];

export const GUARD_SIGHT_RANGE = 7;
export const GUARD_SIGHT_RANGE_DARK = 3.2;
export const GUARD_FOV_COS = Math.cos((70 * Math.PI) / 360);
export const GUARD_CATCH_DIST = 1.0;
export const GUARD_CHASE_SPEED = 2.9;
export const PLAYER_SPEED = 4.2;
export const PLAYER_CROUCH_SPEED = 2.1;
export const PLAYER_RADIUS = 0.35;
export const GRAB_RANGE = 2.4;
export const GRAB_CONE_COS = Math.cos((35 * Math.PI) / 180);
