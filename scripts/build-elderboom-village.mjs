import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Matrix4, Quaternion, Vector3 } from "three";
import { validateEnvironmentManifest } from "../src/desktop/environment/manifest.js";
import {
  ELDERBOOM_V1_CONFIG,
  assertExpectedSourceHash,
  villageGatesForQuality,
  villageQualityProfile,
} from "./environment/elderboom-v1.config.mjs";
import { collectDocumentReferences, nodeWorldBounds, walkNodeWorldTransforms } from "./environment/glb-graph.mjs";
import { readGlbDocument } from "./environment/glb-io.mjs";
import { inspectRuntimeTextures, optimizeVillageTextures } from "./environment/optimize-village-textures.mjs";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const COPY_BUFFER_BYTES = 1024 * 1024;

const align4 = (value) => (value + 3) & ~3;
const intersects = (bounds, selection) => bounds && [0, 1, 2].every(
  (axis) => bounds.max[axis] >= selection.min[axis] && bounds.min[axis] <= selection.max[axis],
);
const ordered = (set) => [...set].sort((a, b) => a - b);

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

function parentIndices(json) {
  const parents = new Map();
  for (let index = 0; index < (json.nodes?.length ?? 0); index += 1) {
    for (const child of json.nodes[index]?.children ?? []) parents.set(child, index);
  }
  return parents;
}

// ---------------------------------------------------------------------------
// Architecture colliders. Instanced groupings erase node names at runtime, so
// colliders must be generated here while names are still intact. Meshes become
// oriented boxes (local AABB pushed through the node's world transform), which
// keeps rotated walls tight instead of sealing doorways with world-AABBs.
// ---------------------------------------------------------------------------
const ARCHITECTURE_PATTERN = /wall|door|fence|gate|house|building|modular|well|pillar|beam|stair|arch|barrel|cart|stall|table|bench|anvil|trough|bollard|wheel|gravestone|carafe|wood_pile|chopped|tower|barn|stable|shed|mill|church|roof|plank|timber|stone_wall|crate|wooden/i;
const NON_SOLID_PATTERN = /foliage|leaf|leaves|grass|flower|plant|branch|vine|moss|tree|blackalder|landscape|terrain|cloth|fabric|flag|banner|lantern|candle|fire|smoke|particle/i;
// The hand-authored colliders own the core courtyard; generated pieces only
// fill in the outer village so the authored gameplay route stays clear.
const CORE_COURTYARD = { minX: -18.5, maxX: 18.5, minZ: -19, maxZ: 19 };

export function generateArchitectureColliders(json, selection, config = ELDERBOOM_V1_CONFIG, excludeNearPositions = [], authoredColliders = []) {
  const transforms = selection.worldTransforms ?? walkNodeWorldTransforms(json);
  const rootOffset = config.rootTransform.position;
  const colliders = [];
  const occupied = new Set();
  for (const index of ordered(selection.selectedNodes)) {
    const node = json.nodes[index];
    const name = node.name ?? "";
    if (!Number.isInteger(node?.mesh)) continue;
    if (!ARCHITECTURE_PATTERN.test(name) || NON_SOLID_PATTERN.test(name)) continue;
    // Door/gate frames contain the doorway opening; a solid box would seal it.
    if (/door|gate/i.test(name)) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh) continue;

    // Mesh-local AABB across primitives (accessor bounds are exact).
    let min = null;
    let max = null;
    for (const primitive of mesh.primitives ?? []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      min = min ? min.map((v, axis) => Math.min(v, accessor.min[axis])) : [...accessor.min];
      max = max ? max.map((v, axis) => Math.max(v, accessor.max[axis])) : [...accessor.max];
    }
    if (!min || !max) continue;
    const localSize = max.map((v, axis) => v - min[axis]);
    if (localSize.some((v) => !Number.isFinite(v))) continue;

    const world = transforms.get(index);
    if (!world) continue;
    const position = new Vector3();
    const rotation = new Quaternion();
    const scaleVec = new Vector3();
    world.decompose(position, rotation, scaleVec);
    const worldSize = localSize.map((v, axis) => v * Math.abs(scaleVec.toArray()[axis] ?? 1));
    if (worldSize[1] < 0.25 || Math.max(worldSize[0], worldSize[2]) > 9) continue;
    if (Math.min(worldSize[0], worldSize[2]) < 0.04) continue;
    // Low ruined walls and rubble (< ~1.1 m) sit in walking lanes; blocking
    // them strands the authored route. Real walls/fences are taller.
    if (worldSize[1] < 1.1) continue;

    const localCenter = min.map((v, axis) => (v + max[axis]) / 2);
    const worldCenter = new Vector3(...localCenter).applyMatrix4(world);
    // Inset XZ so collider faces don't nick the walking lanes between pieces.
    const halfExtents = worldSize.map((v, axis) => Math.max(0.04, (v / 2) * (axis === 1 ? 1 : 0.88)));
    const gameCenter = [
      worldCenter.x + rootOffset[0],
      worldCenter.y + rootOffset[1],
      worldCenter.z + rootOffset[2],
    ];
    // Never block task anchors: gameplay needs a clear approach radius. The
    // conservative XZ reach of the box (half-diagonal) + clearance keeps the
    // anchor approachable even for rotated pieces.
    const xzReach = Math.hypot(halfExtents[0], halfExtents[2]);
    if (excludeNearPositions.some((anchor) => {
      const dx = anchor[0] - gameCenter[0];
      const dz = anchor[2] - gameCenter[2];
      const horizontal = Math.hypot(dx, dz);
      return horizontal - xzReach < 1.0;
    })) continue;
    // The hand-authored colliders own the core courtyard (route + doorways).
    if (
      gameCenter[0] > CORE_COURTYARD.minX && gameCenter[0] < CORE_COURTYARD.maxX
      && gameCenter[2] > CORE_COURTYARD.minZ && gameCenter[2] < CORE_COURTYARD.maxZ
    ) continue;
    // The hand-authored colliders own the core buildings (door-aware). Skip
    // generated pieces that would double-cover or intrude into them.
    if (authoredColliders.some((authored) => {
      const dx = authored.position[0] - gameCenter[0];
      const dz = authored.position[2] - gameCenter[2];
      return dx * dx + dz * dz < 2.2 * 2.2;
    })) continue;
    const key = [
      Math.round(worldCenter.x * 4), Math.round(worldCenter.y * 4), Math.round(worldCenter.z * 4),
      Math.round(halfExtents[0] * 20), Math.round(halfExtents[1] * 20), Math.round(halfExtents[2] * 20),
    ].join(":");
    if (occupied.has(key)) continue;
    occupied.add(key);

    colliders.push({
      id: `arch-${colliders.length}`,
      shape: "box",
      position: [
        +gameCenter[0].toFixed(2),
        +gameCenter[1].toFixed(2),
        +gameCenter[2].toFixed(2),
      ],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w].map((v) => +v.toFixed(4)),
      halfExtents: halfExtents.map((v) => +v.toFixed(3)),
    });
  }
  return colliders;
}

function sceneForRoot(json, nodeIndex) {
  const found = (json.scenes ?? []).findIndex((scene) => scene.nodes?.includes(nodeIndex));
  return found >= 0 ? found : (json.scene ?? 0);
}

function nodeLocalMatrix(node = {}) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
}

function decomposeNode(node) {
  const translation = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  nodeLocalMatrix(node).decompose(translation, rotation, scale);
  return {
    translation: translation.toArray(),
    rotation: rotation.normalize().toArray(),
    scale: scale.toArray(),
  };
}

export function keepDenseFoliage(node, cell, config = ELDERBOOM_V1_CONFIG) {
  const key = `${config.foliage.seed}|${node.index}|${node.name ?? ""}|${cell.x}|${cell.z}`;
  return createHash("sha256").update(key).digest().readUInt32LE(0);
}

export function selectSpatialNodes(json, config = ELDERBOOM_V1_CONFIG) {
  const transforms = walkNodeWorldTransforms(json);
  const selectedNodes = new Set();
  const denseGroups = new Map();
  let meshCandidates = 0;
  let denseFoliageCandidates = 0;
  for (let index = 0; index < (json.nodes?.length ?? 0); index += 1) {
    const node = json.nodes[index];
    if (!Number.isInteger(node?.mesh)) continue;
    if ((config.excludeNamePatterns ?? []).some((pattern) => pattern.test(node.name ?? ""))) continue;
    const world = transforms.get(index);
    if (!intersects(nodeWorldBounds(json, index, world), config.selection.bounds)) continue;
    meshCandidates += 1;
    const dense = (config.foliage?.denseNamePatterns ?? []).some((pattern) => pattern.test(node.name ?? ""));
    if (!dense) {
      selectedNodes.add(index);
      continue;
    }
    denseFoliageCandidates += 1;
    const cellSize = config.foliage.cellSize;
    const cell = {
      x: Math.floor(world.elements[12] / cellSize),
      z: Math.floor(world.elements[14] / cellSize),
    };
    const key = `${node.mesh}|${cell.x}|${cell.z}`;
    const entries = denseGroups.get(key) ?? [];
    entries.push({ index, rank: keepDenseFoliage({ ...node, index }, cell, config) });
    denseGroups.set(key, entries);
  }
  for (const entries of denseGroups.values()) {
    entries.sort((a, b) => a.rank - b.rank || a.index - b.index);
    for (const entry of entries.slice(0, config.foliage.maxInstancesPerMeshPerCell)) selectedNodes.add(entry.index);
  }
  const meshCaps = new Map();
  for (const index of selectedNodes) {
    const node = json.nodes[index];
    if (!(config.foliage?.denseNamePatterns ?? []).some((pattern) => pattern.test(node.name ?? ""))) continue;
    const entries = meshCaps.get(node.mesh) ?? [];
    entries.push({ index, rank: keepDenseFoliage({ ...node, index }, { x: 0, z: 0 }, config) });
    meshCaps.set(node.mesh, entries);
  }
  for (const [mesh, entries] of meshCaps) {
    const triangles = primitiveTriangles(json, mesh);
    const cap = triangles >= (config.foliage.highPolyTriangleThreshold ?? Infinity)
      ? config.foliage.maxHighPolyInstancesPerMesh
      : config.foliage.maxInstancesPerMesh;
    if (!Number.isInteger(cap) || cap < 0 || entries.length <= cap) continue;
    entries.sort((a, b) => a.rank - b.rank || a.index - b.index);
    for (const entry of entries.slice(cap)) selectedNodes.delete(entry.index);
  }
  const denseFoliageRetained = [...selectedNodes].filter((index) => (
    (config.foliage?.denseNamePatterns ?? []).some((pattern) => pattern.test(json.nodes[index]?.name ?? ""))
  )).length;
  return {
    selectedNodes,
    worldTransforms: transforms,
    metrics: { meshCandidates, denseFoliageCandidates, denseFoliageRetained },
  };
}

function mappingFor(set) {
  return new Map(ordered(set).map((sourceIndex, outputIndex) => [sourceIndex, outputIndex]));
}

function mapped(map, index, label, optional = true) {
  if (index === undefined && optional) return undefined;
  const value = map.get(index);
  if (!Number.isInteger(value)) throw new Error(`Missing ${label} mapping for ${index}`);
  return value;
}

function remapTextureInfo(info, textureMap) {
  if (!info || typeof info !== "object") return;
  info.index = mapped(textureMap, info.index, "texture", false);
}

function remapMaterial(material, textureMap) {
  for (const key of ["normalTexture", "occlusionTexture", "emissiveTexture"]) remapTextureInfo(material[key], textureMap);
  for (const key of ["baseColorTexture", "metallicRoughnessTexture"]) {
    remapTextureInfo(material.pbrMetallicRoughness?.[key], textureMap);
  }
  const slots = {
    KHR_materials_specular: ["specularTexture", "specularColorTexture"],
    KHR_materials_sheen: ["sheenColorTexture", "sheenRoughnessTexture"],
    KHR_materials_anisotropy: ["anisotropyTexture"],
  };
  for (const [extension, keys] of Object.entries(slots)) {
    for (const key of keys) remapTextureInfo(material.extensions?.[extension]?.[key], textureMap);
  }
}

const isFactor = (value, expected) => (
  Array.isArray(value)
  && value.length === expected.length
  && value.every((entry, index) => Math.abs(entry - expected[index]) < 1e-6)
);

export function repairVillageMaterials(materials = []) {
  const repairs = { landscape: 0, grass: 0, water: 0, alder: 0 };
  const grassTemplate = materials.find((material) => (
    /^MI_Grass_Clumps_rbojr_2K_/.test(material?.name ?? "")
    && material?.pbrMetallicRoughness?.baseColorTexture
  ));
  const alderTemplates = {
    tileable: materials.find((material) => (
      /^MI_BlackAlder_Tileable_SM_BlackAlder_Field_\d+$/.test(material?.name ?? "")
      && material?.pbrMetallicRoughness?.baseColorTexture
    )),
    twoSided: materials.find((material) => (
      /^MI_BlackAlder_TwoSided_SM_BlackAlder_Field_\d+$/.test(material?.name ?? "")
      && material?.pbrMetallicRoughness?.baseColorTexture
    )),
  };

  const repairBrokenAlder = (material, name, template) => {
    delete material.emissiveFactor;
    if (template) {
      const replacement = structuredClone(template);
      Object.assign(material, replacement, { name });
    } else {
      material.pbrMetallicRoughness = {
        ...material.pbrMetallicRoughness,
        baseColorFactor: [0.16, 0.3, 0.14, 1],
        metallicFactor: 0,
        roughnessFactor: 0.9,
      };
      material.emissiveFactor = [0, 0, 0];
    }
    repairs.alder += 1;
  };

  for (const material of materials) {
    const name = material?.name ?? "";
    const factor = material?.pbrMetallicRoughness?.baseColorFactor;
    if (name === "LAndscapepaint" && isFactor(factor, [0, 0, 0, 1])) {
      material.pbrMetallicRoughness = {
        ...material.pbrMetallicRoughness,
        baseColorFactor: [0.18, 0.24, 0.12, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      };
      repairs.landscape += 1;
      continue;
    }
    if (/^MI_BlackAlder_Tileable_SM_BlackAlder_Field_\d+$/.test(name) && isFactor(factor, [1, 0, 1, 1])) {
      repairBrokenAlder(material, name, alderTemplates.tileable);
      continue;
    }
    if (/^MI_BlackAlder_TwoSided_SM_BlackAlder_Field_\d+$/.test(name) && isFactor(factor, [1, 0, 1, 1])) {
      repairBrokenAlder(material, name, alderTemplates.twoSided);
      continue;
    }
    if (/^MI_Grass_Clumps_rbojr_2K_/.test(name) && isFactor(factor, [1, 0, 1, 1])) {
      delete material.emissiveFactor;
      if (grassTemplate) {
        const replacement = structuredClone(grassTemplate);
        Object.assign(material, replacement, { name });
      } else {
        material.pbrMetallicRoughness.baseColorFactor = [0.2, 0.36, 0.12, 1];
      }
      repairs.grass += 1;
      continue;
    }
    if (/^M_Water_Ocean_Wall_/.test(name) && isFactor(factor, [1, 0, 1, 1])) {
      material.pbrMetallicRoughness = {
        ...material.pbrMetallicRoughness,
        baseColorFactor: [0.08, 0.24, 0.32, 0.72],
        metallicFactor: 0,
        roughnessFactor: 0.18,
      };
      material.alphaMode = "BLEND";
      material.doubleSided = true;
      repairs.water += 1;
    }
  }
  return repairs;
}

function primitiveTriangles(json, meshIndex) {
  return (json.meshes?.[meshIndex]?.primitives ?? []).reduce((total, primitive) => {
    const accessorIndex = Number.isInteger(primitive.indices) ? primitive.indices : primitive.attributes?.POSITION;
    const count = json.accessors?.[accessorIndex]?.count ?? 0;
    const mode = primitive.mode ?? 4;
    if (mode === 4) return total + Math.floor(count / 3);
    if (mode === 5 || mode === 6) return total + Math.max(0, count - 2);
    return total;
  }, 0);
}

function createFloatAttribute(values, type, count) {
  const array = new Float32Array(values);
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const components = { VEC3: 3, VEC4: 4 }[type];
  const min = Array.from({ length: components }, (_, component) => (
    Math.min(...Array.from({ length: count }, (_unused, row) => array[row * components + component]))
  ));
  const max = Array.from({ length: components }, (_, component) => (
    Math.max(...Array.from({ length: count }, (_unused, row) => array[row * components + component]))
  ));
  return { bytes, accessor: { componentType: 5126, count, type, min, max } };
}

function findInstancingGroups(json, selectedNodes, parents, transforms, config) {
  const groups = new Map();
  for (const index of ordered(selectedNodes)) {
    const node = json.nodes[index];
    if (
      !Number.isInteger(node?.mesh)
      || (node.children?.length ?? 0) > 0
      || node.skin !== undefined
      || node.camera !== undefined
      || node.weights !== undefined
      || Object.keys(node.extensions ?? {}).length > 0
    ) continue;
    const parent = parents.get(index);
    const parentKey = Number.isInteger(parent) ? `parent:${parent}` : `scene:${sceneForRoot(json, index)}`;
    const key = `${parentKey}|mesh:${node.mesh}`;
    const group = groups.get(key) ?? { key, parent, scene: Number.isInteger(parent) ? null : sceneForRoot(json, index), mesh: node.mesh, sourceNodes: [] };
    group.sourceNodes.push(index);
    groups.set(key, group);
  }
  const base = [...groups.values()]
    .filter((group) => group.sourceNodes.length >= 2)
    .sort((a, b) => a.sourceNodes[0] - b.sourceNodes[0]);

  const tileSize = Number(config?.instancing?.tileSize);
  if (!Number.isFinite(tileSize) || tileSize <= 0) return base;
  const minGroupSize = Number.isFinite(Number(config?.instancing?.minGroupSize))
    ? Number(config.instancing.minGroupSize)
    : 16;

  const tiled = [];
  for (const group of base) {
    if (group.sourceNodes.length < minGroupSize) {
      tiled.push(group);
      continue;
    }
    const tiles = new Map();
    for (const index of group.sourceNodes) {
      const world = transforms.get(index);
      const tileX = Math.floor((world?.elements[12] ?? 0) / tileSize);
      const tileZ = Math.floor((world?.elements[14] ?? 0) / tileSize);
      const tileKey = `${tileX}|${tileZ}`;
      const tile = tiles.get(tileKey) ?? { x: tileX, z: tileZ, sourceNodes: [] };
      tile.sourceNodes.push(index);
      tiles.set(tileKey, tile);
    }
    if (tiles.size <= 1) {
      tiled.push(group);
      continue;
    }
    for (const tile of [...tiles.values()].sort((a, b) => a.x - b.x || a.z - b.z)) {
      tiled.push({ ...group, sourceNodes: tile.sourceNodes, tile: { x: tile.x, z: tile.z } });
    }
  }
  return tiled.sort((a, b) => a.sourceNodes[0] - b.sourceNodes[0]);
}

export function buildSubsetDocument(document, selection, config = null) {
  const source = document.json;
  const parents = parentIndices(source);
  const references = collectDocumentReferences(source, selection.selectedNodes);
  const instancingGroups = findInstancingGroups(source, selection.selectedNodes, parents, selection.worldTransforms, config);
  const instancedSources = new Set(instancingGroups.flatMap((group) => group.sourceNodes));
  const retainedNodes = new Set([...references.nodes].filter((index) => !instancedSources.has(index)));
  const nodeMap = mappingFor(retainedNodes);
  const meshMap = mappingFor(references.meshes);
  const accessorMap = mappingFor(references.accessors);
  const bufferViewMap = mappingFor(references.bufferViews);
  const materialMap = mappingFor(references.materials);
  const textureMap = mappingFor(references.textures);
  const imageMap = mappingFor(references.images);
  const samplerMap = mappingFor(references.samplers);
  const lightMap = mappingFor(references.lights);

  const copiedViews = [];
  let binLength = 0;
  const bufferViews = ordered(references.bufferViews).map((sourceIndex) => {
    const sourceView = source.bufferViews[sourceIndex];
    if ((sourceView.buffer ?? 0) !== 0) throw new Error("Village source uses an unsupported external buffer");
    binLength = align4(binLength);
    const view = structuredClone(sourceView);
    view.buffer = 0;
    view.byteOffset = binLength;
    copiedViews.push({ sourceIndex, sourceOffset: sourceView.byteOffset ?? 0, outputOffset: binLength, byteLength: sourceView.byteLength });
    binLength += sourceView.byteLength;
    return view;
  });

  const accessors = ordered(references.accessors).map((sourceIndex) => {
    const accessor = structuredClone(source.accessors[sourceIndex]);
    if (accessor.bufferView !== undefined) accessor.bufferView = mapped(bufferViewMap, accessor.bufferView, "bufferView", false);
    if (accessor.sparse?.indices) accessor.sparse.indices.bufferView = mapped(bufferViewMap, accessor.sparse.indices.bufferView, "sparse index bufferView", false);
    if (accessor.sparse?.values) accessor.sparse.values.bufferView = mapped(bufferViewMap, accessor.sparse.values.bufferView, "sparse value bufferView", false);
    return accessor;
  });
  const generatedViews = [];
  const appendAttribute = (attribute) => {
    binLength = align4(binLength);
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: attribute.bytes.length });
    generatedViews.push({ outputOffset: binLength, bytes: attribute.bytes });
    binLength += attribute.bytes.length;
    const accessorIndex = accessors.length;
    accessors.push({ ...attribute.accessor, bufferView: viewIndex, byteOffset: 0 });
    return accessorIndex;
  };

  const generatedNodes = [];
  for (let groupIndex = 0; groupIndex < instancingGroups.length; groupIndex += 1) {
    const group = instancingGroups[groupIndex];
    const transforms = group.sourceNodes.map((index) => decomposeNode(source.nodes[index]));
    const attributes = {
      TRANSLATION: appendAttribute(createFloatAttribute(transforms.flatMap((entry) => entry.translation), "VEC3", transforms.length)),
      ROTATION: appendAttribute(createFloatAttribute(transforms.flatMap((entry) => entry.rotation), "VEC4", transforms.length)),
      SCALE: appendAttribute(createFloatAttribute(transforms.flatMap((entry) => entry.scale), "VEC3", transforms.length)),
    };
    group.generatedNodeName = group.tile
      ? `instance-${String(groupIndex).padStart(3, "0")}-tile-${group.tile.x}-${group.tile.z}-mesh-${group.mesh}`
      : `instance-${String(groupIndex).padStart(3, "0")}-mesh-${group.mesh}`;
    group.generatedNodeIndex = retainedNodes.size + generatedNodes.length;
    generatedNodes.push({
      name: group.generatedNodeName,
      mesh: mapped(meshMap, group.mesh, "mesh", false),
      extensions: { EXT_mesh_gpu_instancing: { attributes } },
    });
  }

  const groupsByParent = new Map();
  const groupsByScene = new Map();
  for (const group of instancingGroups) {
    const collection = Number.isInteger(group.parent) ? groupsByParent : groupsByScene;
    const key = Number.isInteger(group.parent) ? group.parent : group.scene;
    const entries = collection.get(key) ?? [];
    entries.push(group.generatedNodeIndex);
    collection.set(key, entries);
  }

  const nodes = ordered(retainedNodes).map((sourceIndex) => {
    const node = structuredClone(source.nodes[sourceIndex]);
    if (node.mesh !== undefined) node.mesh = mapped(meshMap, node.mesh, "mesh", false);
    if (node.children) node.children = node.children.filter((child) => nodeMap.has(child)).map((child) => nodeMap.get(child));
    const generatedChildren = groupsByParent.get(sourceIndex) ?? [];
    if (generatedChildren.length > 0) node.children = [...(node.children ?? []), ...generatedChildren];
    const light = node.extensions?.KHR_lights_punctual?.light;
    if (light !== undefined) node.extensions.KHR_lights_punctual.light = mapped(lightMap, light, "light", false);
    return node;
  });
  nodes.push(...generatedNodes);

  const meshes = ordered(references.meshes).map((sourceIndex) => {
    const mesh = structuredClone(source.meshes[sourceIndex]);
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.indices !== undefined) primitive.indices = mapped(accessorMap, primitive.indices, "accessor", false);
      for (const key of Object.keys(primitive.attributes ?? {})) primitive.attributes[key] = mapped(accessorMap, primitive.attributes[key], "attribute accessor", false);
      for (const target of primitive.targets ?? []) {
        for (const key of Object.keys(target)) target[key] = mapped(accessorMap, target[key], "target accessor", false);
      }
      if (primitive.material !== undefined) primitive.material = mapped(materialMap, primitive.material, "material", false);
    }
    return mesh;
  });
  const materials = ordered(references.materials).map((sourceIndex) => {
    const material = structuredClone(source.materials[sourceIndex]);
    remapMaterial(material, textureMap);
    return material;
  });
  repairVillageMaterials(materials);
  const textures = ordered(references.textures).map((sourceIndex) => {
    const texture = structuredClone(source.textures[sourceIndex]);
    if (texture.source !== undefined) texture.source = mapped(imageMap, texture.source, "image", false);
    if (texture.sampler !== undefined) texture.sampler = mapped(samplerMap, texture.sampler, "sampler", false);
    if (texture.extensions?.KHR_texture_basisu?.source !== undefined) texture.extensions.KHR_texture_basisu.source = mapped(imageMap, texture.extensions.KHR_texture_basisu.source, "basisu image", false);
    if (texture.extensions?.EXT_texture_webp?.source !== undefined) texture.extensions.EXT_texture_webp.source = mapped(imageMap, texture.extensions.EXT_texture_webp.source, "webp image", false);
    return texture;
  });
  const images = ordered(references.images).map((sourceIndex) => {
    const image = structuredClone(source.images[sourceIndex]);
    if (image.bufferView !== undefined) image.bufferView = mapped(bufferViewMap, image.bufferView, "image bufferView", false);
    return image;
  });
  const samplers = ordered(references.samplers).map((sourceIndex) => structuredClone(source.samplers[sourceIndex]));
  const lights = ordered(references.lights).map((sourceIndex) => structuredClone(source.extensions?.KHR_lights_punctual?.lights?.[sourceIndex]));
  const scenes = (source.scenes ?? [{ nodes: [] }]).map((sourceScene, sceneIndex) => {
    const scene = structuredClone(sourceScene);
    scene.nodes = (sourceScene.nodes ?? []).filter((node) => nodeMap.has(node)).map((node) => nodeMap.get(node));
    scene.nodes.push(...(groupsByScene.get(sceneIndex) ?? []));
    return scene;
  });

  const json = {
    asset: structuredClone(source.asset),
    scene: source.scene ?? 0,
    scenes,
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  if (materials.length > 0) json.materials = materials;
  if (textures.length > 0) json.textures = textures;
  if (images.length > 0) json.images = images;
  if (samplers.length > 0) json.samplers = samplers;
  const extensionsUsed = new Set(source.extensionsUsed ?? []);
  extensionsUsed.add("EXT_mesh_gpu_instancing");
  json.extensionsUsed = [...extensionsUsed];
  if (source.extensionsRequired?.length) json.extensionsRequired = source.extensionsRequired.filter((name) => extensionsUsed.has(name));
  if (lights.length > 0) json.extensions = { KHR_lights_punctual: { lights } };

  const normalRenderNodes = ordered(retainedNodes).filter((index) => Number.isInteger(source.nodes[index]?.mesh));
  const normalDrawCalls = normalRenderNodes.reduce((sum, index) => sum + (source.meshes[source.nodes[index].mesh]?.primitives?.length ?? 0), 0);
  const instanceDrawCalls = instancingGroups.reduce((sum, group) => sum + (source.meshes[group.mesh]?.primitives?.length ?? 0), 0);
  const expandedTriangles = normalRenderNodes.reduce((sum, index) => sum + primitiveTriangles(source, source.nodes[index].mesh), 0)
    + instancingGroups.reduce((sum, group) => sum + primitiveTriangles(source, group.mesh) * group.sourceNodes.length, 0);
  const sourceSelectedDrawCalls = [...selection.selectedNodes].reduce(
    (sum, index) => sum + (source.meshes[source.nodes[index]?.mesh]?.primitives?.length ?? 0),
    0,
  );

  return {
    json,
    copiedViews,
    generatedViews,
    sourceBinOffset: document.binOffset,
    instancingGroups,
    metrics: {
      ...selection.metrics,
      selectedMeshNodes: selection.selectedNodes.size,
      retainedNodes: nodes.length,
      renderNodes: normalRenderNodes.length + instancingGroups.length,
      drawCalls: normalDrawCalls + instanceDrawCalls,
      sourceSelectedDrawCalls,
      expandedTriangles,
      images: images.length,
      materials: materials.length,
      textures: textures.length,
      instances: instancingGroups.reduce((sum, group) => sum + group.sourceNodes.length, 0),
      instancingGroups: instancingGroups.length,
    },
  };
}

async function writeAll(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (bytesWritten === 0) throw new Error("Unable to write GLB output");
    offset += bytesWritten;
  }
}

export async function writeGlbStream(sourcePath, outputPath, subset) {
  const jsonBytesRaw = Buffer.from(JSON.stringify(subset.json), "utf8");
  const jsonLength = align4(jsonBytesRaw.length);
  const jsonBytes = Buffer.concat([jsonBytesRaw, Buffer.alloc(jsonLength - jsonBytesRaw.length, 0x20)]);
  const binLength = align4(subset.json.buffers[0].byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binLength;
  if (totalLength > 0xffffffff) throw new Error("Subset GLB exceeds the 32-bit container limit");
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await rm(temporaryPath, { force: true });
  const sourceHandle = await open(sourcePath, "r");
  const outputHandle = await open(temporaryPath, "w");
  try {
    const header = Buffer.alloc(20);
    header.writeUInt32LE(GLB_MAGIC, 0);
    header.writeUInt32LE(GLB_VERSION, 4);
    header.writeUInt32LE(totalLength, 8);
    header.writeUInt32LE(jsonLength, 12);
    header.writeUInt32LE(JSON_CHUNK, 16);
    await writeAll(outputHandle, header, 0);
    await writeAll(outputHandle, jsonBytes, 20);
    const binHeaderPosition = 20 + jsonLength;
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binLength, 0);
    binHeader.writeUInt32LE(BIN_CHUNK, 4);
    await writeAll(outputHandle, binHeader, binHeaderPosition);
    const outputBinOffset = binHeaderPosition + 8;
    const segments = [
      ...subset.copiedViews.map((entry) => ({ ...entry, type: "copy" })),
      ...subset.generatedViews.map((entry) => ({ ...entry, byteLength: entry.bytes.length, type: "generated" })),
    ].sort((a, b) => a.outputOffset - b.outputOffset);
    let cursor = 0;
    const copyBuffer = Buffer.alloc(COPY_BUFFER_BYTES);
    for (const segment of segments) {
      if (segment.outputOffset > cursor) await writeAll(outputHandle, Buffer.alloc(segment.outputOffset - cursor), outputBinOffset + cursor);
      if (segment.type === "generated") {
        await writeAll(outputHandle, segment.bytes, outputBinOffset + segment.outputOffset);
      } else {
        let copied = 0;
        while (copied < segment.byteLength) {
          const length = Math.min(copyBuffer.length, segment.byteLength - copied);
          const { bytesRead } = await sourceHandle.read(copyBuffer, 0, length, subset.sourceBinOffset + segment.sourceOffset + copied);
          if (bytesRead !== length) throw new Error(`Truncated source bufferView ${segment.sourceIndex}`);
          await writeAll(outputHandle, copyBuffer.subarray(0, length), outputBinOffset + segment.outputOffset + copied);
          copied += length;
        }
      }
      cursor = segment.outputOffset + segment.byteLength;
    }
    if (cursor < binLength) await writeAll(outputHandle, Buffer.alloc(binLength - cursor), outputBinOffset + cursor);
    await outputHandle.sync();
  } catch (error) {
    await outputHandle.close();
    await sourceHandle.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await outputHandle.close();
  await sourceHandle.close();
  await rm(outputPath, { force: true });
  await rename(temporaryPath, outputPath);
  const outputStat = await stat(outputPath);
  return { path: outputPath, bytes: outputStat.size, sha256: await sha256File(outputPath) };
}

export async function inspectVillageSource({ sourcePath = ELDERBOOM_V1_CONFIG.source.defaultPath } = {}) {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.size !== ELDERBOOM_V1_CONFIG.source.bytes) {
    throw new Error(`Village source byte length mismatch: expected ${ELDERBOOM_V1_CONFIG.source.bytes}, received ${sourceStat.size}`);
  }
  const sourceSha256 = await sha256File(sourcePath);
  assertExpectedSourceHash(sourceSha256);
  const document = await readGlbDocument(sourcePath);
  const { json } = document;
  const selection = selectSpatialNodes(json, ELDERBOOM_V1_CONFIG);
  const references = collectDocumentReferences(json, selection.selectedNodes);
  const expandedPrimitives = [...selection.selectedNodes].reduce(
    (count, nodeIndex) => count + (json.meshes?.[json.nodes[nodeIndex]?.mesh]?.primitives?.length ?? 0),
    0,
  );
  return {
    source: { path: sourcePath, bytes: sourceStat.size, sha256: sourceSha256 },
    scene: json.scenes?.[json.scene ?? 0]?.name ?? null,
    totals: {
      nodes: json.nodes?.length ?? 0,
      meshes: json.meshes?.length ?? 0,
      primitives: (json.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives?.length ?? 0), 0),
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      images: json.images?.length ?? 0,
    },
    selection: {
      bounds: ELDERBOOM_V1_CONFIG.selection.bounds,
      meshNodes: selection.selectedNodes.size,
      referencedNodes: references.nodes.size,
      meshes: references.meshes.size,
      expandedPrimitives,
      materials: references.materials.size,
      textures: references.textures.size,
      images: references.images.size,
      denseFoliageCandidates: selection.metrics.denseFoliageCandidates,
      denseFoliageRetained: selection.metrics.denseFoliageRetained,
    },
  };
}

function assertPerformanceGates(metrics, artifact, gates) {
  const failures = [];
  if (metrics.renderNodes >= gates.maxRenderNodesExclusive) failures.push(`render nodes ${metrics.renderNodes} >= ${gates.maxRenderNodesExclusive}`);
  if (metrics.drawCalls >= gates.maxDrawCallsExclusive) failures.push(`draw calls ${metrics.drawCalls} >= ${gates.maxDrawCallsExclusive}`);
  if (metrics.expandedTriangles >= gates.maxExpandedTrianglesExclusive) {
    failures.push(`expanded triangles ${metrics.expandedTriangles} >= ${gates.maxExpandedTrianglesExclusive}`);
  }
  if (metrics.images > gates.maxImages) failures.push(`images ${metrics.images} > ${gates.maxImages}`);
  if (artifact.bytes > gates.maxArtifactBytes) failures.push(`artifact bytes ${artifact.bytes} > ${gates.maxArtifactBytes}`);
  if (artifact.bytes < gates.minArtifactBytes) failures.push(`artifact bytes ${artifact.bytes} < ${gates.minArtifactBytes}`);
  if ((metrics.texels ?? 0) > gates.maxTextureTexels) failures.push(`texture texels ${metrics.texels} > ${gates.maxTextureTexels}`);
  if ((metrics.maxColorDimension ?? 0) > gates.maxColorDimension) {
    failures.push(`color texture dimension ${metrics.maxColorDimension} > ${gates.maxColorDimension}`);
  }
  if ((metrics.maxDataDimension ?? 0) > gates.maxDataDimension) {
    failures.push(`data texture dimension ${metrics.maxDataDimension} > ${gates.maxDataDimension}`);
  }
  if (failures.length > 0) throw new Error(`Village subset performance gates failed: ${failures.join(", ")}`);
}

async function updateManifestArtifact(artifacts, generatedColliders = null) {
  const manifestPath = path.resolve(ELDERBOOM_V1_CONFIG.outputs.manifest);
  const source = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const chunk of source.chunks ?? []) {
    const artifact = artifacts.get(chunk.id);
    if (!artifact) throw new Error(`Village manifest is missing build output for chunk ${chunk.id}`);
    chunk.artifact = { bytes: artifact.bytes, sha256: artifact.sha256 };
  }
  if (Array.isArray(generatedColliders)) {
    const authored = (source.colliders ?? []).filter((entry) => !String(entry.id).startsWith("arch-"));
    source.colliders = [...authored, ...generatedColliders];
  }
  const configuredIds = ELDERBOOM_V1_CONFIG.chunks.map((chunk) => chunk.id).sort().join(",");
  if ((source.chunks ?? []).map((chunk) => chunk.id).sort().join(",") !== configuredIds) {
    throw new Error(`Village manifest chunks do not match the configured quality chunks: ${configuredIds}`);
  }
  const manifest = validateEnvironmentManifest(source);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, manifestPath);
}

async function buildVillage({ sourcePath = ELDERBOOM_V1_CONFIG.source.defaultPath } = {}) {
  const inspection = await inspectVillageSource({ sourcePath });
  const document = await readGlbDocument(sourcePath);
  const selection = selectSpatialNodes(document.json, ELDERBOOM_V1_CONFIG);
  const subset = buildSubsetDocument(document, selection, ELDERBOOM_V1_CONFIG);
  const existingManifest = JSON.parse(await readFile(path.resolve(ELDERBOOM_V1_CONFIG.outputs.manifest), "utf8"));
  const taskAnchors = Object.values(existingManifest.tasks ?? {}).map((task) => task.position).filter(Array.isArray);
  const authoredColliders = (existingManifest.colliders ?? []).filter((entry) => !String(entry.id).startsWith("arch-"));
  const generatedColliders = generateArchitectureColliders(document.json, selection, ELDERBOOM_V1_CONFIG, taskAnchors, authoredColliders);
  const outputDirectory = path.resolve(ELDERBOOM_V1_CONFIG.outputs.directory);
  await mkdir(outputDirectory, { recursive: true });

  const artifacts = new Map();
  const chunkReports = [];
  const ultraChunk = ELDERBOOM_V1_CONFIG.chunks.find((chunk) => chunk.quality === "ultra");
  const ultraProfile = villageQualityProfile(ultraChunk.quality);
  if (ultraProfile.encoding !== "original") throw new Error("The ultra chunk must retain original textures");

  const ultraPath = path.join(outputDirectory, `${ultraChunk.id}.glb`);
  await writeGlbStream(sourcePath, ultraPath, subset);
  const ultraStat = await stat(ultraPath);
  const ultraArtifact = { path: ultraPath, bytes: ultraStat.size, sha256: await sha256File(ultraPath) };
  const ultraDocument = await readGlbDocument(ultraPath);
  ultraDocument.path = ultraPath;
  const ultraTextureMetrics = await inspectRuntimeTextures(ultraDocument);
  const ultraMetrics = { ...subset.metrics, ...ultraTextureMetrics };
  assertPerformanceGates(ultraMetrics, ultraArtifact, villageGatesForQuality(ultraChunk.quality));
  artifacts.set(ultraChunk.id, ultraArtifact);
  chunkReports.push({
    id: ultraChunk.id,
    quality: ultraChunk.quality,
    artifact: ultraArtifact,
    metrics: ultraMetrics,
  });

  for (const chunk of ELDERBOOM_V1_CONFIG.chunks.filter((entry) => entry.quality !== "ultra")) {
    const profile = villageQualityProfile(chunk.quality);
    const outputPath = path.join(outputDirectory, `${chunk.id}.glb`);
    const textureMetrics = await optimizeVillageTextures({
      inputPath: ultraPath,
      outputPath,
      colorMax: profile.colorMax,
      dataMax: profile.dataMax,
      quality: profile.webpQuality,
      dimensionScale: 0.8,
    });
    const artifact = {
      path: outputPath,
      bytes: textureMetrics.bytes,
      sha256: await sha256File(outputPath),
    };
    const metrics = { ...subset.metrics, ...textureMetrics };
    assertPerformanceGates(metrics, artifact, villageGatesForQuality(chunk.quality));
    artifacts.set(chunk.id, artifact);
    chunkReports.push({ id: chunk.id, quality: chunk.quality, artifact, metrics });
  }

  const report = {
    version: 2,
    generatedAt: new Date().toISOString(),
    defaultQuality: ELDERBOOM_V1_CONFIG.defaultQuality,
    inspection,
    chunks: chunkReports,
  };
  await mkdir(path.dirname(ELDERBOOM_V1_CONFIG.outputs.report), { recursive: true });
  await writeFile(ELDERBOOM_V1_CONFIG.outputs.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await updateManifestArtifact(artifacts, generatedColliders);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf("--source");
  const sourcePath = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
  if (args.includes("--inspect")) {
    process.stdout.write(`${JSON.stringify(await inspectVillageSource({ sourcePath }), null, 2)}\n`);
    return;
  }
  if (args.includes("--write")) {
    process.stdout.write(`${JSON.stringify(await buildVillage({ sourcePath }), null, 2)}\n`);
    return;
  }
  throw new Error("Use --inspect or --write");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
