import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

function material(color, roughness = 0.72, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry, surface, name) {
  const result = new THREE.Mesh(geometry, surface);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function createFallbackActor(definition) {
  const root = new THREE.Group();
  root.name = `${definition.id}-fallback`;
  const palette = {
    mara: { cloth: 0x6f2636, trouser: 0x34242a, accent: 0xe5d6b7, hair: 0x33251f, skin: 0xc9916d },
    bram: { cloth: 0x343638, trouser: 0x1d2228, accent: 0x6f4a2c, hair: 0x241c18, skin: 0xb77b58 },
    elowen: { cloth: 0x49634d, trouser: 0x313b32, accent: 0x8b7151, hair: 0xb7afa1, skin: 0xc58d72 },
  }[definition.id];
  const skin = material(palette.skin, 0.82);
  const cloth = material(palette.cloth, 0.9);
  const trouser = material(palette.trouser, 0.94);
  const accent = material(palette.accent, 0.86);
  const hair = material(palette.hair, 0.94);
  const eye = material(0x151414, 0.42);

  const torso = mesh(new THREE.CapsuleGeometry(0.25, 0.58, 6, 12), cloth, "torso");
  torso.position.y = 1.02;
  torso.scale.set(1, 1, 0.72);
  const head = mesh(new THREE.SphereGeometry(0.18, 20, 16), skin, "head");
  head.position.y = 1.57;
  const hairCap = mesh(new THREE.SphereGeometry(0.188, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, "hair");
  hairCap.position.y = 1.6;
  const nose = mesh(new THREE.ConeGeometry(0.035, 0.1, 8), skin, "nose");
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.55, 0.18);
  const legs = [-0.11, 0.11].map((x) => {
    const leg = mesh(new THREE.CapsuleGeometry(0.075, 0.55, 5, 8), trouser, "leg");
    leg.position.set(x, 0.43, 0);
    return leg;
  });
  const neck = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 12), skin, "neck");
  neck.position.y = 1.4;
  const eyes = [-1, 1].map((side) => {
    const item = mesh(new THREE.SphereGeometry(0.022, 10, 8), eye, side < 0 ? "left-eye" : "right-eye");
    item.position.set(side * 0.065, 1.59, 0.16);
    return item;
  });
  const shoes = [-1, 1].map((side) => {
    const item = mesh(new THREE.BoxGeometry(0.14, 0.07, 0.24), trouser, side < 0 ? "left-shoe" : "right-shoe");
    item.position.set(side * 0.11, 0.075, 0.045);
    return item;
  });
  const arms = [-1, 1].map((side) => {
    const arm = mesh(new THREE.CapsuleGeometry(0.055, 0.48, 5, 8), skin, side < 0 ? "left-arm" : "right-arm");
    arm.position.set(side * 0.31, 1.08, 0.02);
    arm.rotation.z = side * 0.12;
    return arm;
  });
  root.add(torso, head, hairCap, nose, neck, ...eyes, ...shoes, ...legs, ...arms);

  if (definition.id === "mara") {
    const apron = mesh(new THREE.BoxGeometry(0.38, 0.58, 0.025), accent, "apron");
    apron.position.set(0, 1.03, 0.2);
    const mug = mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.11, 14), material(0xb7955d, 0.45), "mug");
    mug.position.set(-0.37, 0.94, 0.12);
    root.add(apron, mug);
  } else if (definition.id === "bram") {
    const apron = mesh(new THREE.BoxGeometry(0.4, 0.65, 0.035), accent, "leather-apron");
    apron.position.set(0, 1.01, 0.2);
    const hammer = new THREE.Group();
    hammer.name = "hammer";
    const handle = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 10), material(0x5c3922), "hammer-handle");
    const headMesh = mesh(new THREE.BoxGeometry(0.26, 0.1, 0.1), material(0x54575a, 0.35, 0.75), "hammer-head");
    headMesh.position.y = 0.3;
    hammer.add(handle, headMesh);
    hammer.position.set(0.42, 1.0, 0.02);
    hammer.rotation.z = -0.28;
    root.add(apron, hammer);
  } else {
    const shawl = mesh(new THREE.ConeGeometry(0.34, 0.58, 16, 1, true), accent, "shawl");
    shawl.position.y = 1.22;
    const basket = mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.2, 14), material(0x73512f), "herb-basket");
    basket.position.set(0.4, 0.75, 0.05);
    root.add(shawl, basket);
    for (let index = 0; index < 5; index += 1) {
      const herb = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.24, 5), material(0x3f7a46), `herb-${index}`);
      herb.position.set(0.35 + index * 0.025, 0.94 + (index % 2) * 0.03, 0.04);
      herb.rotation.z = (index - 2) * 0.12;
      root.add(herb);
    }
  }
  return root;
}

function disposeObject(root) {
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((entry) => entry?.dispose?.());
    else object.material?.dispose?.();
  });
}

function findAnimation(animations, preferredNames) {
  for (const name of preferredNames ?? []) {
    const exact = animations.find((clip) => clip.name === name);
    if (exact) return exact;
  }
  return animations.find((clip) => /idle/i.test(clip.name)) ?? animations[0] ?? null;
}

function assertNormalizedDimensions(bounds, targetHeight, maxDepthRatio = 0.9) {
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)
    || size.y < targetHeight * 0.82
    || size.y > targetHeight * 1.18
    || Math.max(size.x, size.z) > targetHeight * 1.25
    || size.z / Math.max(size.y, 0.0001) > maxDepthRatio) {
    throw new Error("NPC model has implausible normalized dimensions");
  }
}

export class VillageNpcActor {
  constructor({ definition, asset, loader = new GLTFLoader() } = {}) {
    this.definition = definition;
    this.asset = asset;
    this.loader = loader;
    this.root = new THREE.Group();
    this.root.name = `npc-${definition.id}`;
    this.root.userData.npcId = definition.id;
    this.root.position.fromArray(asset.position);
    this.root.rotation.y = asset.facingYaw ?? 0;
    this.baseYaw = this.root.rotation.y;
    this.fallback = createFallbackActor(definition);
    this.root.add(this.fallback);
    this.mouth = new THREE.Object3D();
    this.mouth.name = `${definition.id}-voice-anchor`;
    this.mouth.position.set(0, (asset.targetHeight ?? 1.7) * 0.9, 0.08);
    this.root.add(this.mouth);
    this.modelRoot = null;
    this.mixer = null;
    this.activeAction = null;
    this.loadError = null;
    this.noticed = false;
    this.lookTarget = null;
    this.expression = "neutral";
    this.gesture = "idle";
    this.destroyed = false;
  }

  async load() {
    if (this.asset.forceFallback === true) {
      this.loadError = new Error("NPC asset disabled by visual quality profile");
      this.fallback.visible = true;
      this.modelRoot = null;
      return false;
    }
    let model = null;
    try {
      const gltf = await this.loader.loadAsync(this.asset.url);
      if (this.destroyed) return false;
      model = gltf.scene;
      model.name = `${this.definition.id}-fab-model`;
      model.rotation.set(...(this.asset.rotation ?? [0, 0, 0]));
      this.root.add(model);
      model.updateMatrixWorld(true);
      let bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = (this.asset.targetHeight ?? 1.7) / Math.max(size.y, 0.0001);
      model.scale.multiplyScalar(scale);
      model.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(model);
      this.root.updateWorldMatrix(true, false);
      // Refresh after updating translated ancestors; otherwise the first bounds
      // pass can still be relative to a stale parent matrix.
      bounds = new THREE.Box3().setFromObject(model);
      const rootWorldPosition = this.root.getWorldPosition(new THREE.Vector3());
      const rootWorldScale = this.root.getWorldScale(new THREE.Vector3());
      const worldScaleY = Math.max(Math.abs(rootWorldScale.y), 0.0001);
      model.position.y += (rootWorldPosition.y - bounds.min.y) / worldScaleY;
      model.updateMatrixWorld(true);
      // Check the authored profile before the actor's facing yaw inflates the
      // world-space depth. A blacksmith facing diagonally is still a standing
      // character; the gate should only reject the source asset's prone pose.
      const actorParent = model.parent;
      const savedParentQuaternion = actorParent?.quaternion?.clone?.() ?? null;
      let profileBounds = new THREE.Box3().setFromObject(model);
      if (actorParent && savedParentQuaternion) {
        actorParent.quaternion.identity();
        actorParent.updateMatrixWorld(true);
        profileBounds = new THREE.Box3().setFromObject(model);
        actorParent.quaternion.copy(savedParentQuaternion);
        actorParent.updateMatrixWorld(true);
      }
      assertNormalizedDimensions(profileBounds, this.asset.targetHeight ?? 1.7, this.asset.maxDepthRatio ?? 0.9);
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      this.modelRoot = model;
      this.fallback.visible = false;
      const clip = findAnimation(gltf.animations ?? [], this.asset.animation);
      if (clip) {
        this.mixer = new THREE.AnimationMixer(model);
        this.activeAction = this.mixer.clipAction(clip);
        this.activeAction.play();
      }
      return true;
    } catch (error) {
      if (model) {
        model.removeFromParent();
        disposeObject(model);
      }
      this.modelRoot = null;
      this.loadError = error;
      this.fallback.visible = true;
      return false;
    }
  }

  setNoticed(noticed, playerPosition = null) {
    this.noticed = noticed === true;
    this.lookTarget = this.noticed && playerPosition ? playerPosition.clone?.() ?? new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z) : null;
  }

  perform(performance = {}, playerPosition = null) {
    this.expression = performance.emotion ?? "neutral";
    this.gesture = performance.gesture ?? "idle";
    if (playerPosition) this.setNoticed(true, playerPosition);
    this.applyExpression();
  }

  applyExpression() {
    const expressionNames = {
      warm: ["happy", "smile"],
      guarded: ["angry", "frown"],
      concerned: ["sad", "concern"],
      angry: ["angry"],
      curious: ["surprised", "brow"],
      neutral: [],
    }[this.expression] ?? [];
    this.root.traverse((object) => {
      if (!object.morphTargetDictionary || !object.morphTargetInfluences) return;
      for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
        const active = expressionNames.some((candidate) => name.toLowerCase().includes(candidate));
        object.morphTargetInfluences[index] = active ? 0.72 : 0;
      }
    });
  }

  update(delta, elapsed, playerPosition = null) {
    this.mixer?.update(delta);
    if (playerPosition && this.noticed) this.lookTarget = playerPosition;
    if (this.lookTarget) {
      const dx = this.lookTarget.x - this.root.position.x;
      const dz = this.lookTarget.z - this.root.position.z;
      const targetYaw = Math.atan2(dx, dz);
      const difference = Math.atan2(Math.sin(targetYaw - this.root.rotation.y), Math.cos(targetYaw - this.root.rotation.y));
      this.root.rotation.y += difference * Math.min(1, delta * 5.5);
    } else {
      const difference = Math.atan2(Math.sin(this.baseYaw - this.root.rotation.y), Math.cos(this.baseYaw - this.root.rotation.y));
      this.root.rotation.y += difference * Math.min(1, delta * 1.4);
    }
    if (!this.mixer) {
      this.fallback.position.y = Math.sin(elapsed * 1.8 + this.definition.id.length) * 0.008;
      const arm = this.fallback.getObjectByName("right-arm");
      if (arm) arm.rotation.x = Math.sin(elapsed * (this.definition.id === "bram" ? 3.2 : 1.4)) * (this.definition.id === "bram" ? 0.28 : 0.05);
      const hammer = this.fallback.getObjectByName("hammer");
      if (hammer) hammer.rotation.x = Math.sin(elapsed * 3.2) * 0.2;
    }
  }

  snapshot() {
    const position = this.root.getWorldPosition(new THREE.Vector3());
    return Object.freeze({
      id: this.definition.id,
      name: this.definition.displayName,
      aliases: [...this.definition.aliases],
      position: Object.freeze({ x: position.x, y: position.y + 1.5, z: position.z }),
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mixer?.stopAllAction();
    disposeObject(this.root);
    this.root.removeFromParent();
  }
}
