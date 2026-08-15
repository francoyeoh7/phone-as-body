import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { createArmRigAdapter, createFlatWebXRAdapter } from "./hand-asset-adapter.js";
import { createRealisticSleeve } from "./realistic-sleeve.js";

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
const finiteVector3 = (value) => value?.isVector3 === true
  && [value.x, value.y, value.z].every(Number.isFinite);
const finiteQuaternion = (value) => value?.isQuaternion === true
  && [value.x, value.y, value.z, value.w].every(Number.isFinite)
  && value.lengthSq() > 1e-12;
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

function dampAlpha(seconds, timeConstant = 0.15) {
  return 1 - Math.exp(-Math.max(0, seconds) / timeConstant);
}

function targetToCameraPosition(camera, point) {
  if (!camera?.isCamera || !point?.isVector3) return null;
  camera.updateMatrixWorld?.();
  camera.updateProjectionMatrix?.();
  const local = camera.worldToLocal(point.clone());
  const distance = -local.z;
  if (!Number.isFinite(distance) || distance <= 0.05) return null;
  const depth = clamp(distance * 0.58, 0.55, 0.9);
  const screenScale = depth / distance;
  return new THREE.Vector3(local.x * screenScale, local.y * screenScale, -depth);
}

function trackedWristToCameraPosition(center, relativeScale = 1) {
  const x = Number.isFinite(center?.[0]) ? center[0] : 0.5;
  const y = Number.isFinite(center?.[1]) ? center[1] : 0.68;
  const scale = Number.isFinite(relativeScale) ? relativeScale : 1;
  return new THREE.Vector3(
    clamp(-0.46 + (x - 0.5) * 0.68, -0.7, -0.04),
    clamp(-0.48 + (0.6 - y) * 1.25, -0.7, 0.04),
    clamp(-0.68 + (scale - 1) * 0.12, -0.78, -0.56),
  );
}

function trackedShoulderToCameraPosition(center, wristTarget) {
  const x = Number.isFinite(center?.[0]) ? center[0] : 0.5;
  const y = Number.isFinite(center?.[1]) ? center[1] : 0.6;
  const lateral = clamp(x - 0.5, -0.5, 0.5);
  const vertical = clamp(0.6 - y, -0.4, 0.4);
  const lifted = Math.max(0, vertical);
  return new THREE.Vector3(
    clamp(-0.84 + lateral * 0.25 - vertical * 0.12, -0.96, -0.75),
    clamp(-0.9 - lifted * 0.56, -1.13, -0.9),
    clamp(wristTarget.z - 0.08, -0.86, -0.68),
  );
}

function enhancePresentationSkin(root) {
  const arms = root?.getObjectByName?.("ArmsMesh");
  if (!arms?.material) return;
  const materials = Array.isArray(arms.material) ? arms.material : [arms.material];
  for (const material of materials) {
    material.metalness = 0;
    material.roughness = 0.68;
    material.clearcoat = 0.045;
    material.clearcoatRoughness = 0.72;
    material.flatShading = false;
    if (material.map) {
      material.map.magFilter = THREE.LinearFilter;
      material.map.minFilter = THREE.LinearMipmapLinearFilter;
      material.map.generateMipmaps = true;
      material.map.anisotropy = Math.max(material.map.anisotropy ?? 1, 8);
      material.map.needsUpdate = true;
    }
    material.needsUpdate = true;
  }
  arms.geometry?.computeVertexNormals?.();
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

function segmentCurl(previous, joint, next) {
  const incoming = subtract(joint, previous);
  const outgoing = subtract(next, joint);
  const incomingLength = Math.hypot(...incoming);
  const outgoingLength = Math.hypot(...outgoing);
  if (incomingLength < 1e-8 || outgoingLength < 1e-8) return 0;
  const cosine = incoming.reduce((sum, value, index) => sum + value * outgoing[index], 0)
    / (incomingLength * outgoingLength);
  return clamp(Math.acos(clamp(cosine, -1, 1)) / (Math.PI * 0.65), 0, 1);
}

export function expandMediaPipeJoints(pose = {}) {
  const source = Array.isArray(pose.worldLandmarks) && pose.worldLandmarks.length >= 21 ? pose.worldLandmarks : pose.landmarks;
  const points = Array.from({ length: 21 }, (_, index) => finitePoint(source?.[index]));
  const entries = [];
  const add = (name, position, childIndex, previousIndex) => {
    const child = childIndex === undefined ? position : points[childIndex];
    const entry = { name, position: position.slice(), quaternion: jointQuaternion(position, child, pose.wrist) };
    if (previousIndex !== undefined && childIndex !== undefined) {
      entry.curl = segmentCurl(points[previousIndex], position, child);
    }
    entries.push(entry);
  };
  add("wrist", points[0], 9);
  add("thumb-metacarpal", points[1], 2, 0);
  add("thumb-phalanx-proximal", points[2], 3, 1);
  add("thumb-phalanx-distal", points[3], 4, 2);
  add("thumb-tip", points[4], 4);
  for (const [prefix, chain] of [["index-finger", MP.index], ["middle-finger", MP.middle], ["ring-finger", MP.ring], ["pinky-finger", MP.pinky]]) {
    add(`${prefix}-metacarpal`, interpolate(points[0], points[chain[0]], 0.35), chain[1]);
    add(`${prefix}-phalanx-proximal`, points[chain[0]], chain[1], 0);
    add(`${prefix}-phalanx-intermediate`, points[chain[1]], chain[2], chain[0]);
    add(`${prefix}-phalanx-distal`, points[chain[2]], chain[3], chain[1]);
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

function boundsInParent(root, parent) {
  root.updateWorldMatrix?.(true, true);
  parent.updateWorldMatrix?.(true, false);
  const toParent = parent.matrixWorld.clone().invert();
  const points = [];
  root.traverse?.((object) => {
    if (!object.geometry) return;
    object.geometry.computeBoundingBox?.();
    const bounds = object.geometry.boundingBox;
    if (!bounds) return;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          points.push(new THREE.Vector3(x, y, z)
            .applyMatrix4(object.matrixWorld)
            .applyMatrix4(toParent));
        }
      }
    }
  });
  return points.length > 0 ? new THREE.Box3().setFromPoints(points) : null;
}

function fitHeldItemToGrip(item, grip, definition = {}) {
  const offset = Array.isArray(definition.position)
    && definition.position.slice(0, 3).every(Number.isFinite)
    ? new THREE.Vector3().fromArray(definition.position.slice(0, 3))
    : new THREE.Vector3();
  item.position.set(0, 0, 0);
  if (Array.isArray(definition.rotation)
    && definition.rotation.slice(0, 3).every(Number.isFinite)) {
    item.rotation.set(...definition.rotation.slice(0, 3));
  }
  if (Number.isFinite(definition.scale) && definition.scale > 0) {
    item.scale.setScalar(definition.scale);
  }
  grip.add(item);
  let bounds = boundsInParent(item, grip);
  if (!bounds) {
    item.position.copy(offset);
    return;
  }
  const longestEdge = Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  if (longestEdge > 0.15) {
    item.scale.multiplyScalar(0.15 / longestEdge);
    bounds = boundsInParent(item, grip);
  }
  if (bounds) item.position.add(offset.sub(bounds.getCenter(new THREE.Vector3())));
}

function discoverArmBones(root) {
  const bones = {};
  root?.traverse?.((object) => {
    if (object.isBone || object.type === "Bone") bones[object.name] = object;
  });
  for (const suffix of ["L", "R"]) {
    for (const name of ["shoulder", "hand", "palm01", "palm02", "palm03", "palm04", "thumb01", "thumb02", "thumb03", "f_index01", "f_index02", "f_index03", "f_middle01", "f_middle02", "f_middle03", "f_ring01", "f_ring02", "f_ring03", "f_pinky01", "f_pinky02", "f_pinky03"]) {
      if (!bones[`${name}${suffix}`]) throw new Error("arm asset missing required bone");
    }
  }
  return bones;
}

function abortError(signal) {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function loadWithSignal(loadOne, url, signal) {
  if (!signal) return loadOne(url);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(loadOne(url)).then(
      (gltf) => {
        signal.removeEventListener("abort", onAbort);
        if (settled || signal.aborted) {
          disposeResources(gltf?.scene ?? gltf?.scenes?.[0]);
          if (!settled) {
            settled = true;
            reject(abortError(signal));
          }
          return;
        }
        settled = true;
        resolve(gltf);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

export function retainSkinnedSide(root, side = "left") {
  const activeSuffix = side === "left" ? "L" : "R";
  const inactiveSuffix = activeSuffix === "L" ? "R" : "L";
  root.traverse?.((object) => {
    if (!object.isSkinnedMesh || !object.geometry?.index) return;
    const geometry = object.geometry.clone();
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    if (!skinIndex || !skinWeight) return;
    const scoreVertex = (vertex) => {
      let score = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const boneIndex = skinIndex.getComponent(vertex, slot);
        const weight = skinWeight.getComponent(vertex, slot);
        const name = object.skeleton?.bones?.[boneIndex]?.name ?? "";
        if (name.endsWith(activeSuffix)) score += weight;
        else if (name.endsWith(inactiveSuffix)) score -= weight;
      }
      return score;
    };
    const source = geometry.index.array;
    const kept = [];
    for (let index = 0; index < source.length; index += 3) {
      const a = source[index];
      const b = source[index + 1];
      const c = source[index + 2];
      if (scoreVertex(a) + scoreVertex(b) + scoreVertex(c) > 0.01) kept.push(a, b, c);
    }
    geometry.setIndex(kept);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    object.geometry = geometry;
  });
  return root;
}

export class FirstPersonHand {
  constructor(options = {}) {
    this.camera = options.camera ?? null;
    this.loader = options.loader ?? new GLTFLoader();
    this.cloneScene = options.cloneScene ?? ((scene) => SkeletonUtils.clone(scene));
    this.root = new THREE.Group();
    this.root.name = "first-person-hand";
    this.root.visible = false;
    this.heldSocket = new THREE.Group();
    this.heldSocket.name = "left-palm-socket";
    // The authored hand's curled finger envelope ends around local X=0.055.
    // Keep equipment just outside that surface while centering it through the
    // palm height, so the fingers visually wrap beside it without intersecting.
    this.heldSocket.position.set(0.1, 0.057, 0.006);
    this.heldGrip = new THREE.Group();
    this.heldGrip.name = "left-palm-grip";
    this.heldGrip.visible = false;
    this.palmGrip = this.heldGrip;
    if (typeof this.camera?.add === "function") this.camera.add(this.root, this.heldGrip);
    else this.root.add(this.heldGrip);
    this.models = {};
    this.boneSets = {};
    this.adapters = {};
    this.presentationModel = null;
    this.presentationSleeve = null;
    this.presentationBones = null;
    this.presentationAdapters = {};
    this.materialRoots = {};
    this.bones = {};
    this.adapter = null;
    this.handedness = null;
    this.context = null;
    this.active = true;
    this.loaded = false;
    this.fallback = false;
    this.opacity = 0;
    this.lossFadeElapsed = 0;
    this.lossFadeStartOpacity = 0;
    this.lossActive = false;
    this.fallbackPose = "open";
    this.targetContact = null;
    this.poseInitialized = false;
    this.heldItem = null;
    this.holding = false;
    this.heldGripInitialized = false;
    this.heldGripVelocity = new THREE.Vector3();
  }

  async load({ signal } = {}) {
    if (this.loaded) return true;
    try {
      const loadOne = (url) => this.loader.loadAsync ? this.loader.loadAsync(url) : new Promise((resolve, reject) => this.loader.load(url, resolve, undefined, reject));
      const left = await loadWithSignal(loadOne, "/assets/hands/left.glb", signal);
      throwIfAborted(signal);
      const leftScene = this.cloneScene(left.scene ?? left.scenes?.[0]);
      this.models.left = leftScene;
      this.boneSets.left = discoverBones(leftScene);
      this.adapters.left = createFlatWebXRAdapter(this.boneSets.left, "left");
      this.materialRoots.left = leftScene;
      setMaterialOpacity(leftScene, 0);
      leftScene.visible = false;
      this.root.add(leftScene);
      let presentationScene = null;
      try {
        const gltf = await loadWithSignal(loadOne, "/assets/hands/psx-arms.glb", signal);
        throwIfAborted(signal);
        presentationScene = retainSkinnedSide(this.cloneScene(gltf.scene ?? gltf.scenes?.[0]), "left");
        enhancePresentationSkin(presentationScene);
        presentationScene.animations = gltf.animations ?? [];
        const bones = discoverArmBones(presentationScene);
        this.presentationModel = presentationScene;
        this.presentationBones = bones;
        this.presentationAdapters.left = createArmRigAdapter(presentationScene, bones, "left", gltf.animations);
        this.presentationSleeve = createRealisticSleeve(presentationScene, bones, "left");
        this.materialRoots.presentation = presentationScene;
        setMaterialOpacity(presentationScene, 0);
        presentationScene.visible = false;
        this.root.add(presentationScene);
      } catch (error) {
        if (presentationScene?.parent === this.root) this.root.remove(presentationScene);
        if (presentationScene) disposeResources(presentationScene);
        this.presentationModel = null;
        this.presentationSleeve = null;
        this.presentationBones = null;
        this.presentationAdapters = {};
        this.presentationLoadError = error;
      }
      this.loaded = true;
      this.fallback = false;
      this._activateModel();
      return true;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        this.destroy();
        throw error;
      }
      this.fallback = true;
      this.loaded = false;
      this.root.visible = false;
      this.error = error;
      return false;
    }
  }

  _activateModel() {
    if (!this.models.left) return;
    this.models.left.visible = !this.presentationModel;
    if (this.presentationModel) {
      this.presentationModel.visible = true;
      this.presentationAdapters.left?.prepareModel?.();
    }
    this.handedness = "left";
    this.bones = this.boneSets.left;
    this.adapter = this.adapters.left ?? null;
    const palm = this.presentationBones?.handL ?? this.bones.wrist;
    palm?.add?.(this.heldSocket);
    this.heldGripInitialized = false;
    this._setOpacity(this.opacity);
  }

  _setOpacity(value) {
    this.opacity = clamp(value, 0, 1);
    for (const model of Object.values(this.materialRoots)) setMaterialOpacity(model, this.opacity);
    this.root.visible = this.active && this.loaded && this.opacity > 0.001;
    this.heldGrip.visible = this.root.visible && this.holding && Boolean(this.heldItem);
  }

  setHeldItem(object3D = null) {
    if (object3D === this.heldItem) return this;
    if (this.heldItem) {
      this.heldGrip.remove(this.heldItem);
      disposeResources(this.heldItem);
    }
    this.heldItem = object3D?.isObject3D ? object3D : null;
    if (this.heldItem) {
      this.heldItem.traverse?.((object) => {
        if (!object.userData) return;
        delete object.userData.interactableId;
        delete object.userData.interaction;
      });
      this.heldItem.visible = this.holding;
      const grip = this.heldItem.userData?.handGrip;
      fitHeldItemToGrip(this.heldItem, this.heldGrip, grip);
      this.materialRoots.held = this.heldItem;
      setMaterialOpacity(this.heldItem, this.opacity);
    } else {
      delete this.materialRoots.held;
    }
    return this;
  }

  setHolding(active) {
    this.holding = active === true;
    if (this.heldItem) this.heldItem.visible = this.holding;
    this.heldGrip.visible = this.root.visible && this.holding && Boolean(this.heldItem);
    if (this.holding) this.heldGripInitialized = false;
    return this;
  }

  updateHeldGrip(delta = 0) {
    if (!this.heldSocket || !this.heldGrip?.parent) return this;
    const frame = this.heldGrip.parent;
    frame.updateWorldMatrix?.(true, false);
    this.heldSocket.updateWorldMatrix?.(true, false);
    const targetPosition = this.heldSocket.getWorldPosition(new THREE.Vector3());
    frame.worldToLocal?.(targetPosition);
    const targetQuaternion = this.heldSocket.getWorldQuaternion(new THREE.Quaternion());
    const frameQuaternion = frame.getWorldQuaternion?.(new THREE.Quaternion()) ?? new THREE.Quaternion();
    targetQuaternion.premultiply(frameQuaternion.invert()).normalize();
    if (!this.heldGripInitialized) {
      this.heldGrip.position.copy(targetPosition);
      if (this.holding && this.heldItem) {
        this.heldGrip.position.add(new THREE.Vector3(0.024, -0.012, 0.018)
          .applyQuaternion(targetQuaternion));
      }
      this.heldGrip.quaternion.copy(targetQuaternion);
      this.heldGripVelocity.set(0, 0, 0);
      this.heldGripInitialized = true;
      return this;
    }
    const seconds = clamp(delta, 0, 0.05);
    const omega = 19;
    const decay = Math.exp(-omega * seconds);
    for (const axis of ["x", "y", "z"]) {
      const displacement = this.heldGrip.position[axis] - targetPosition[axis];
      const temporary = (this.heldGripVelocity[axis] + omega * displacement) * seconds;
      this.heldGrip.position[axis] = targetPosition[axis] + (displacement + temporary) * decay;
      this.heldGripVelocity[axis] = (this.heldGripVelocity[axis] - omega * temporary) * decay;
    }
    this.heldGrip.quaternion.slerp(targetQuaternion, 1 - Math.exp(-seconds / 0.055));
    return this;
  }

  setContext(context) { this.context = context; return this; }

  setTargetContact(contact = null) {
    const point = contact?.point?.isVector3
      ? contact.point.clone()
      : Array.isArray(contact?.point) ? new THREE.Vector3(...contact.point.slice(0, 3)) : null;
    const normal = contact?.normal?.isVector3
      ? contact.normal.clone()
      : Array.isArray(contact?.normal) ? new THREE.Vector3(...contact.normal.slice(0, 3)) : null;
    const epoch = Number.isInteger(contact?.epoch) && contact.epoch >= 0 ? contact.epoch : null;
    this.targetContact = point && point.toArray().every(Number.isFinite)
      ? {
        point,
        normal: normal && normal.toArray().every(Number.isFinite) ? normal : null,
        epoch,
        engaged: contact?.engaged === true,
      }
      : null;
    return this;
  }

  applyPose(pose = {}, delta = 0) {
    if (!this.loaded || !pose) return this;
    const seconds = Number.isFinite(delta) ? Math.max(0, delta > 10 ? delta / 1000 : delta) : 0;
    if (pose.handedness && pose.handedness !== "left") return this;

    const targetOpacity = Number.isFinite(pose.opacity) ? pose.opacity : pose.state === "lost" || pose.state === "unavailable" ? 0 : Number.isFinite(pose.trackingConfidence) ? pose.trackingConfidence : 1;
    const lost = targetOpacity <= 0 || pose.state === "lost" || pose.state === "unavailable";
    if (lost) {
      this.lossActive = true;
      this.lossFadeElapsed = 0;
      this.lossFadeStartOpacity = 0;
      this._setOpacity(0);
      return this;
    }
    this.lossActive = false;
    this.lossFadeElapsed = 0;
    this.lossFadeStartOpacity = 0;
    this._setOpacity(targetOpacity);

    const center = finitePoint(pose.center ?? [0.5, 0.58, 0]);
    const side = "left";
    const eligible = typeof pose.reachEligible === "boolean" ? pose.reachEligible : true;
    const scale = clamp(Number.isFinite(pose.relativeScale) ? pose.relativeScale : 1, 0.6, 1.4);
    const desired = trackedWristToCameraPosition(center, scale);
    const shoulderTarget = trackedShoulderToCameraPosition(center, desired);
    if (eligible) {
      const contactActive = pose.handedness === "left" && this.targetContact?.engaged === true;
      const contactPoint = contactActive ? this.targetContact.point.clone() : null;
      if (contactPoint && this.targetContact.normal?.lengthSq() > 1e-8) {
        contactPoint.add(this.targetContact.normal.clone().normalize().multiplyScalar(0.04));
      }
      const targetPosition = targetToCameraPosition(this.camera, contactPoint);
      const reachProgress = Number.isFinite(pose.reachProgress) ? pose.reachProgress : 1;
      if (targetPosition) desired.lerp(targetPosition, clamp(reachProgress, 0, 1));
    }
    const joints = expandMediaPipeJoints(pose);
    const presentationAdapter = this.presentationAdapters[side] ?? null;
    const mapped = presentationAdapter?.mapJoints(joints, pose, {
      wristTarget: desired,
      shoulderTarget,
    }) ?? this.adapter?.mapJoints(joints, pose);
    const mappedRootQuaternion = mapped?.rootQuaternion;
    const palmQ = finiteQuaternion(mappedRootQuaternion)
      ? mappedRootQuaternion
      : mappedRootQuaternion ? this.root.quaternion.clone() : quaternionFromBasis(pose.wrist);
    const rootTarget = finiteVector3(mapped?.rootPosition) ? mapped.rootPosition : desired;
    if (!this.poseInitialized) {
      this.root.position.copy(rootTarget);
      this.root.quaternion.copy(palmQ);
      this.poseInitialized = true;
    } else {
      this.root.position.lerp(rootTarget, dampAlpha(seconds, 0.045));
      this.root.quaternion.slerp(palmQ, dampAlpha(seconds, 0.045));
    }

    if (presentationAdapter && this.presentationModel) {
      const modelScale = clamp(mapped?.palmScale ?? mapped?.scale ?? 1, 0.65, 1.35);
      this.presentationModel.scale.setScalar(modelScale);
      this.presentationModel.position
        .copy(mapped?.handOffset ?? presentationAdapter.restHandPosition)
        .multiplyScalar(-modelScale);
    }
    const activeBones = presentationAdapter ? this.presentationBones : this.bones;
    for (const [name, transform] of Object.entries(mapped?.transforms ?? {})) {
      const bone = activeBones?.[name];
      if (!bone || !transform) continue;
      if (finiteVector3(transform.position)) bone.position.copy(transform.position);
      if (finiteQuaternion(transform.quaternion)) bone.quaternion.copy(transform.quaternion).normalize();
    }
    this.updateHeldGrip(seconds);
    return this;
  }

  setVisible(active) { this.active = Boolean(active); this._setOpacity(this.opacity); return this; }
  setFallbackPose(name = "open") { this.fallbackPose = name; return this; }

  destroy() {
    if (typeof this.camera?.remove === "function") this.camera.remove(this.root, this.heldGrip);
    this.setHeldItem(null);
    for (const model of Object.values(this.models)) disposeResources(model);
    if (this.presentationModel) disposeResources(this.presentationModel);
    this.root.clear();
    this.models = {};
    this.boneSets = {};
    this.adapters = {};
    this.presentationModel = null;
    this.presentationSleeve = null;
    this.presentationBones = null;
    this.presentationAdapters = {};
    this.materialRoots = {};
    this.heldGrip = null;
    this.heldSocket = null;
    this.palmGrip = null;
    this.bones = {};
    this.adapter = null;
    this.targetContact = null;
    this.poseInitialized = false;
    this.heldGripInitialized = false;
    this.heldGripVelocity = null;
    this.camera = null;
    this.loaded = false;
  }
}
