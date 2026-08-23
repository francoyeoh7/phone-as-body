import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import sharp from "sharp";

// Node shims for three's browser-oriented loaders/exporters.
globalThis.self = globalThis;
if (!globalThis.window) globalThis.window = globalThis;
const fakeImage = () => ({
  style: {},
  getContext: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
});
if (!globalThis.document) {
  globalThis.document = { createElementNS: () => fakeImage(), createElement: () => fakeImage() };
}
if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReaderPolyfill {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL ?? (() => "blob:stub");
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL ?? (() => {});
globalThis.createImageBitmap = globalThis.createImageBitmap ?? (async () => ({ width: 2, height: 2, close() {} }));

// Sources: FBX2glTF output (clean rigs, correct units, Y-up, meters).
const CHARACTERS_ROOT = "D:\\3d资产\\characters";
const OUTPUT_DIR = "public/assets/characters";

// Epic skeleton (bandit/survival) <- Bubba handyman rig (animation source)
const BONE_MAP = {
  pelvis: "Handyman_Pelvis",
  spine_01: "Handyman_Spine",
  spine_02: "Handyman_Spine1",
  spine_03: "Handyman_Spine2",
  neck_01: "Handyman_Neck",
  head: "Handyman_Head",
  clavicle_l: "Handyman_L_Clavicle",
  upperarm_l: "Handyman_L_UpperArm",
  lowerarm_l: "Handyman_L_Forearm",
  hand_l: "Handyman_L_Hand",
  clavicle_r: "Handyman_R_Clavicle",
  upperarm_r: "Handyman_R_UpperArm",
  lowerarm_r: "Handyman_R_Forearm",
  hand_r: "Handyman_R_Hand",
  thigh_l: "Handyman_L_Thigh",
  calf_l: "Handyman_L_Calf",
  foot_l: "Handyman_L_Foot",
  ball_l: "Handyman_L_Toe0",
  thigh_r: "Handyman_R_Thigh",
  calf_r: "Handyman_R_Calf",
  foot_r: "Handyman_R_Foot",
  ball_r: "Handyman_R_Toe0",
  thumb_01_l: "Handyman_Left_ThumbProximal",
  thumb_02_l: "Handyman_Left_ThumbIntermediate",
  thumb_03_l: "Handyman_Left_ThumbDistal",
  index_01_l: "Handyman_L_Finger1",
  index_02_l: "Handyman_L_Finger11",
  index_03_l: "Handyman_L_Finger12",
  middle_01_l: "Handyman_L_Finger2",
  middle_02_l: "Handyman_L_Finger21",
  middle_03_l: "Handyman_L_Finger22",
  ring_01_l: "Handyman_L_Finger3",
  ring_02_l: "Handyman_L_Finger31",
  ring_03_l: "Handyman_L_Finger32",
  pinky_01_l: "Handyman_L_Finger4",
  pinky_02_l: "Handyman_L_Finger41",
  pinky_03_l: "Handyman_L_Finger42",
  thumb_01_r: "Handyman_Right_ThumbProximal",
  thumb_02_r: "Handyman_Right_ThumbIntermediate",
  thumb_03_r: "Handyman_Right_ThumbDistal",
  index_01_r: "Handyman_R_Finger1",
  index_02_r: "Handyman_R_Finger11",
  index_03_r: "Handyman_R_Finger12",
  middle_01_r: "Handyman_R_Finger2",
  middle_02_r: "Handyman_R_Finger21",
  middle_03_r: "Handyman_R_Finger22",
  ring_01_r: "Handyman_R_Finger3",
  ring_02_r: "Handyman_R_Finger31",
  ring_03_r: "Handyman_R_Finger32",
  pinky_01_r: "Handyman_R_Finger4",
  pinky_02_r: "Handyman_R_Finger41",
  pinky_03_r: "Handyman_R_Finger42",
};

const BANDIT_TEXTURES = `${CHARACTERS_ROOT}\\bandit\\TexturesPng`;
const SURVIVAL_TEXTURES = `${CHARACTERS_ROOT}\\survival\\Textures\\Textures`;
const BUBBA_TEXTURES = `${CHARACTERS_ROOT}\\bubba`;

function banditTextures(materialName) {
  const base = (file) => `${BANDIT_TEXTURES}\\${file}.png`;
  const standard = (stem) => ({
    baseColor: base(`${stem}_BaseColor`),
    normal: base(`${stem}_Normal`),
    ao: base(`${stem}_Ao`),
  });
  if (/^Ban(Boots|Bracers|Chaps|Gunbelt|Hat|Maskdown|Maskup|Pants|Shirt)Mtl$/.test(materialName)) return standard(materialName.replace(/Mtl$/, "Mtl"));
  if (materialName === "BanJacketMtl") return standard("BanJacket");
  if (materialName === "BanBodyMtl" || materialName === "prettyJawMtl") return standard("BanBodyMtl");
  if (materialName === "RevolverMtl") return standard("ColtMtl");
  if (materialName === "BanHairMtl") return { baseColor: base("BanHair_dif"), normal: base("BanHair_Norm"), alpha: true };
  if (materialName === "BanEyelshesMtl" || materialName === "BanEyesShadowMtl") {
    return { baseColor: base("BanLashes_Shadows_Albedo"), normal: base("BanLashes_Shadows_Normal"), alpha: true };
  }
  if (/^UnityEyes(Inner|Outer)Mtl$/.test(materialName)) return { baseColor: base("BanEyes") };
  return null;
}

function survivalTextures(materialName) {
  const dir = (folder) => `${SURVIVAL_TEXTURES}\\${folder}`;
  const folders = { Jacket1: "Jacket", Jeans1: "Jeans", Shoes1: "Shoes", Gloves1: "Gloves", Backpack2: "Backpack" };
  if (folders[materialName]) {
    const folder = folders[materialName];
    return {
      baseColor: `${dir(folder)}\\${folder}_BaseColor.jpg`,
      normal: `${dir(folder)}\\${folder}_Normal.jpg`,
      ao: `${dir(folder)}\\${folder}_OcclusionRoughnessMetallic.jpg`,
    };
  }
  if (materialName === "Mouth") return { baseColor: `${dir("Mouth")}\\TeethBaseColor.png`, normal: `${dir("Mouth")}\\Teet_Normal.png` };
  if (materialName === "Body_Arkit:Eye") return { baseColor: `${dir("Eye")}\\Eye_BaseColor.png`, normal: `${dir("Eye")}\\Eye_Normal.jpg` };
  if (materialName === "Brows_Leashes") return { baseColor: `${dir("Eyebrow_EyeLeashes")}\\Eyebrows_BaseColor.jpg`, alpha: true };
  if (materialName === "Hair3") {
    return { baseColor: `${dir("HairStyle")}\\HairBrown_Diffuse_2.jpg`, normal: `${dir("HairStyle")}\\HairBrown_Normal.jpg`, alpha: true };
  }
  return null;
}

function bubbaTextures(materialName) {
  const base = (file) => `${BUBBA_TEXTURES}\\${file}.png`;
  if (materialName === "Material #16") {
    return {
      baseColor: base("Handyman_Body_AlbedoTransparency"),
      normal: base("Handyman_Body_Normal"),
      ao: base("Handyman_Body_AO"),
    };
  }
  if (materialName === "Material #17") {
    return { baseColor: base("Handyman_Hair"), normal: base("Handyman_Hair_NormalMap"), alpha: true };
  }
  if (materialName === "Material #12") {
    return {
      baseColor: base("Handyman_Cloth_Albedo_ver1"),
      normal: base("Handyman_Cloth_Normal"),
      ao: base("Handyman_Cloth_AO"),
    };
  }
  return null;
}

// Survival skin meshes carry UDIM tiles: Body3_N maps to tile 100N.
function survivalMeshTextures(meshName) {
  const match = /^Body3_(\d)$/.exec(meshName ?? "");
  if (!match) return null;
  const tile = `100${match[1]}`;
  return {
    baseColor: `${SURVIVAL_TEXTURES}\\Body\\Body_BaseColor.${tile}.png`,
    normal: `${SURVIVAL_TEXTURES}\\Body\\Body_Normal.${tile}.png`,
    ao: `${SURVIVAL_TEXTURES}\\Body\\Body_OcclusionRoughnessMetallic.${tile}.png`,
  };
}

const CHARACTERS = [
  {
    id: "bubba",
    displayName: "Bubba The Handyman",
    glb: `${CHARACTERS_ROOT}\\bubba\\Handyman_Full.glb`,
    materialTextures: bubbaTextures,
    dropMeshPattern: /_LOD[123]/,
    animationGlbs: {
      idle: `${CHARACTERS_ROOT}\\bubba\\Handyman_idle_1_animation.glb`,
      idleAlt: `${CHARACTERS_ROOT}\\bubba\\Handyman_idle_2_animation.glb`,
      walk: `${CHARACTERS_ROOT}\\bubba\\Handyman_walk_animation.glb`,
      run: `${CHARACTERS_ROOT}\\bubba\\Handyman_run_animation.glb`,
    },
  },
];

async function loadGlb(file) {
  const buffer = await readFile(file);
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
}

function dropMeshes(root, pattern) {
  const doomed = [];
  root.traverse((object) => {
    if (object.isMesh && pattern.test(object.name ?? "")) doomed.push(object);
  });
  for (const mesh of doomed) mesh.removeFromParent();
  return doomed.length;
}

function pruneUnusedBones(root) {
  const used = new Set();
  root.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    for (const bone of object.skeleton.bones) {
      let cursor = bone;
      while (cursor) {
        used.add(cursor);
        cursor = cursor.parent?.isBone ? cursor.parent : null;
      }
    }
  });
  const doomed = [];
  root.traverse((object) => {
    if (!object.isBone || used.has(object)) return;
    const hasUsedDescendant = (node) => (node.children ?? []).some((child) => used.has(child) || hasUsedDescendant(child));
    if (!hasUsedDescendant(object)) doomed.push(object);
  });
  for (const bone of doomed) if (!used.has(bone)) bone.removeFromParent();
  return doomed.length;
}

function snapshotTransforms(root) {
  const snapshot = [];
  root.traverse((object) => snapshot.push({
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  }));
  return snapshot;
}

function restoreTransforms(snapshot) {
  for (const { object, position, quaternion, scale } of snapshot) {
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    object.scale.copy(scale);
  }
}

function fullSkeletonTarget(root) {
  const bones = [];
  root.traverse((object) => { if (object.isBone) bones.push(object); });
  root.updateMatrixWorld(true);
  const inverses = bones.map((bone) => bone.matrixWorld.clone().invert());
  const target = new THREE.Object3D();
  target.name = "retarget-target";
  target.skeleton = new THREE.Skeleton(bones, inverses);
  return target;
}

function retargetOnto(targetRoot, clip, sourceRoot) {
  const target = fullSkeletonTarget(targetRoot);
  const sourceBones = [];
  sourceRoot.traverse((object) => { if (object.isBone) sourceBones.push(object); });
  sourceRoot.updateMatrixWorld(true);
  const source = new THREE.Skeleton(sourceBones, sourceBones.map((bone) => bone.matrixWorld.clone().invert()));
  const retargeted = SkeletonUtils.retargetClip(target, source, clip, {
    names: BONE_MAP,
    hip: "Handyman_Pelvis",
    useFirstFramePosition: true,
    fps: 30,
  });
  for (const track of retargeted.tracks) {
    track.name = track.name.replace(/^\.bones\[([^\]]+)\]\.(\w+)$/, "$1.$2");
  }
  retargeted.name = clip.name;
  return retargeted;
}

function sanitizeClip(clip) {
  // Keep rotation tracks only: position tracks bake root/hip motion that
  // double-moves the character when the controller also translates the root.
  clip.tracks = clip.tracks.filter((track) => (
    track.name.endsWith(".quaternion") && !track.name.includes("morphTargetInfluences")
  ));
  return clip;
}

async function exportGlb(root, animations) {
  const exporter = new GLTFExporter();
  return exporter.parseAsync(root, {
    binary: true,
    animations,
    includeCustomExtensions: false,
    onlyVisible: true,
  });
}

// GLB texture injection.
const align4 = (value) => (value + 3) & ~3;

async function encodeTexture(file, maxSize) {
  const image = sharp(file, { limitInputPixels: false });
  const metadata = await image.metadata();
  const max = Math.max(metadata.width ?? 1, metadata.height ?? 1);
  const pipeline = max > maxSize ? image.resize({ width: maxSize, height: maxSize, fit: "inside" }) : image;
  return pipeline.png().toBuffer();
}

async function injectTextures(glbBuffer, assignments) {
  const view = new DataView(glbBuffer.buffer, glbBuffer.byteOffset, glbBuffer.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(glbBuffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const binChunkOffset = 20 + jsonLength;
  const binLength = view.getUint32(binChunkOffset, true);
  const binDataStart = binChunkOffset + 8;
  let bin = Buffer.from(glbBuffer.subarray(binDataStart, binDataStart + binLength));

  json.samplers = json.samplers?.length ? json.samplers : [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  json.images = json.images ?? [];
  json.textures = json.textures ?? [];

  const textureCache = new Map();
  const addTexture = async (file, maxSize) => {
    if (textureCache.has(file)) return textureCache.get(file);
    const bytes = await encodeTexture(file, maxSize);
    const padded = align4(bin.length);
    bin = Buffer.concat([bin, Buffer.alloc(padded - bin.length), bytes]);
    json.bufferViews.push({ buffer: 0, byteOffset: padded, byteLength: bytes.length });
    json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: "image/png", name: path.basename(file) });
    json.textures.push({ sampler: 0, source: json.images.length - 1 });
    const index = json.textures.length - 1;
    textureCache.set(file, index);
    return index;
  };

  for (const material of json.materials ?? []) {
    const assignment = assignments.get(material.name);
    if (!assignment) continue;
    if (assignment.baseColor) {
      const index = await addTexture(assignment.baseColor, 1024);
      material.pbrMetallicRoughness = {
        ...(material.pbrMetallicRoughness ?? {}),
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index },
        metallicFactor: 0,
        roughnessFactor: 0.85,
      };
    }
    if (assignment.normal) {
      const index = await addTexture(assignment.normal, 1024);
      material.normalTexture = { index };
    }
    if (assignment.ao) {
      const index = await addTexture(assignment.ao, 512);
      material.occlusionTexture = { index };
    }
    if (assignment.alpha) {
      material.alphaMode = "MASK";
      material.alphaCutoff = 0.35;
      material.doubleSided = true;
    }
  }
  json.buffers[0].byteLength = bin.length;

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc(align4(bin.length) - bin.length)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

async function buildCharacter(character, bubbaAnimScenes) {
  const gltf = await loadGlb(character.glb);
  const root = gltf.scene;
  if (character.dropMeshPattern) dropMeshes(root, character.dropMeshPattern);
  pruneUnusedBones(root);

  const assignments = new Map();
  const usedNames = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const mapped = materials.map((material, slot) => {
      let name = material?.name || `${object.name}-slot-${slot}`;
      if (usedNames.has(name)) name = `${name}__${slot}`;
      usedNames.add(name);
      const standard = new THREE.MeshStandardMaterial({
        name,
        color: material?.color?.isColor ? material.color.clone() : new THREE.Color(0xbbbbbb),
        roughness: 0.85,
        metalness: 0,
      });
      const textures = character.materialTextures?.(material?.name) ?? character.meshTextures?.(object.name) ?? null;
      if (textures) assignments.set(name, textures);
      return standard;
    });
    object.material = Array.isArray(object.material) ? mapped : mapped[0];
  });

  let animations = [];
  if (character.animationGlbs) {
    for (const [name, file] of Object.entries(character.animationGlbs)) {
      const animGltf = await loadGlb(file);
      const clip = animGltf.animations?.[0];
      if (!clip) throw new Error(`No animation in ${file}`);
      clip.name = name;
      animations.push(sanitizeClip(clip));
    }
  } else if (character.retarget) {
    const restSnapshot = snapshotTransforms(root);
    for (const name of ["idle", "walk", "run"]) {
      const source = bubbaAnimScenes[name];
      const retargeted = retargetOnto(root, source.clip, source.root);
      // Hip translation does not transfer across differently-proportioned rigs;
      // rotations alone carry the motion and keep the pelvis at rest height.
      retargeted.tracks = retargeted.tracks.filter((track) => track.name.endsWith(".quaternion"));
      animations.push(sanitizeClip(retargeted));
      restoreTransforms(restSnapshot);
      root.updateMatrixWorld(true);
    }
  }

  const glb = await exportGlb(root, animations);
  const finalBuffer = await injectTextures(Buffer.from(glb), assignments);
  return { buffer: finalBuffer, animations: animations.map((clip) => clip.name) };
}

async function main() {
  const outDir = path.resolve(OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });

  const bubbaAnimScenes = {};
  const bubbaAnimations = CHARACTERS.find((character) => character.id === "bubba")?.animationGlbs ?? {};
  for (const [name, file] of Object.entries(bubbaAnimations)) {
    const animGltf = await loadGlb(file);
    const clip = animGltf.animations?.[0];
    if (!clip) throw new Error(`No animation in ${file}`);
    clip.name = name;
    bubbaAnimScenes[name] = { clip, root: animGltf.scene };
  }

  const manifest = { version: 1, characters: [] };
  for (const character of CHARACTERS) {
    console.log(`building ${character.id}...`);
    const { buffer, animations } = await buildCharacter(character, bubbaAnimScenes);
    const file = path.join(outDir, `${character.id}.glb`);
    await writeFile(file, buffer);
    const sha256 = createHash("sha256").update(buffer).digest("hex").toUpperCase();
    manifest.characters.push({
      id: character.id,
      name: character.displayName,
      url: `/assets/characters/${character.id}.glb`,
      bytes: buffer.length,
      sha256,
      animations,
    });
    console.log(`  -> ${character.id}.glb ${(buffer.length / 1048576).toFixed(1)}MB, clips: ${animations.join(", ")}`);
  }
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log("characters manifest written");
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invoked) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { buildCharacter, BONE_MAP };
