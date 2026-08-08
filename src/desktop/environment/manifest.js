const TASK_IDS = Object.freeze([
  "exit-door",
  "found-phone",
  "fuse",
  "panel",
  "shadow-window",
  "washbasin",
]);

const LIGHT_ROLES = new Set(["moon", "storm", "power-sequence", "emergency", "practical"]);
const LOCAL_CHUNK_PREFIX = "/assets/environment/elderboom-v1/chunks/";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[A-F0-9]{64}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function invalid(path, message) {
  throw new TypeError(`Invalid environment manifest at ${path}: ${message}`);
}

function exactObject(value, path, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "expected an object");
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${path}.${key}`, "unknown key");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, "missing key");
  }
  return value;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "expected a finite number");
  return value;
}

function positiveNumber(value, path) {
  const number = finiteNumber(value, path);
  if (number <= 0) invalid(path, "expected a positive number");
  return number;
}

function nonNegativeNumber(value, path) {
  const number = finiteNumber(value, path);
  if (number < 0) invalid(path, "expected a non-negative number");
  return number;
}

function identifier(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) invalid(path, "expected a kebab-case identifier");
  return value;
}

function color(value, path) {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) invalid(path, "expected a six-digit hex color");
  return value.toLowerCase();
}

function vector(value, length, path) {
  if (!Array.isArray(value) || value.length !== length) invalid(path, `expected a ${length}-component vector`);
  return value.map((entry, index) => finiteNumber(entry, `${path}[${index}]`));
}

function unitVector(value, path) {
  const result = vector(value, 3, path);
  const magnitude = Math.hypot(...result);
  if (Math.abs(magnitude - 1) > 1e-6) invalid(path, "expected a unit vector");
  return result;
}

function quaternion(value, path) {
  const result = vector(value, 4, path);
  const magnitude = Math.hypot(...result);
  if (magnitude <= 1e-9) invalid(path, "expected a non-zero quaternion");
  return result.map((entry) => entry / magnitude);
}

function transform(value, path) {
  exactObject(value, path, ["position", "rotation", "scale"]);
  const scale = vector(value.scale, 3, `${path}.scale`);
  if (scale.some((entry) => entry <= 0)) invalid(`${path}.scale`, "components must be positive");
  return {
    position: vector(value.position, 3, `${path}.position`),
    rotation: quaternion(value.rotation, `${path}.rotation`),
    scale,
  };
}

function bounds(value, path) {
  exactObject(value, path, ["min", "max"]);
  const min = vector(value.min, 3, `${path}.min`);
  const max = vector(value.max, 3, `${path}.max`);
  if (min.some((entry, index) => entry >= max[index])) invalid(path, "min must be less than max on every axis");
  return { min, max };
}

function assertInside(position, area, path) {
  if (position.some((entry, axis) => entry < area.min[axis] || entry > area.max[axis])) {
    invalid(path, "position is outside playableBounds");
  }
}

function uniqueIds(entries, path) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) invalid(path, `duplicate id ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
}

function chunkUrl(value, path) {
  if (typeof value !== "string") invalid(path, "expected a URL string");
  if (
    !value.startsWith(LOCAL_CHUNK_PREFIX)
    || !/^\/assets\/environment\/elderboom-v1\/chunks\/[A-Za-z0-9][A-Za-z0-9._-]*\.glb$/.test(value)
    || value.includes("..")
    || value.includes("\\")
  ) invalid(path, `must be a local GLB under ${LOCAL_CHUNK_PREFIX}`);
  return value;
}

function artifact(value, path) {
  exactObject(value, path, ["bytes", "sha256"]);
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) invalid(`${path}.bytes`, "expected a positive safe integer");
  const sha256 = String(value.sha256 ?? "").toUpperCase();
  if (!SHA256_PATTERN.test(sha256)) invalid(`${path}.sha256`, "expected a SHA-256 digest");
  return { bytes: value.bytes, sha256 };
}

function chunk(value, path) {
  exactObject(value, path, ["id", "url", "required", "artifact", "bounds", "castShadowNamePrefixes"]);
  if (typeof value.required !== "boolean") invalid(`${path}.required`, "expected a boolean");
  if (!Array.isArray(value.castShadowNamePrefixes) || value.castShadowNamePrefixes.length === 0) {
    invalid(`${path}.castShadowNamePrefixes`, "expected at least one node-name prefix");
  }
  const castShadowNamePrefixes = value.castShadowNamePrefixes.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) invalid(`${path}.castShadowNamePrefixes[${index}]`, "expected a non-empty string");
    return entry;
  });
  if (new Set(castShadowNamePrefixes).size !== castShadowNamePrefixes.length) {
    invalid(`${path}.castShadowNamePrefixes`, "expected unique prefixes");
  }
  return {
    id: identifier(value.id, `${path}.id`),
    url: chunkUrl(value.url, `${path}.url`),
    required: value.required,
    artifact: artifact(value.artifact, `${path}.artifact`),
    bounds: bounds(value.bounds, `${path}.bounds`),
    castShadowNamePrefixes,
  };
}

function collider(value, path) {
  exactObject(value, path, ["id", "shape", "position", "rotation"], ["halfExtents", "radius", "halfHeight"]);
  const common = {
    id: identifier(value.id, `${path}.id`),
    shape: value.shape,
    position: vector(value.position, 3, `${path}.position`),
    rotation: quaternion(value.rotation, `${path}.rotation`),
  };
  if (value.shape === "box") {
    if (!Object.hasOwn(value, "halfExtents") || Object.hasOwn(value, "radius") || Object.hasOwn(value, "halfHeight")) {
      invalid(path, "box colliders require only halfExtents");
    }
    const halfExtents = vector(value.halfExtents, 3, `${path}.halfExtents`);
    if (halfExtents.some((entry) => entry <= 0)) invalid(`${path}.halfExtents`, "components must be positive");
    return { ...common, halfExtents };
  }
  if (value.shape === "capsule") {
    if (!Object.hasOwn(value, "radius") || !Object.hasOwn(value, "halfHeight") || Object.hasOwn(value, "halfExtents")) {
      invalid(path, "capsule colliders require only radius and halfHeight");
    }
    return {
      ...common,
      radius: positiveNumber(value.radius, `${path}.radius`),
      halfHeight: positiveNumber(value.halfHeight, `${path}.halfHeight`),
    };
  }
  invalid(`${path}.shape`, "expected box or capsule");
}

function occluder(value, path) {
  exactObject(value, path, ["id", "colliderId"]);
  return {
    id: identifier(value.id, `${path}.id`),
    colliderId: identifier(value.colliderId, `${path}.colliderId`),
  };
}

function light(value, path) {
  exactObject(
    value,
    path,
    ["id", "role", "type", "intensity"],
    ["color", "skyColor", "groundColor", "position", "target", "distance", "decay", "castShadow"],
  );
  const common = {
    id: identifier(value.id, `${path}.id`),
    role: value.role,
    type: value.type,
    intensity: nonNegativeNumber(value.intensity, `${path}.intensity`),
  };
  if (!LIGHT_ROLES.has(value.role)) invalid(`${path}.role`, "unknown semantic role");
  if (value.type === "hemisphere") {
    exactObject(value, path, ["id", "role", "type", "intensity", "skyColor", "groundColor"]);
    return {
      ...common,
      skyColor: color(value.skyColor, `${path}.skyColor`),
      groundColor: color(value.groundColor, `${path}.groundColor`),
    };
  }
  if (value.type === "directional") {
    exactObject(value, path, ["id", "role", "type", "intensity", "color", "position", "target", "castShadow"]);
    if (typeof value.castShadow !== "boolean") invalid(`${path}.castShadow`, "expected a boolean");
    return {
      ...common,
      color: color(value.color, `${path}.color`),
      position: vector(value.position, 3, `${path}.position`),
      target: vector(value.target, 3, `${path}.target`),
      castShadow: value.castShadow,
    };
  }
  if (value.type === "point") {
    exactObject(value, path, ["id", "role", "type", "intensity", "color", "position", "distance", "decay", "castShadow"]);
    if (typeof value.castShadow !== "boolean") invalid(`${path}.castShadow`, "expected a boolean");
    return {
      ...common,
      color: color(value.color, `${path}.color`),
      position: vector(value.position, 3, `${path}.position`),
      distance: positiveNumber(value.distance, `${path}.distance`),
      decay: positiveNumber(value.decay, `${path}.decay`),
      castShadow: value.castShadow,
    };
  }
  invalid(`${path}.type`, "expected hemisphere, directional, or point");
}

function standardTask(value, path) {
  exactObject(value, path, ["position", "rotationY", "contactNormal", "approachDirection", "maxUseDistance"]);
  return {
    position: vector(value.position, 3, `${path}.position`),
    rotationY: finiteNumber(value.rotationY, `${path}.rotationY`),
    contactNormal: unitVector(value.contactNormal, `${path}.contactNormal`),
    approachDirection: value.approachDirection === null
      ? null
      : unitVector(value.approachDirection, `${path}.approachDirection`),
    maxUseDistance: positiveNumber(value.maxUseDistance, `${path}.maxUseDistance`),
  };
}

function exitDoorTask(value, path) {
  exactObject(value, path, ["position", "rotationY", "triggerPosition", "inwardNormal"]);
  return {
    position: vector(value.position, 3, `${path}.position`),
    rotationY: finiteNumber(value.rotationY, `${path}.rotationY`),
    triggerPosition: vector(value.triggerPosition, 3, `${path}.triggerPosition`),
    inwardNormal: unitVector(value.inwardNormal, `${path}.inwardNormal`),
  };
}

function taskMap(value, playableBounds, path) {
  exactObject(value, path, TASK_IDS);
  const tasks = {};
  for (const id of TASK_IDS) {
    const taskPath = `${path}.${id}`;
    tasks[id] = id === "exit-door" ? exitDoorTask(value[id], taskPath) : standardTask(value[id], taskPath);
    assertInside(tasks[id].position, playableBounds, `${taskPath}.position`);
    if (id === "exit-door") assertInside(tasks[id].triggerPosition, playableBounds, `${taskPath}.triggerPosition`);
  }
  return tasks;
}

function atmosphere(value, path) {
  exactObject(value, path, ["background", "fog"]);
  exactObject(value.fog, `${path}.fog`, ["color", "near", "far"]);
  const near = nonNegativeNumber(value.fog.near, `${path}.fog.near`);
  const far = positiveNumber(value.fog.far, `${path}.fog.far`);
  if (near >= far) invalid(`${path}.fog`, "near must be less than far");
  return {
    background: color(value.background, `${path}.background`),
    fog: { color: color(value.fog.color, `${path}.fog.color`), near, far },
  };
}

function story(value, playableBounds, path) {
  exactObject(value, path, ["firstReveal", "pursuitSpawn", "pursuitTargetOffset"]);
  const result = {
    firstReveal: vector(value.firstReveal, 3, `${path}.firstReveal`),
    pursuitSpawn: vector(value.pursuitSpawn, 3, `${path}.pursuitSpawn`),
    pursuitTargetOffset: vector(value.pursuitTargetOffset, 3, `${path}.pursuitTargetOffset`),
  };
  assertInside(result.firstReveal, playableBounds, `${path}.firstReveal`);
  assertInside(result.pursuitSpawn, playableBounds, `${path}.pursuitSpawn`);
  return result;
}

function shadow(value, playableBounds, path) {
  exactObject(value, path, ["peekPosition", "peekTarget", "figureStart", "figureTravel", "doorStart", "doorTravel"]);
  const result = {
    peekPosition: vector(value.peekPosition, 3, `${path}.peekPosition`),
    peekTarget: vector(value.peekTarget, 3, `${path}.peekTarget`),
    figureStart: vector(value.figureStart, 3, `${path}.figureStart`),
    figureTravel: vector(value.figureTravel, 3, `${path}.figureTravel`),
    doorStart: vector(value.doorStart, 3, `${path}.doorStart`),
    doorTravel: vector(value.doorTravel, 3, `${path}.doorTravel`),
  };
  for (const key of ["peekPosition", "peekTarget", "figureStart", "doorStart"]) {
    assertInside(result[key], playableBounds, `${path}.${key}`);
  }
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateEnvironmentManifest(value) {
  exactObject(value, "manifest", [
    "id",
    "version",
    "coordinateSpace",
    "chunks",
    "rootTransform",
    "spawn",
    "playableBounds",
    "atmosphere",
    "colliders",
    "occluders",
    "lights",
    "tasks",
    "story",
    "shadow",
  ]);
  if (value.id !== "elderboom-v1") invalid("manifest.id", "expected elderboom-v1");
  if (value.version !== 1) invalid("manifest.version", "expected version 1");
  if (value.coordinateSpace !== "game") invalid("manifest.coordinateSpace", "expected game");
  if (!Array.isArray(value.chunks) || value.chunks.length !== 1) invalid("manifest.chunks", "expected exactly one chunk");
  if (!Array.isArray(value.colliders) || value.colliders.length === 0) invalid("manifest.colliders", "expected colliders");
  if (!Array.isArray(value.occluders)) invalid("manifest.occluders", "expected an array");
  if (!Array.isArray(value.lights) || value.lights.length === 0) invalid("manifest.lights", "expected lights");

  const playable = bounds(value.playableBounds, "manifest.playableBounds");
  exactObject(value.spawn, "manifest.spawn", ["position", "yaw"]);
  const spawn = {
    position: vector(value.spawn.position, 3, "manifest.spawn.position"),
    yaw: finiteNumber(value.spawn.yaw, "manifest.spawn.yaw"),
  };
  assertInside(spawn.position, playable, "manifest.spawn.position");

  const chunks = value.chunks.map((entry, index) => chunk(entry, `manifest.chunks[${index}]`));
  uniqueIds(chunks, "manifest.chunks");
  const colliders = value.colliders.map((entry, index) => collider(entry, `manifest.colliders[${index}]`));
  const colliderIds = uniqueIds(colliders, "manifest.colliders");
  const colliderById = new Map(colliders.map((entry) => [entry.id, entry]));
  const occluders = value.occluders.map((entry, index) => occluder(entry, `manifest.occluders[${index}]`));
  uniqueIds(occluders, "manifest.occluders");
  for (const entry of occluders) {
    if (!colliderIds.has(entry.colliderId)) invalid("manifest.occluders", `unknown collider ${entry.colliderId}`);
    if (colliderById.get(entry.colliderId).shape !== "box") invalid("manifest.occluders", "occluders must reference box colliders");
  }
  const lights = value.lights.map((entry, index) => light(entry, `manifest.lights[${index}]`));
  uniqueIds(lights, "manifest.lights");
  for (const role of LIGHT_ROLES) {
    if (!lights.some((entry) => entry.role === role)) invalid("manifest.lights", `missing semantic role ${role}`);
  }

  return deepFreeze({
    id: value.id,
    version: value.version,
    coordinateSpace: value.coordinateSpace,
    chunks,
    rootTransform: transform(value.rootTransform, "manifest.rootTransform"),
    spawn,
    playableBounds: playable,
    atmosphere: atmosphere(value.atmosphere, "manifest.atmosphere"),
    colliders,
    occluders,
    lights,
    tasks: taskMap(value.tasks, playable, "manifest.tasks"),
    story: story(value.story, playable, "manifest.story"),
    shadow: shadow(value.shadow, playable, "manifest.shadow"),
  });
}

export { TASK_IDS as ENVIRONMENT_TASK_IDS };
