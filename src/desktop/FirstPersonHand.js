import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

export const WEBXR_JOINTS = [
  "wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
];

const MP = {
  wrist: 0, thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20],
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const asPoint = (point) => Array.isArray(point) ? point.slice(0, 3) : [point?.x, point?.y, point?.z];
const finitePoint = (point) => {
  const value = asPoint(point);
  return value.length === 3 && value.every(Number.isFinite) ? value : [0, 0, 0];
};
const normalize = (v, fallback = [0, 1, 0]) => {
  const n = Math.hypot(...v);
  return n > 1e-8 && Number.isFinite(n) ? v.map((x) => x / n) : fallback.slice();
};
const subtract = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function quaternionFromBasis(basis) {
  const right = normalize(basis?.right ?? [1, 0, 0], [1, 0, 0]);
  const up = normalize(basis?.up ?? [0, 1, 0]);
  const forward = normalize(basis?.forward ?? [0, 0, 1], [0, 0, 1]);
  const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...forward));
  return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
}

export function jointQuaternion(joint, child, palmBasis = {}) {
  const a = finitePoint(joint?.position ?? joint);
  const b = finitePoint(child?.position ?? child);
  const direction = normalize(subtract(b, a), [0, 1, 0]);
  const side = normalize(palmBasis.right ?? [1, 0, 0], [1, 0, 0]);
  let forward = normalize(cross(side, direction), palmBasis.forward ?? [0, 0, 1]);
  const correctedSide = normalize(cross(direction, forward), side);
  const matrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...correctedSide),
    new THREE.Vector3(...direction),
    new THREE.Vector3(...forward),
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function interpolate(a, b, amount) { return a.map((x, index) => x + (b[index] - x) * amount); }

export function expandMediaPipeJoints(pose = {}) {
  const source = Array.isArray(pose.worldLandmarks) && pose.worldLandmarks.length >= 21 ? pose.worldLandmarks : pose.landmarks;
  const points = Array.from({ length: 21 }, (_, index) => finitePoint(source?.[index]));
  const entries = [];
  const add = (name, position, childIndex) => {
    const child = childIndex === undefined ? position : points[childIndex];
    entries.push({ name, position: position.slice(), quaternion: jointQuaternion(position, child, pose.wrist) });
  };
  add("wrist", points[0], 9);
  add("thumb-metacarpal", points[1], 2);
  add("thumb-phalanx-proximal", points[2], 3);
  add("thumb-phalanx-distal", points[3], 4);
  add("thumb-tip", points[4], 4);
  for (const [prefix, chain] of [["index-finger", MP.index], ["middle-finger", MP.middle], ["ring-finger", MP.ring], ["pinky-finger", MP.pinky]]) {
    add(`${prefix}-metacarpal`, interpolate(points[0], points[chain[0]], 0.35), chain[1]);
    add(`${prefix}-phalanx-proximal`, points[chain[0]], chain[1]);
    add(`${prefix}-phalanx-intermediate`, points[chain[1]], chain[2]);
    add(`${prefix}-phalanx-distal`, points[chain[2]], chain[3]);
    add(`${prefix}-tip`, points[chain[3]], chain[3]);
  }
  entries.byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  for (const entry of entries) entries[entry.name] = entry;
  return entries;
}

function setMaterialOpacity(root, opacity) {
  root.traverse?.((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = opacity >= 0.999;
    }
    if (object.isSkinnedMesh) { object.frustumCulled = false; object.castShadow = true; object.receiveShadow = true; }
  });
}

function disposeResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse?.((object) => {
    if (object.geometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose?.();
    }
    const entries = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of entries) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !textures.has(value)) {
          textures.add(value);
          value.dispose?.();
        }
      }
      material.dispose?.();
    }
  });
}

function discoverBones(root) {
  const bones = {};
  root.traverse?.((object) => { if (object.isBone || object.type === "Bone" || WEBXR_JOINTS.includes(object.name)) bones[object.name] = object; });
  if (!WEBXR_JOINTS.every((name) => bones[name])) throw new Error("hand asset missing required joint");
  for (const name of WEBXR_JOINTS) bones[name].userData.restQuaternion = bones[name].quaternion.clone();
  return bones;
}

export class FirstPersonHand {
  constructor(options = {}) {
    this.camera = options.camera ?? null;
    this.loader = options.loader ?? new GLTFLoader();
    this.cloneScene = options.cloneScene ?? ((scene) => SkeletonUtils.clone(scene));
    this.root = new THREE.Group();
    this.root.name = "first-person-hand";
    this.root.visible = false;
    this.camera?.add(this.root);
    this.models = {};
    this.boneSets = {};
    this.materialRoots = {};
    this.bones = {};
    this.handedness = null;
    this.competingHandedness = null;
    this.competingSince = null;
    this.context = null;
    this.active = true;
    this.loaded = false;
    this.fallback = false;
    this.opacity = 0;
    this.lossFadeElapsed = 0;
    this.lossFadeStartOpacity = 0;
    this.lossActive = false;
    this.fallbackPose = "open";
  }

  async load() {
    if (this.loaded) return true;
    try {
      const loadOne = (url) => this.loader.loadAsync ? this.loader.loadAsync(url) : new Promise((resolve, reject) => this.loader.load(url, resolve, undefined, reject));
      const [left, right] = await Promise.all([loadOne("/assets/hands/left.glb"), loadOne("/assets/hands/right.glb")]);
      for (const [side, gltf] of [["left", left], ["right", right]]) {
        const scene = this.cloneScene(gltf.scene ?? gltf.scenes?.[0]);
        this.models[side] = scene;
        this.boneSets[side] = discoverBones(scene);
        this.materialRoots[side] = scene;
        setMaterialOpacity(scene, 0);
        scene.visible = false;
        this.root.add(scene);
      }
      this.loaded = true;
      this.fallback = false;
      this._activateModel("right");
      return true;
    } catch (error) {
      this.fallback = true;
      this.loaded = false;
      this.root.visible = false;
      this.error = error;
      return false;
    }
  }

  _activateModel(side) {
    if (!this.models[side]) return;
    for (const [name, model] of Object.entries(this.models)) model.visible = name === side;
    this.handedness = side;
    this.bones = this.boneSets[side];
    this._setOpacity(this.opacity);
  }

  _setOpacity(value) {
    this.opacity = clamp(value, 0, 1);
    for (const model of Object.values(this.materialRoots)) setMaterialOpacity(model, this.opacity);
    this.root.visible = this.active && this.loaded && this.opacity > 0.001;
  }

  setContext(context) { this.context = context; return this; }

  applyPose(pose = {}, delta = 0) {
    if (!this.loaded || !pose) return this;
    const seconds = Number.isFinite(delta) ? Math.max(0, delta > 10 ? delta / 1000 : delta) : 0;
    const requested = pose.handedness === "left" || pose.handedness === "right" ? pose.handedness : this.handedness ?? "right";
    if (requested !== this.handedness) {
      if (this.competingHandedness !== requested) { this.competingHandedness = requested; this.competingSince = 0; }
      this.competingSince += seconds * 1000;
      if (this.competingSince >= 500) { this._activateModel(requested); this.competingHandedness = null; this.competingSince = null; }
    } else { this.competingHandedness = null; this.competingSince = null; }

    const targetOpacity = Number.isFinite(pose.opacity) ? pose.opacity : pose.state === "lost" || pose.state === "unavailable" ? 0 : Number.isFinite(pose.trackingConfidence) ? pose.trackingConfidence : 1;
    const lost = targetOpacity <= 0 || pose.state === "lost" || pose.state === "unavailable";
    if (lost) {
      if (!this.lossActive) {
        this.lossActive = true;
        this.lossFadeElapsed = 0;
        this.lossFadeStartOpacity = this.opacity;
      }
      this.lossFadeElapsed += seconds * 1000;
      this._setOpacity(this.lossFadeStartOpacity * clamp(1 - this.lossFadeElapsed / 350, 0, 1));
      return this;
    }
    this.lossActive = false;
    this.lossFadeElapsed = 0;
    this.lossFadeStartOpacity = 0;
    this._setOpacity(targetOpacity);

    const center = finitePoint(pose.center ?? [0.5, 0.5, 0]);
    const biasY = this.context === "door-defense" ? -0.06 : 0;
    this.root.position.x = clamp((center[0] - 0.5) * 0.62, -0.31, 0.31);
    this.root.position.y = clamp((center[1] - 0.5) * 0.42 + biasY, -0.21, 0.21);
    const scale = clamp(Number.isFinite(pose.relativeScale) ? pose.relativeScale : 1, 0.5, 1.5);
    this.root.position.z = THREE.MathUtils.lerp(-0.86, -0.42, scale - 0.5);

    const joints = expandMediaPipeJoints(pose);
    const palmQ = quaternionFromBasis(pose.wrist);
    for (const joint of joints) {
      const bone = this.bones[joint.name];
      if (!bone) continue;
      bone.position.fromArray(joint.position);
      const target = new THREE.Quaternion(...joint.quaternion).normalize();
      if (joint.name === "wrist") target.premultiply(palmQ);
      const rest = bone.userData.restQuaternion ?? new THREE.Quaternion();
      bone.quaternion.copy(rest).multiply(target).normalize();
    }
    const curls = Array.isArray(pose.curls) ? pose.curls : [];
    for (let finger = 0; finger < 5; finger += 1) {
      const prefix = ["thumb", "index-finger", "middle-finger", "ring-finger", "pinky-finger"][finger];
      const curl = clamp(curls[finger], 0, 1);
      for (const segment of ["phalanx-proximal", "phalanx-intermediate", "phalanx-distal"]) {
        const bone = this.bones[`${prefix}-${segment}`];
        if (bone) bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), curl * Math.PI * 0.42)).normalize();
      }
    }
    return this;
  }

  setVisible(active) { this.active = Boolean(active); this._setOpacity(this.opacity); return this; }
  setFallbackPose(name = "open") { this.fallbackPose = name; return this; }

  destroy() {
    this.camera?.remove(this.root);
    for (const model of Object.values(this.models)) disposeResources(model);
    this.root.clear();
    this.models = {};
    this.boneSets = {};
    this.materialRoots = {};
    this.bones = {};
    this.camera = null;
    this.loaded = false;
  }
}
