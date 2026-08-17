import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { retainSkinnedSide } from "./FirstPersonHand.js";
import { createRealisticSleeve } from "./realistic-sleeve.js";

const ASSET_URL = "/assets/hands/psx-arms.glb";
const CAMERA_FORWARD = new THREE.Vector3(-0.26, 0.12, -1).normalize();
const DESIRED_ARM = new THREE.Vector3(0.36, -0.42, 0.18).normalize();
const RIGHT_ARM_TO_HAND_DIRECTION = new THREE.Vector3(-0.65, 0.84, -0.20).normalize();
const HAND_OFFSET_FROM_ROOT = new THREE.Vector3(0, -0.10, -0.24);
const EPSILON = 1e-8;
const IDLE_BOB_FREQUENCY = 0.2;
const MOVEMENT_BOB_FREQUENCY = 1 / 1.5;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const isFiniteVector = (vector) => Number.isFinite(vector.x)
  && Number.isFinite(vector.y)
  && Number.isFinite(vector.z);
const isFiniteQuaternion = (quaternion) => Number.isFinite(quaternion.x)
  && Number.isFinite(quaternion.y)
  && Number.isFinite(quaternion.z)
  && Number.isFinite(quaternion.w);
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

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
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (settled || signal.aborted) {
          disposeResources(value?.scene ?? value?.scenes?.[0]);
          if (!settled) reject(abortError(signal));
          return;
        }
        settled = true;
        resolve(value);
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

function discoverBones(root) {
  const bones = {};
  root?.traverse?.((object) => {
    if (object.isBone || object.type === "Bone") bones[object.name] = object;
  });
  for (const name of [
    "shoulderR", "upper_armR", "forearmR", "handR",
    "palm01R", "palm02R", "palm03R", "palm04R",
    "f_index01R", "f_index02R", "f_middle01R", "f_middle02R",
    "f_ring01R", "f_ring02R", "f_pinky01R", "f_pinky02R",
  ]) {
    if (!bones[name]) throw new Error(`right arm asset missing ${name}`);
  }
  return bones;
}

function disposeResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.((object) => {
    if (object.geometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose?.();
    }
    const entries = Array.isArray(object.material)
      ? object.material
      : object.material ? [object.material] : [];
    for (const material of entries) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (!value?.isTexture || textures.has(value)) continue;
        textures.add(value);
        value.dispose?.();
      }
      material.dispose?.();
    }
  });
}

function orthonormalFrame(forwardSeed, upSeed) {
  const forward = isFiniteVector(forwardSeed) && forwardSeed.lengthSq() >= EPSILON
    ? forwardSeed.clone().normalize()
    : new THREE.Vector3(0, 0, -1);
  let up = isFiniteVector(upSeed)
    ? upSeed.clone().sub(forward.clone().multiplyScalar(upSeed.dot(forward)))
    : new THREE.Vector3(0, 1, 0);
  if (!isFiniteVector(up) || up.lengthSq() < EPSILON) up = new THREE.Vector3(0, 1, 0);
  up.normalize();
  const right = up.clone().cross(forward);
  if (!isFiniteVector(right) || right.lengthSq() < EPSILON) {
    const fallbackAxis = Math.abs(forward.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    right.copy(fallbackAxis.cross(forward).normalize());
  } else {
    right.normalize();
  }
  up = forward.clone().cross(right).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, forward),
  ).normalize();
}

function averageBonePosition(bones, names) {
  const result = new THREE.Vector3();
  for (const name of names) result.add(bones[name].getWorldPosition(new THREE.Vector3()));
  return result.multiplyScalar(1 / names.length);
}

function aimBoneAtDirection(root, bone, endBone, direction) {
  root.updateMatrixWorld(true);
  const start = bone.getWorldPosition(new THREE.Vector3());
  const end = endBone.getWorldPosition(new THREE.Vector3());
  const current = end.sub(start);
  if (!isFiniteVector(current) || !isFiniteVector(direction)
    || current.lengthSq() < EPSILON || direction.lengthSq() < EPSILON) return;
  current.normalize();
  const target = direction.clone().normalize();
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(current, target);
  if (!isFiniteQuaternion(worldDelta)) return;
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  if (!isFiniteQuaternion(parentWorld)) return;
  const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
  if (!isFiniteQuaternion(localDelta)) return;
  const candidate = bone.quaternion.clone().premultiply(localDelta);
  if (!isFiniteQuaternion(candidate) || candidate.lengthSq() < EPSILON) return;
  bone.quaternion.copy(candidate.normalize());
  root.updateMatrixWorld(true);
}

function frameFromPalmAxes(lateralSeed, longitudinalSeed, fallbackNormal) {
  const lateral = lateralSeed.clone();
  if (!isFiniteVector(lateral) || lateral.lengthSq() < EPSILON) lateral.set(1, 0, 0);
  lateral.normalize();

  let longitudinal = longitudinalSeed.clone()
    .addScaledVector(lateral, -longitudinalSeed.dot(lateral));
  if (!isFiniteVector(longitudinal) || longitudinal.lengthSq() < EPSILON) {
    longitudinal = fallbackNormal.clone().cross(lateral);
  }
  if (!isFiniteVector(longitudinal) || longitudinal.lengthSq() < EPSILON) {
    const fallbackAxis = Math.abs(lateral.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    longitudinal = fallbackAxis.cross(lateral);
  }
  longitudinal.normalize();
  const normal = lateral.clone().cross(longitudinal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(lateral, longitudinal, normal),
  ).normalize();
}

function alignHandToCameraReference(root, bones, camera) {
  root.updateMatrixWorld(true);
  const hand = bones.handR;
  const palm = averageBonePosition(bones, ["palm01R", "palm02R", "palm03R", "palm04R"]);
  const lateral = bones.palm01R.getWorldPosition(new THREE.Vector3())
    .sub(bones.palm04R.getWorldPosition(new THREE.Vector3()));
  const longitudinal = palm.sub(hand.getWorldPosition(new THREE.Vector3()));
  const cameraQuaternion = camera?.getWorldQuaternion(new THREE.Quaternion())
    ?? new THREE.Quaternion();
  if (!isFiniteQuaternion(cameraQuaternion)) cameraQuaternion.identity();
  const targetLongitudinal = new THREE.Vector3(-0.30, 0.95, 0)
    .applyQuaternion(cameraQuaternion)
    .normalize();
  const targetLateral = new THREE.Vector3(-0.95, -0.30, 0)
    .applyQuaternion(cameraQuaternion)
    .normalize();
  const targetNormal = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(cameraQuaternion)
    .normalize();
  const sourceFrame = frameFromPalmAxes(lateral, longitudinal, targetNormal);
  const targetFrame = frameFromPalmAxes(targetLateral, targetLongitudinal, targetNormal);
  const worldDelta = targetFrame.multiply(sourceFrame.invert()).normalize();
  const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
  if (!isFiniteQuaternion(worldDelta) || !isFiniteQuaternion(handWorld)) {
    return {
      alignment: "camera-relative-palm-frame",
      lateral: targetLateral.toArray(),
      longitudinal: targetLongitudinal.toArray(),
      normal: targetNormal.toArray(),
    };
  }
  const targetHandWorld = worldDelta.multiply(handWorld).normalize();
  const parentWorld = hand.parent.getWorldQuaternion(new THREE.Quaternion());
  if (!isFiniteQuaternion(targetHandWorld) || !isFiniteQuaternion(parentWorld)) {
    return {
      alignment: "camera-relative-palm-frame",
      lateral: targetLateral.toArray(),
      longitudinal: targetLongitudinal.toArray(),
      normal: targetNormal.toArray(),
    };
  }
  hand.quaternion.copy(parentWorld.invert().multiply(targetHandWorld)).normalize();
  root.updateMatrixWorld(true);

  return {
    alignment: "camera-relative-palm-frame",
    lateral: targetLateral.toArray(),
    longitudinal: targetLongitudinal.toArray(),
    normal: targetNormal.toArray(),
  };
}

function extendArmToScreenBoundary(root, bones, camera) {
  root.updateMatrixWorld(true);
  const handWorldQuaternion = bones.handR.getWorldQuaternion(new THREE.Quaternion());
  const cameraQuaternion = camera?.getWorldQuaternion(new THREE.Quaternion())
    ?? new THREE.Quaternion();
  if (!isFiniteQuaternion(cameraQuaternion)) cameraQuaternion.identity();
  const desiredWorldDirection = RIGHT_ARM_TO_HAND_DIRECTION.clone()
    .applyQuaternion(cameraQuaternion).normalize();
  aimBoneAtDirection(root, bones.shoulderR, bones.upper_armR, desiredWorldDirection);
  aimBoneAtDirection(root, bones.upper_armR, bones.forearmR, desiredWorldDirection);
  aimBoneAtDirection(root, bones.forearmR, bones.handR, desiredWorldDirection);
  const parentWorldQuaternion = bones.handR.parent.getWorldQuaternion(new THREE.Quaternion());
  if (isFiniteQuaternion(handWorldQuaternion) && isFiniteQuaternion(parentWorldQuaternion)) {
    const preservedHand = parentWorldQuaternion.clone().invert().multiply(handWorldQuaternion);
    if (isFiniteQuaternion(preservedHand)) bones.handR.quaternion.copy(preservedHand.normalize());
  }
  root.updateMatrixWorld(true);
}

function createFlashlightModel(radius) {
  const root = new THREE.Group();
  root.name = "right-hand-flashlight-model";
  const handleLength = clamp(radius * 9.4, 0.205, 0.275);
  const headLength = clamp(radius * 2.3, 0.05, 0.072);
  const handleMaterial = new THREE.MeshStandardMaterial({
    name: "FlashlightAnodizedMetal",
    color: 0x22272a,
    metalness: 0.72,
    roughness: 0.31,
  });
  const gripMaterial = new THREE.MeshStandardMaterial({
    name: "FlashlightRubberGrip",
    color: 0x111416,
    metalness: 0.08,
    roughness: 0.76,
  });
  const lensMaterial = new THREE.MeshPhysicalMaterial({
    name: "FlashlightLens",
    color: 0xe7f1e8,
    emissive: 0xb9d7c4,
    emissiveIntensity: 0.68,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.18,
    thickness: 0.015,
  });

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.96, handleLength, 28, 2),
    handleMaterial,
  );
  body.name = "right-hand-flashlight-body";
  body.position.y = radius * 0.55;
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.52, radius * 1.18, headLength, 32, 2),
    handleMaterial.clone(),
  );
  head.name = "right-hand-flashlight-head";
  head.position.y = body.position.y + handleLength * 0.5 + headLength * 0.42;
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.28, radius * 1.28, radius * 0.18, 32),
    lensMaterial,
  );
  lens.name = "right-hand-flashlight-lens";
  lens.position.y = head.position.y + headLength * 0.52;

  root.add(body, head, lens);
  const gripStart = body.position.y - handleLength * 0.32;
  for (let index = 0; index < 5; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.015, radius * 0.055, 8, 24),
      gripMaterial,
    );
    ring.name = `right-hand-flashlight-grip-${index + 1}`;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = gripStart + index * radius * 0.72;
    root.add(ring);
  }
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  return { root, body };
}

export function motionProfileForSpeed(speed = 0, maxSpeed = 3.25) {
  const normalized = clamp(Math.abs(speed) / Math.max(0.01, Math.abs(maxSpeed)), 0, 1);
  const walk = smoothstep((normalized - 0.06) / 0.58);
  const run = smoothstep((normalized - 0.64) / 0.34);
  return {
    normalized,
    walk,
    run,
    frequency: IDLE_BOB_FREQUENCY
      + walk * (MOVEMENT_BOB_FREQUENCY - IDLE_BOB_FREQUENCY),
    translationAmplitude: 0.0032 + walk * 0.011 + run * 0.024,
    rotationAmplitude: 0.005 + walk * 0.017 + run * 0.031,
  };
}

export class RightHandFlashlight {
  constructor(options = {}) {
    this.camera = options.camera ?? null;
    this.loader = options.loader ?? new GLTFLoader();
    this.cloneScene = options.cloneScene ?? ((scene) => SkeletonUtils.clone(scene));
    this.root = new THREE.Group();
    this.root.name = "persistent-right-flashlight-hand";
    this.root.visible = false;
    this.basePosition = new THREE.Vector3(0.34, -0.28, -0.62);
    this.root.position.copy(this.basePosition);
    this.baseQuaternion = new THREE.Quaternion();
    this.model = null;
    this.bones = {};
    this.handBone = null;
    this.sleeve = null;
    this.flashlightSocket = null;
    this.flashlightBody = null;
    this.mixer = null;
    this.action = null;
    this.phase = 0;
    this.smoothedSpeed = 0;
    this.bobFrequency = null;
    this.bobTranslationAmplitude = null;
    this.bobRotationAmplitude = null;
    this.loaded = false;
    this.destroyed = false;
    if (typeof this.camera?.add === "function") this.camera.add(this.root);
  }

  async load({ signal } = {}) {
    if (this.loaded) return true;
    if (this.destroyed) return false;
    let model = null;
    try {
      const loadOne = (url) => this.loader.loadAsync
        ? this.loader.loadAsync(url)
        : new Promise((resolve, reject) => this.loader.load(url, resolve, undefined, reject));
      const gltf = await loadWithSignal(loadOne, ASSET_URL, signal);
      throwIfAborted(signal);
      model = retainSkinnedSide(this.cloneScene(gltf.scene ?? gltf.scenes?.[0]), "right");
      const animations = gltf.animations ?? [];
      model.animations = animations;
      const bones = discoverBones(model);
      const grabClip = animations.find((clip) => clip.name === "grab.R");
      if (!grabClip) throw new Error("right arm asset missing grab.R animation");
      const armRest = Object.fromEntries(
        ["shoulderR", "upper_armR", "forearmR", "handR"].map((name) => [name, {
          position: bones[name].position.clone(),
          quaternion: bones[name].quaternion.clone(),
          scale: bones[name].scale.clone(),
        }]),
      );

      this.mixer = new THREE.AnimationMixer(model);
      this.action = this.mixer.clipAction(grabClip);
      this.action.setLoop(THREE.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.play();
      this.mixer.setTime(grabClip.duration);
      this.mixer.update(0);
      this.action.paused = true;
      for (const name of ["shoulderR", "upper_armR", "forearmR"]) {
        bones[name].position.copy(armRest[name].position);
        bones[name].quaternion.copy(armRest[name].quaternion);
        bones[name].scale.copy(armRest[name].scale);
      }
      bones.handR.position.copy(armRest.handR.position);
      bones.handR.scale.copy(armRest.handR.scale);
      model.updateMatrixWorld(true);
      model.userData.grabEndLocalQuaternions = {};
      model.traverse((object) => {
        if (!object.isBone || !/^(palm|thumb|f_)/.test(object.name)) return;
        model.userData.grabEndLocalQuaternions[object.name] = object.quaternion.toArray();
      });

      this.sleeve = createRealisticSleeve(model, bones, "right");
      model.updateMatrixWorld(true);
      const handPosition = bones.handR.getWorldPosition(new THREE.Vector3());
      const palm01 = bones.palm01R.getWorldPosition(new THREE.Vector3());
      const palm04 = bones.palm04R.getWorldPosition(new THREE.Vector3());
      const shoulder = bones.shoulderR.getWorldPosition(new THREE.Vector3());
      const sourceFrame = orthonormalFrame(
        palm01.clone().sub(palm04),
        shoulder.clone().sub(handPosition),
      );
      const targetFrame = orthonormalFrame(CAMERA_FORWARD, DESIRED_ARM);
      model.quaternion.copy(targetFrame.multiply(sourceFrame.invert()).normalize());
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      });
      this.root.add(model);
      this.model = model;
      this.bones = bones;
      this.handBone = bones.handR;
      this.root.updateMatrixWorld(true);
      extendArmToScreenBoundary(this.root, bones, this.camera);
      model.userData.firstPersonWristReference = alignHandToCameraReference(
        this.root,
        bones,
        this.camera,
      );
      for (const [name, quaternion] of Object.entries(model.userData.grabEndLocalQuaternions)) {
        model.getObjectByName(name).quaternion.fromArray(quaternion).normalize();
      }
      this.root.updateMatrixWorld(true);
      const currentHandInRoot = this.root.worldToLocal(
        bones.handR.getWorldPosition(new THREE.Vector3()),
      );
      model.position.add(HAND_OFFSET_FROM_ROOT.clone().sub(currentHandInRoot));
      this.root.updateMatrixWorld(true);

      const palm = averageBonePosition(bones, ["palm01R", "palm02R", "palm03R", "palm04R"]);
      const fingerCenter = averageBonePosition(bones, ["f_index02R", "f_middle02R", "f_ring02R", "f_pinky02R"]);
      const axisWorld = bones.palm01R.getWorldPosition(new THREE.Vector3())
        .sub(bones.palm04R.getWorldPosition(new THREE.Vector3()))
        .normalize();
      const towardFingers = fingerCenter.sub(palm)
        .sub(axisWorld.clone().multiplyScalar(fingerCenter.dot(axisWorld)));
      if (towardFingers.lengthSq() < EPSILON) towardFingers.set(0, 0, 1);
      towardFingers.normalize();
      const palmSpan = bones.palm01R.getWorldPosition(new THREE.Vector3())
        .distanceTo(bones.palm04R.getWorldPosition(new THREE.Vector3()));
      const radius = clamp(palmSpan * 0.34, 0.023, 0.029);
      const gripLateral = new THREE.Vector3(0, 1, 0).cross(CAMERA_FORWARD).normalize();
      const gripVertical = CAMERA_FORWARD.clone().cross(gripLateral).normalize();
      const gripWorld = palm
        .addScaledVector(towardFingers, radius * 0.62)
        .addScaledVector(gripLateral, -0.003)
        .addScaledVector(gripVertical, 0);
      const gripLocal = this.root.worldToLocal(gripWorld.clone());
      const flashlight = createFlashlightModel(radius);
      const socket = new THREE.Group();
      socket.name = "right-palm-flashlight-socket";
      socket.userData.handSocket = "flashlight";
      socket.position.copy(gripLocal);
      socket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), CAMERA_FORWARD);
      socket.add(flashlight.root);
      this.root.add(socket);
      this.root.updateMatrixWorld(true);
      this.handBone.attach(socket);
      this.flashlightSocket = socket;
      this.flashlightBody = flashlight.body;

      this.loaded = true;
      this.root.visible = true;
      return true;
    } catch (error) {
      if (this.mixer && model) this.mixer.uncacheRoot?.(model);
      this.mixer?.stopAllAction?.();
      if (model?.parent) model.removeFromParent();
      if (model) disposeResources(model);
      if (model === this.model) {
        this.model = null;
        this.bones = {};
        this.handBone = null;
        this.sleeve = null;
        this.flashlightSocket = null;
        this.flashlightBody = null;
      }
      this.error = error;
      if (signal?.aborted || error?.name === "AbortError") {
        this.destroy();
        throw error;
      }
      this.root.visible = false;
      return false;
    }
  }

  update(delta = 0, motion = {}) {
    if (!this.loaded || this.destroyed) return this;
    const seconds = clamp(delta, 0, 0.05);
    const speed = Math.max(0, Number(motion?.speed) || 0);
    const maxSpeed = Math.max(0.01, Number(motion?.maxSpeed) || 3.25);
    const speedAlpha = 1 - Math.exp(-seconds / 0.11);
    this.smoothedSpeed += (speed - this.smoothedSpeed) * speedAlpha;
    const profile = motionProfileForSpeed(this.smoothedSpeed, maxSpeed);
    if (!Number.isFinite(this.bobTranslationAmplitude)) {
      this.bobFrequency = profile.frequency;
      this.bobTranslationAmplitude = profile.translationAmplitude;
      this.bobRotationAmplitude = profile.rotationAmplitude;
    }
    this.bobFrequency = Math.max(this.bobFrequency, profile.frequency);
    this.phase += seconds * this.bobFrequency * Math.PI * 2;
    if (this.phase >= Math.PI * 2) {
      this.phase %= Math.PI * 2;
      this.bobFrequency = profile.frequency;
      this.bobTranslationAmplitude = profile.translationAmplitude;
      this.bobRotationAmplitude = profile.rotationAmplitude;
    }
    const amplitude = this.bobTranslationAmplitude;
    const rotation = this.bobRotationAmplitude;
    const stride = Math.sin(this.phase);
    const offsetStride = Math.sin(this.phase + 0.42) - Math.sin(0.42);
    const lift = (1 - Math.cos(this.phase)) * 0.5;
    this.root.position.set(
      this.basePosition.x + stride * amplitude * 0.52,
      this.basePosition.y + lift * amplitude * 0.62,
      this.basePosition.z + offsetStride * amplitude * 0.22,
    );
    this.root.quaternion.setFromEuler(new THREE.Euler(
      offsetStride * rotation * 0.32,
      stride * rotation * 0.48,
      stride * rotation * 0.72,
      "YXZ",
    )).premultiply(this.baseQuaternion);
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mixer?.stopAllAction?.();
    if (this.model) this.mixer?.uncacheRoot?.(this.model);
    if (this.model) disposeResources(this.model);
    this.root.removeFromParent();
    this.root.clear();
    this.model = null;
    this.bones = {};
    this.handBone = null;
    this.sleeve = null;
    this.flashlightSocket = null;
    this.flashlightBody = null;
    this.mixer = null;
    this.action = null;
    this.camera = null;
    this.loaded = false;
  }
}

export const __rightHandFlashlightInternals = Object.freeze({
  aimBoneAtDirection,
  frameFromPalmAxes,
  orthonormalFrame,
});
