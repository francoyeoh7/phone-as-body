const WIDTH = 6.4;
const HALF_WIDTH = WIDTH / 2;
const HEIGHT = 3.6;
const FLOOR_THICKNESS = 0.3;
const CEILING_THICKNESS = 0.3;
const DOOR_YAW = -Math.PI / 2;

const MAIN_BOUNDS = Object.freeze({ minX: -HALF_WIDTH, maxX: HALF_WIDTH, minZ: -32.8, maxZ: 3.2 });
const WING_BOUNDS = Object.freeze({ minX: HALF_WIDTH, maxX: 23.2, minZ: -32.8, maxZ: -26.4 });

const cloneBounds = (bounds) => ({
  minX: bounds.minX,
  maxX: bounds.maxX,
  minZ: bounds.minZ,
  maxZ: bounds.maxZ,
});

const center = (min, max) => (min + max) / 2;

function volume(id, bounds, y, height, segment) {
  return {
    id,
    segment,
    bounds: cloneBounds(bounds),
    position: [center(bounds.minX, bounds.maxX), y, center(bounds.minZ, bounds.maxZ)],
    size: [bounds.maxX - bounds.minX, height, bounds.maxZ - bounds.minZ],
  };
}

function wall(id, bounds, height = HEIGHT, y = HEIGHT / 2, segment = "main", options = {}) {
  const entry = {
    id,
    segment,
    bounds: cloneBounds(bounds),
    position: [center(bounds.minX, bounds.maxX), y, center(bounds.minZ, bounds.maxZ)],
    size: [
      Math.max(0.3, bounds.maxX - bounds.minX),
      height,
      Math.max(0.3, bounds.maxZ - bounds.minZ),
    ],
    thickness: options.thickness ?? 0.3,
    halfExtents: options.halfExtents ?? null,
    render: options.render !== false,
    collider: options.collider !== false,
    kind: options.kind ?? "perimeter",
  };
  if (options.size) entry.size = options.size.slice();
  if (options.position) entry.position = options.position.slice();
  if (options.rotationY) entry.rotationY = options.rotationY;
  return entry;
}

function perimeterWall(id, orientation, min, max, fixed, segment, options = {}) {
  const thickness = options.thickness ?? 0.3;
  const half = thickness / 2;
  const bounds = orientation === "vertical"
    ? { minX: fixed - half, maxX: fixed + half, minZ: min, maxZ: max }
    : { minX: min, maxX: max, minZ: fixed - half, maxZ: fixed + half };
  const entry = wall(id, bounds, options.height ?? HEIGHT, options.y ?? HEIGHT / 2, segment, options);
  entry.orientation = orientation;
  entry.axisRange = [min, max];
  entry.fixed = fixed;
  entry.boundary = { orientation, min, max, fixed };
  entry.size = orientation === "vertical"
    ? [thickness, options.height ?? HEIGHT, max - min]
    : [max - min, options.height ?? HEIGHT, thickness];
  entry.position = orientation === "vertical"
    ? [fixed, options.y ?? HEIGHT / 2, center(min, max)]
    : [center(min, max), options.y ?? HEIGHT / 2, fixed];
  entry.halfExtents = [entry.size[0] / 2, entry.size[1] / 2, entry.size[2] / 2];
  return entry;
}

function makeAnchors() {
  const anchors = {
    spawn: [0, 1.05, 1.2],
    turn: { x: HALF_WIDTH, y: 0, z: WING_BOUNDS.maxZ },
    foundPhone: { position: [-1.2, 0.07, -11.4] },
    washbasin: {
      position: [1.75, 1.1, -5.2],
      colliderPosition: [2.1, 0.62, -5.2],
      colliderHalfExtents: [0.55, 0.62, 0.72],
    },
    fuse: { position: [-1.78, 1.25, -8.6] },
    panel: { position: [2.35, 1.36, -15.6], rotationY: Math.PI / 2 },
    shadowWindow: {
      position: [-3.05, 1.9, -14.4],
      taskPoint: [-2.93, 1.95, -13.92],
      peekPosition: [-2.63, 1.92, -14.18],
      peekTarget: [-6.6, 1.42, -13.45],
      figure: [-6.62, 1.22, -16.4],
      wallX: -3.2,
    },
    exitDoor: {
      position: [23, 0, -29.6],
      rotationY: DOOR_YAW,
      inwardNormal: [-1, 0, 0],
      triggerPosition: [20.82, 1.05, -29.6],
      colliderPosition: [22.82, 1.44, -29.6],
    },
  };
  anchors.turnPosition = [HALF_WIDTH, 0, WING_BOUNDS.maxZ];
  anchors.exit = anchors.exitDoor;
  anchors.shadowWindowTaskPoint = anchors.shadowWindow.taskPoint.slice();
  return anchors;
}

function makeLights() {
  const lights = [];
  [-1, -6, -11, -16, -21, -26].forEach((z, index) => {
    lights.push({
      id: `main-ceiling-${index + 1}`,
      segment: "main",
      type: "point",
      kind: "ceiling",
      position: [0, 3.05, z],
      fixturePosition: [0, 3.37, z],
      color: 0x9aa990,
      intensity: 0.8,
      distance: 7,
      decay: 2.1,
    });
  });
  [-3.2, -13.2, -23.2].forEach((z, index) => {
    lights.push({
      id: `main-emergency-${index + 1}`,
      segment: "main",
      type: "point",
      kind: "emergency",
      position: [0, 2.6, z],
      color: 0xb24c36,
      intensity: 0.86,
      distance: 9,
      decay: 2,
    });
  });
  // Keep the bend readable while limiting the wing to three point lights.
  [8.2, 14.2, 20.2].forEach((x, index) => {
    lights.push({
      id: `wing-ceiling-${index + 1}`,
      segment: "wing",
      type: "point",
      kind: "ceiling",
      position: [x, 3.05, -29.6],
      fixturePosition: [x, 3.37, -29.6],
      color: 0x9aa990,
      intensity: 0.72,
      distance: 7,
      decay: 2.1,
    });
  });
  return lights;
}

export function createCorridorLayout() {
  const main = {
    id: "main",
    bounds: cloneBounds(MAIN_BOUNDS),
    center: [0, 0, center(MAIN_BOUNDS.minZ, MAIN_BOUNDS.maxZ)],
    size: [WIDTH, HEIGHT, MAIN_BOUNDS.maxZ - MAIN_BOUNDS.minZ],
  };
  const wing = {
    id: "wing",
    bounds: cloneBounds(WING_BOUNDS),
    center: [center(WING_BOUNDS.minX, WING_BOUNDS.maxX), 0, center(WING_BOUNDS.minZ, WING_BOUNDS.maxZ)],
    size: [WING_BOUNDS.maxX - WING_BOUNDS.minX, HEIGHT, WIDTH],
  };

  const floors = [
    volume("main-floor", MAIN_BOUNDS, -FLOOR_THICKNESS / 2, FLOOR_THICKNESS, "main"),
    volume("wing-floor", WING_BOUNDS, -FLOOR_THICKNESS / 2, FLOOR_THICKNESS, "wing"),
  ];
  const ceilings = [
    volume("main-ceiling", MAIN_BOUNDS, HEIGHT + CEILING_THICKNESS / 2, CEILING_THICKNESS, "main"),
    volume("wing-ceiling", WING_BOUNDS, HEIGHT + CEILING_THICKNESS / 2, CEILING_THICKNESS, "wing"),
  ];

  const walls = [
    // The left wall is split around the observation window so its sightline remains open.
    perimeterWall("main-left",  "vertical", -13.25, 3.2, -HALF_WIDTH, "main"),
    perimeterWall("main-left-window-lower", "vertical", -15.55, -13.25, -HALF_WIDTH, "main", {
      height: 1.225,
      y: 0.6125,
    }),
    perimeterWall("main-left-window-upper", "vertical", -15.55, -13.25, -HALF_WIDTH, "main", {
      height: 0.825,
      y: 3.1875,
    }),
    perimeterWall("main-left-after-window", "vertical", -32.8, -15.55, -HALF_WIDTH, "main"),
    perimeterWall("main-right-before-turn", "vertical", -26.4, 3.2, HALF_WIDTH, "main"),
    perimeterWall("main-front", "horizontal", -HALF_WIDTH, HALF_WIDTH, 3.2, "main"),
    perimeterWall("main-south", "horizontal", -HALF_WIDTH, HALF_WIDTH, -32.8, "main"),
    perimeterWall("wing-north", "horizontal", HALF_WIDTH, 23.2, -26.4, "wing"),
    perimeterWall("wing-south", "horizontal", HALF_WIDTH, 23.2, -32.8, "wing"),
    // The endpoint door occupies the middle of the east perimeter; its fixed body
    // closes the opening while the two short wall segments close the remainder.
    perimeterWall("wing-end", "vertical", -32.8, -30.95, 23.2, "wing"),
    perimeterWall("wing-end-upper", "vertical", -28.25, -26.4, 23.2, "wing"),
  ];

  const colliders = [
    ...floors.map((entry) => ({
      id: entry.id,
      type: "floor",
      segment: entry.segment,
      position: entry.position.slice(),
      halfExtents: entry.size.map((value) => value / 2),
    })),
    ...ceilings.map((entry) => ({
      id: entry.id,
      type: "ceiling",
      segment: entry.segment,
      position: entry.position.slice(),
      halfExtents: entry.size.map((value) => value / 2),
    })),
    ...walls.filter((entry) => entry.collider).map((entry) => ({
      id: entry.id,
      type: "wall",
      segment: entry.segment,
      position: entry.position.slice(),
      halfExtents: entry.halfExtents.slice(),
      rotationY: entry.rotationY ?? 0,
    })),
    {
      id: "washbasin",
      type: "obstacle",
      segment: "main",
      position: [2.1, 0.62, -5.2],
      halfExtents: [0.55, 0.62, 0.72],
    },
  ];
  const anchors = makeAnchors();
  const door = {
    ...anchors.exitDoor,
    collider: {
      position: anchors.exitDoor.colliderPosition.slice(),
      halfExtents: [1.2, 1.44, 0.14],
      rotationY: DOOR_YAW,
      quaternion: [0, Math.sin(DOOR_YAW / 2), 0, Math.cos(DOOR_YAW / 2)],
    },
  };
  const layout = {
    width: WIDTH,
    height: HEIGHT,
    floorThickness: FLOOR_THICKNESS,
    ceilingThickness: CEILING_THICKNESS,
    turnAngle: 90,
    turn: { x: HALF_WIDTH, y: 0, z: WING_BOUNDS.maxZ },
    turnAnchor: [HALF_WIDTH, 0, WING_BOUNDS.maxZ],
    main,
    wing,
    floors,
    ceilings,
    walls,
    colliders,
    lights: makeLights(),
    door,
    anchors,
  };
  layout.mainLeg = layout.main;
  layout.wingLeg = layout.wing;
  layout.segmentBounds = { main: cloneBounds(MAIN_BOUNDS), wing: cloneBounds(WING_BOUNDS) };
  layout.renderVolumes = { floors: layout.floors, ceilings: layout.ceilings, walls: layout.walls };
  layout.fixedColliders = layout.colliders;
  layout.isWalkable = (x, z, margin = 0) => {
    const inset = Math.max(0, Number(margin) || 0);
    const inMain = x >= MAIN_BOUNDS.minX + inset
      && x <= MAIN_BOUNDS.maxX - inset
      && z >= MAIN_BOUNDS.minZ + inset
      && z <= MAIN_BOUNDS.maxZ - inset;
    const inWing = x >= WING_BOUNDS.minX + inset
      && x <= WING_BOUNDS.maxX - inset
      && z >= WING_BOUNDS.minZ + inset
      && z <= WING_BOUNDS.maxZ - inset;
    return inMain || inWing;
  };
  layout.containsPoint = layout.isWalkable;
  return layout;
}

export const CORRIDOR_WIDTH = WIDTH;
export const CORRIDOR_HEIGHT = HEIGHT;
export const CORRIDOR_MAIN_BOUNDS = MAIN_BOUNDS;
export const CORRIDOR_WING_BOUNDS = WING_BOUNDS;
