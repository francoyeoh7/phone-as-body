import { Box3, Matrix4, Quaternion, Vector3 } from "three";

const CORE_TEXTURE_SLOTS = [
  "normalTexture",
  "occlusionTexture",
  "emissiveTexture",
];
const PBR_TEXTURE_SLOTS = ["baseColorTexture", "metallicRoughnessTexture"];
const EXTENSION_TEXTURE_SLOTS = {
  KHR_materials_specular: ["specularTexture", "specularColorTexture"],
  KHR_materials_sheen: ["sheenColorTexture", "sheenRoughnessTexture"],
  KHR_materials_anisotropy: ["anisotropyTexture"],
};

function nodeLocalMatrix(node = {}) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return new Matrix4().fromArray(node.matrix);
  const translation = new Vector3(...(node.translation ?? [0, 0, 0]));
  const rotation = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const scale = new Vector3(...(node.scale ?? [1, 1, 1]));
  return new Matrix4().compose(translation, rotation, scale);
}

function parentIndices(json) {
  const parents = new Map();
  for (let index = 0; index < (json.nodes?.length ?? 0); index += 1) {
    for (const child of json.nodes[index]?.children ?? []) parents.set(child, index);
  }
  return parents;
}

export function walkNodeWorldTransforms(json) {
  const nodes = json.nodes ?? [];
  const parents = parentIndices(json);
  const transforms = new Map();
  const visiting = new Set();
  const resolve = (index) => {
    if (transforms.has(index)) return transforms.get(index);
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new Error(`Node index ${index} out of range`);
    if (visiting.has(index)) throw new Error("Node hierarchy contains a cycle");
    visiting.add(index);
    const local = nodeLocalMatrix(nodes[index]);
    const parent = parents.get(index);
    const world = parent === undefined ? local : resolve(parent).clone().multiply(local);
    visiting.delete(index);
    transforms.set(index, world);
    return world;
  };
  for (let index = 0; index < nodes.length; index += 1) resolve(index);
  return transforms;
}

export function nodeWorldBounds(json, nodeIndex, worldMatrix) {
  const node = json.nodes?.[nodeIndex];
  const mesh = json.meshes?.[node?.mesh];
  if (!mesh) return null;
  const bounds = new Box3();
  let found = false;
  for (const primitive of mesh.primitives ?? []) {
    const accessor = json.accessors?.[primitive.attributes?.POSITION];
    if (!Array.isArray(accessor?.min) || !Array.isArray(accessor?.max)) continue;
    const source = new Box3(new Vector3(...accessor.min), new Vector3(...accessor.max));
    source.applyMatrix4(worldMatrix ?? nodeLocalMatrix(node));
    if (!found) bounds.copy(source);
    else bounds.union(source);
    found = true;
  }
  return found ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null;
}

function addIndex(set, index) {
  if (Number.isInteger(index) && index >= 0) set.add(index);
}

function collectMaterialTextures(material, textures) {
  for (const slot of CORE_TEXTURE_SLOTS) addIndex(textures, material?.[slot]?.index);
  for (const slot of PBR_TEXTURE_SLOTS) addIndex(textures, material?.pbrMetallicRoughness?.[slot]?.index);
  for (const [extension, slots] of Object.entries(EXTENSION_TEXTURE_SLOTS)) {
    for (const slot of slots) addIndex(textures, material?.extensions?.[extension]?.[slot]?.index);
  }
}

export function collectDocumentReferences(json, nodeIndices = new Set()) {
  const references = Object.fromEntries([
    "nodes", "meshes", "accessors", "bufferViews", "buffers", "materials", "textures", "images", "samplers", "lights",
  ].map((key) => [key, new Set()]));
  const parents = parentIndices(json);
  const descended = new Set();
  const includeNode = (index, includeDescendants = false) => {
    const firstVisit = !references.nodes.has(index);
    if (firstVisit) addIndex(references.nodes, index);
    const node = json.nodes?.[index];
    if (!node) return;
    if (firstVisit) {
      addIndex(references.meshes, node.mesh);
      addIndex(references.lights, node.extensions?.KHR_lights_punctual?.light);
      for (const accessor of Object.values(node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {})) {
        addIndex(references.accessors, accessor);
      }
    }
    if (!includeDescendants || descended.has(index)) return;
    descended.add(index);
    for (const child of node.children ?? []) includeNode(child, true);
  };
  for (const index of nodeIndices) {
    includeNode(index, true);
    let current = parents.get(index);
    while (Number.isInteger(current)) {
      includeNode(current, false);
      current = parents.get(current);
    }
  }

  for (const meshIndex of references.meshes) {
    for (const primitive of json.meshes?.[meshIndex]?.primitives ?? []) {
      addIndex(references.accessors, primitive.indices);
      for (const accessor of Object.values(primitive.attributes ?? {})) addIndex(references.accessors, accessor);
      for (const target of primitive.targets ?? []) {
        for (const accessor of Object.values(target)) addIndex(references.accessors, accessor);
      }
      addIndex(references.materials, primitive.material);
    }
  }
  for (const accessorIndex of references.accessors) {
    const accessor = json.accessors?.[accessorIndex];
    addIndex(references.bufferViews, accessor?.bufferView);
    addIndex(references.bufferViews, accessor?.sparse?.indices?.bufferView);
    addIndex(references.bufferViews, accessor?.sparse?.values?.bufferView);
  }
  for (const materialIndex of references.materials) collectMaterialTextures(json.materials?.[materialIndex], references.textures);
  for (const textureIndex of references.textures) {
    const texture = json.textures?.[textureIndex];
    addIndex(references.images, texture?.source);
    addIndex(references.images, texture?.extensions?.KHR_texture_basisu?.source);
    addIndex(references.images, texture?.extensions?.EXT_texture_webp?.source);
    addIndex(references.samplers, texture?.sampler);
  }
  for (const imageIndex of references.images) addIndex(references.bufferViews, json.images?.[imageIndex]?.bufferView);
  for (const viewIndex of references.bufferViews) addIndex(references.buffers, json.bufferViews?.[viewIndex]?.buffer);
  return references;
}

function assertIndex(label, index, array, optional = true) {
  if (index === undefined && optional) return;
  if (!Number.isInteger(index) || index < 0 || index >= (array?.length ?? 0)) {
    throw new Error(`${label} index ${index} is out of range`);
  }
}

export function assertClosedDocument(json) {
  for (const scene of json.scenes ?? []) for (const node of scene.nodes ?? []) assertIndex("scene node", node, json.nodes, false);
  for (const [index, node] of (json.nodes ?? []).entries()) {
    assertIndex(`node ${index} mesh`, node.mesh, json.meshes);
    for (const child of node.children ?? []) assertIndex(`node ${index} child`, child, json.nodes, false);
    const light = node.extensions?.KHR_lights_punctual?.light;
    assertIndex(`node ${index} light`, light, json.extensions?.KHR_lights_punctual?.lights);
    for (const accessor of Object.values(node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {})) {
      assertIndex(`node ${index} instance attribute`, accessor, json.accessors, false);
    }
  }
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    for (const primitive of mesh.primitives ?? []) {
      assertIndex(`mesh ${meshIndex} indices`, primitive.indices, json.accessors);
      assertIndex(`mesh ${meshIndex} material`, primitive.material, json.materials);
      for (const accessor of Object.values(primitive.attributes ?? {})) assertIndex(`mesh ${meshIndex} attribute`, accessor, json.accessors, false);
      for (const target of primitive.targets ?? []) {
        for (const accessor of Object.values(target)) assertIndex(`mesh ${meshIndex} target`, accessor, json.accessors, false);
      }
    }
  }
  for (const [index, accessor] of (json.accessors ?? []).entries()) {
    assertIndex(`accessor ${index} bufferView`, accessor.bufferView, json.bufferViews);
    assertIndex(`accessor ${index} sparse indices`, accessor.sparse?.indices?.bufferView, json.bufferViews);
    assertIndex(`accessor ${index} sparse values`, accessor.sparse?.values?.bufferView, json.bufferViews);
  }
  for (const material of json.materials ?? []) {
    const textures = new Set();
    collectMaterialTextures(material, textures);
    for (const texture of textures) assertIndex("material texture", texture, json.textures, false);
  }
  for (const [index, texture] of (json.textures ?? []).entries()) {
    assertIndex(`texture ${index} source image`, texture.source, json.images);
    assertIndex(`texture ${index} basisu image`, texture.extensions?.KHR_texture_basisu?.source, json.images);
    assertIndex(`texture ${index} webp image`, texture.extensions?.EXT_texture_webp?.source, json.images);
    assertIndex(`texture ${index} sampler`, texture.sampler, json.samplers);
  }
  for (const [index, image] of (json.images ?? []).entries()) assertIndex(`image ${index} bufferView`, image.bufferView, json.bufferViews);
  for (const [index, view] of (json.bufferViews ?? []).entries()) assertIndex(`bufferView ${index} buffer`, view.buffer, json.buffers, false);
  walkNodeWorldTransforms(json);
  return true;
}
