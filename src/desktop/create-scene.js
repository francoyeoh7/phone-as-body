import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { createExitDoor } from "./ExitDoor.js";
import { createFoundPhoneProp } from "./FoundPhoneProp.js";
import { createWashbasinState } from "./Washbasin.js";
import { createCorridorLayout } from "./CorridorLayout.js";
import { loadEnvironment as loadVillageEnvironment } from "./environment/EnvironmentLoader.js";
import { ENVIRONMENT_DEFAULT_QUALITY, ENVIRONMENT_QUALITY_LEVELS } from "./environment/manifest.js";
import { createEnvironmentColliders as createVillageColliders } from "./environment/colliders.js";
import { disposeEnvironmentResources } from "./environment/resources.js";
import { VillageNpcSystem } from "./npc/VillageNpcSystem.js";

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function makeTexture(base, accent, seed = 7) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);
  for (let index = 0; index < 1600; index += 1) {
    const alpha = 0.035 + random() * 0.12;
    context.fillStyle = accent.replace("ALPHA", alpha.toFixed(3));
    const x = random() * 512;
    const y = random() * 512;
    const size = 1 + random() * 10;
    context.fillRect(x, y, size, size * (0.4 + random() * 1.4));
  }
  for (let index = 0; index < 28; index += 1) {
    context.strokeStyle = accent.replace("ALPHA", "0.13");
    context.lineWidth = 0.5 + random() * 1.8;
    context.beginPath();
    context.moveTo(random() * 512, random() * 512);
    context.lineTo(random() * 512, random() * 512);
    context.stroke();
  }
  context.globalAlpha = 0.12;
  context.strokeStyle = accent.replace("ALPHA", "1");
  context.lineWidth = 1;
  for (let x = 12; x < 512; x += 18 + random() * 24) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + (random() - 0.5) * 5, 512);
    context.stroke();
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function material(texture, roughness = 0.88, color = 0xffffff, bumpScale = 0.055) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color,
    roughness,
    metalness: 0.04,
    bumpMap: texture,
    bumpScale,
  });
}

function box(scene, geometry, surface, position, rotation = null) {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addFixedCollider(world, x, y, z, hx, hy, hz) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  return world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
}

function addLayoutMesh(scene, volume, surface) {
  const mesh = box(scene, new THREE.BoxGeometry(...volume.size), surface, volume.position, volume.rotation ?? null);
  mesh.name = volume.id;
  mesh.userData.corridorSegment = volume.segment;
  return mesh;
}

function addLayoutCollider(world, collider) {
  const fixed = addFixedCollider(world, ...collider.position, ...collider.halfExtents);
  if (fixed) fixed.userData = { ...(fixed.userData ?? {}), corridorId: collider.id, corridorSegment: collider.segment };
  return fixed;
}

function makeLabelTexture(label, background = "#bcb7a2", ink = "#21231f") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 128);
  context.fillStyle = ink;
  context.font = "700 24px monospace";
  context.fillText(label, 18, 52);
  context.font = "12px sans-serif";
  context.fillText("MAINTENANCE / 617", 18, 81);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addDoor(scene, wallX, z, side, doorMaterial, trimMaterial) {
  const group = new THREE.Group();
  group.position.set(wallX, 0, z);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 1.04), trimMaterial);
  trim.position.set(side * -0.16, 1.2, 0);
  trim.castShadow = true;
  group.add(trim);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.15, 0.88), doorMaterial);
  panel.position.set(side * -0.24, 1.08, 0);
  panel.castShadow = true;
  group.add(panel);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.15, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x8b815c, metalness: 0.7, roughness: 0.35 }),
  );
  plate.position.set(side * -0.31, 1.46, side * 0.28);
  group.add(plate);
  scene.add(group);
}

function addInteractable(scene, id, label, position, geometry, surface) {
  const root = new THREE.Group();
  root.position.set(...position);
  root.userData.interactableId = id;
  const mesh = geometry?.isObject3D ? geometry : new THREE.Mesh(geometry, surface);
  mesh.traverse?.((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  root.add(mesh);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.28;
  halo.visible = false;
  root.add(halo);
  scene.add(root);
  return { id, label, root, mesh, halo, enabled: true };
}

function loadPbrTexture(url, { color = false, repeat = [1, 1] } = {}) {
  // TextureLoader needs a real browser image element; scene unit tests use a
  // minimal document shim, so keep the material path deterministic there.
  if (typeof window === "undefined" || typeof document?.createElementNS !== "function") return null;
  const texture = new THREE.TextureLoader().load(url, undefined, undefined, () => {});
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function applyVillageGroundTexture(environmentRoot) {
  if (!environmentRoot?.traverse) return;
  const diffuse = loadPbrTexture("/assets/materials/polyhaven/forest-ground-01/diffuse.jpg", { color: true, repeat: [5, 5] });
  const normal = loadPbrTexture("/assets/materials/polyhaven/forest-ground-01/normal.jpg", { repeat: [5, 5] });
  const roughness = loadPbrTexture("/assets/materials/polyhaven/forest-ground-01/roughness.jpg", { repeat: [5, 5] });
  if (!diffuse && !normal && !roughness) return;
  const size = new THREE.Vector3();
  environmentRoot.traverse((object) => {
    if (!object.isMesh || !/landscape/i.test(`${object.name} ${object.geometry?.name ?? ""}`)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const replacements = materials.map((source) => {
      const next = source?.clone?.() ?? new THREE.MeshStandardMaterial();
      next.color?.set?.(0xffffff);
      next.map = diffuse;
      next.normalMap = normal;
      next.roughnessMap = roughness;
      next.roughness = 0.96;
      next.metalness = 0;
      next.normalScale?.set?.(0.42, 0.42);
      next.needsUpdate = true;
      return next;
    });
    object.material = Array.isArray(object.material) ? replacements : replacements[0];
    object.receiveShadow = true;
    if (object.geometry?.computeBoundingBox) {
      object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) {
        object.geometry.boundingBox.getSize(size);
        // ~1.7 m per ground texture tile keeps the flashlight circle detailed
        // without swimming artifacts. Landscape components are axis-aligned,
        // so the local bounding box equals the world footprint.
        const repeatX = Math.max(2, Math.round(size.x / 1.7));
        const repeatY = Math.max(2, Math.round(size.z / 1.7));
        for (const material of replacements) {
          for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
            if (!texture) continue;
            const tiled = texture.clone();
            tiled.repeat.set(repeatX, repeatY);
            tiled.needsUpdate = true;
            if (material.map === texture) material.map = tiled;
            else if (material.normalMap === texture) material.normalMap = tiled;
            else material.roughnessMap = tiled;
          }
        }
      }
    }
  });
}

function createKnockDoorProp(scene, position, rotationY = 0) {
  const root = new THREE.Group();
  root.name = "knock-door";
  root.position.set(...position);
  root.rotation.y = rotationY;
  root.userData.interactableId = "knock-door";

  const pineDiffuse = "/assets/materials/polyhaven/rough-pine-door/diffuse.jpg";
  const pineNormal = "/assets/materials/polyhaven/rough-pine-door/normal.jpg";
  const pineRoughness = "/assets/materials/polyhaven/rough-pine-door/roughness.jpg";
  const wood = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.03,
    map: loadPbrTexture(pineDiffuse, { color: true, repeat: [1.2, 1] }),
    normalMap: loadPbrTexture(pineNormal, { repeat: [1.2, 1] }),
    roughnessMap: loadPbrTexture(pineRoughness, { repeat: [1.2, 1] }),
    bumpScale: 0.14,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x5b3b28,
    roughness: 0.8,
    map: loadPbrTexture(pineDiffuse, { color: true, repeat: [0.5, 1.8] }),
    normalMap: loadPbrTexture(pineNormal, { repeat: [0.5, 1.8] }),
    roughnessMap: loadPbrTexture(pineRoughness, { repeat: [0.5, 1.8] }),
  });
  const dark = new THREE.MeshBasicMaterial({ color: 0x010204, side: THREE.DoubleSide, depthTest: true, depthWrite: false });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9c5d48, roughness: 0.58 });
  const blood = new THREE.MeshBasicMaterial({
    color: 0x5a090d,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });

  const frame = new THREE.Group();
  const jambLeft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.45, 0.32), trim);
  const jambRight = jambLeft.clone();
  jambLeft.position.set(-0.72, 1.22, 0);
  jambRight.position.set(0.72, 1.22, 0);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.18, 0.32), trim);
  lintel.position.set(0, 2.4, 0);
  frame.add(jambLeft, jambRight, lintel);
  root.add(frame);

  const gapLight = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 1.95), dark);
  gapLight.position.set(0, 1.15, 0.13);
  gapLight.renderOrder = 5;
  gapLight.visible = false;
  root.add(gapLight);

  const leafPivot = new THREE.Group();
  const rightLeafPivot = new THREE.Group();
  leafPivot.name = "knock-door-left-leaf";
  rightLeafPivot.name = "knock-door-right-leaf";
  leafPivot.position.set(-0.61, 0, 0.02);
  rightLeafPivot.position.set(0.61, 0, 0.02);
  const addLeaf = (pivot, side) => {
    const centerX = side * 0.305;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.605, 2.25, 0.14), wood.clone());
    leaf.position.set(centerX, 1.12, 0);
    const inset = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.74, 0.026), wood.clone());
    inset.position.set(centerX, 1.12, 0.083);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.82, 0.05), trim);
    brace.position.set(centerX, 1.12, 0.105);
    brace.rotation.z = side * -0.32;
    pivot.add(leaf, inset, brace);
  };
  addLeaf(leafPivot, 1);
  addLeaf(rightLeafPivot, -1);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 12), new THREE.MeshStandardMaterial({ color: 0xb38e5b, metalness: 0.72, roughness: 0.28 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.48, 1.15, 0.11);
  rightLeafPivot.add(handle);
  root.add(leafPivot, rightLeafPivot);

  const grabArm = new THREE.Group();
  grabArm.name = "door-grab-arm";
  // The player is on the +Z side of this door. The arm starts behind the
  // crack and reaches toward +Z so the hand is visible before it grabs.
  grabArm.position.set(-0.28, 1.12, -0.42);
  grabArm.userData.restPosition = grabArm.position.clone();
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 12), skin);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.z = 0.03;
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), skin);
  palm.scale.set(1.1, 0.82, 0.7);
  palm.position.z = 0.54;
  grabArm.add(forearm, palm);
  for (let index = 0; index < 4; index += 1) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.17, 4, 8), skin);
    finger.rotation.x = Math.PI / 2;
    finger.position.set(-0.105 + index * 0.07, 0.025 - Math.abs(index - 1.5) * 0.015, 0.73);
    grabArm.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.18, 4, 8), skin);
  thumb.rotation.set(0.25, 0.16, -0.85);
  thumb.position.set(-0.16, -0.08, 0.66);
  grabArm.add(thumb);
  grabArm.visible = false;
  root.add(grabArm);
  let realGrabArm = null;

  const bloodMark = new THREE.Group();
  bloodMark.name = "wrist-blood-smears";
  const stainGeometry = new THREE.CircleGeometry(0.035, 10);
  const stainOffsets = [[0, 0, 0.01], [0.035, 0.018, 0.012], [-0.026, -0.018, 0.014], [0.012, -0.04, 0.01]];
  for (const [x, y, z] of stainOffsets) {
    const stain = new THREE.Mesh(stainGeometry, blood);
    stain.position.set(x, y, z);
    stain.rotation.set(0.15, 0.1, (x + y) * 2.4);
    stain.scale.set(1.2, 0.7, 1);
    bloodMark.add(stain);
  }
  bloodMark.visible = false;

  root.traverse((object) => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  scene.add(root);
  const result = {
    id: "knock-door",
    label: "敲门",
    root,
    leafPivot,
    rightLeafPivot,
    gapLight,
    grabArm,
    realGrabArm,
    setArmAsset(source) {
      if (!source) return null;
      realGrabArm?.removeFromParent?.();
      const clone = SkeletonUtils.clone(source);
      clone.name = "door-grab-realistic-arm";
      clone.renderOrder = 6;
      clone.animations = source.animations ?? [];
      // The authored left arm runs along local +X. Aim that axis through the
      // door's +Z opening; the shoulder cut stays behind the leaf while the
      // wrist crosses the narrow gap beside its free edge.
      clone.position.set(0, 0.1, -0.9);
      clone.rotation.set(0, -Math.PI / 2, 0);
      clone.scale.setScalar(0.9);
      clone.userData.restPosition = clone.position.clone();
      clone.userData.restRotation = clone.rotation.clone();
      clone.userData.restBoneRotations = new Map();
      clone.userData.restBoneQuaternions = new Map();
      clone.visible = false;
      const grabClip = THREE.AnimationClip.findByName(clone.animations, "grab.L");
      const hiddenShoulder = clone.getObjectByName("shoulderR");
      if (hiddenShoulder) hiddenShoulder.scale.setScalar(0.00001);
      root.updateMatrixWorld(true);
      const clippingNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const clippingPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        clippingNormal,
        root.getWorldPosition(new THREE.Vector3()),
      );
      clone.traverse((object) => {
        if (object.isBone) {
          clone.userData.restBoneRotations.set(object, object.rotation.clone());
          clone.userData.restBoneQuaternions.set(object, object.quaternion.clone());
        }
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const replacements = materials.map((material) => {
          const replacement = material.clone();
          replacement.transparent = false;
          replacement.opacity = 1;
          replacement.depthWrite = true;
          replacement.clippingPlanes = [clippingPlane];
          replacement.clipShadows = true;
          return replacement;
        });
        object.material = Array.isArray(object.material) ? replacements : replacements[0];
        object.castShadow = true;
        object.receiveShadow = true;
      });
      clone.userData.grabFingerPoses = [];
      if (grabClip) {
        for (const bone of clone.userData.restBoneQuaternions.keys()) {
          if (!bone.name.endsWith("L") || !/^(thumb|f_(index|middle|ring|pinky))/.test(bone.name)) continue;
          const track = grabClip.tracks.find((entry) => entry.name === `${bone.name}.quaternion`);
          if (!track) continue;
          const value = track.createInterpolant(new Float32Array(4)).evaluate(grabClip.duration);
          clone.userData.grabFingerPoses.push({
            bone,
            open: bone.quaternion.clone(),
            closed: new THREE.Quaternion(value[0], value[1], value[2], value[3]).normalize(),
          });
        }
      }
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.105, 1.05, 18, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x101216,
          roughness: 0.96,
          metalness: 0,
          clippingPlanes: [clippingPlane],
          clipShadows: true,
        }),
      );
      sleeve.name = "door-grab-sleeve";
      sleeve.rotation.z = -Math.PI / 2;
      sleeve.position.set(0.02, 1.54, 0.025);
      sleeve.castShadow = true;
      sleeve.receiveShadow = true;
      clone.add(sleeve);
      root.add(clone);
      realGrabArm = clone;
      result.realGrabArm = clone;
      grabArm.visible = false;
      return clone;
    },
    resetArmPose() {
      if (!realGrabArm) return;
      realGrabArm.position.copy(realGrabArm.userData.restPosition);
      realGrabArm.rotation.copy(realGrabArm.userData.restRotation);
      for (const [bone, rotation] of realGrabArm.userData.restBoneRotations ?? []) {
        bone.rotation.copy(rotation);
      }
      for (const [bone, quaternion] of realGrabArm.userData.restBoneQuaternions ?? []) {
        bone.quaternion.copy(quaternion);
      }
    },
    bloodMark,
    enabled: true,
    interaction: {
      anchor: root,
      contactRadius: 0.22,
      maxUseDistance: 2.25,
      approachDirection: new THREE.Vector3(0, 0, 1),
      contactNormal: new THREE.Vector3(0, 0, 1),
    },
  };
  return result;
}

function createPresentationPaper(scene, position, rotationY = 0) {
  const root = new THREE.Group();
  root.name = "presentation-paper";
  root.position.set(...position);
  root.rotation.y = rotationY;
  root.userData.interactableId = "presentation-paper";
  const paperMaterial = new THREE.MeshStandardMaterial({
    color: 0xf0e8cf,
    roughness: 0.84,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), paperMaterial);
  sheet.name = "presentation-paper-sheet";
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, 0.035, 0.34);
  sheet.castShadow = true;
  sheet.receiveShadow = true;
  root.add(sheet);
  const fold = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.006, 0.39),
    new THREE.MeshStandardMaterial({ color: 0xc9bea3, roughness: 0.9 }),
  );
  fold.position.set(-0.08, 0.039, 0.34);
  fold.rotation.y = 0.08;
  root.add(fold);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.25, 24),
    new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(0, 0.01, 0.34);
  halo.visible = false;
  root.add(halo);
  root.visible = false;
  scene.add(root);
  return {
    id: "presentation-paper",
    label: "抓取 PPT",
    root,
    mesh: sheet,
    halo,
    enabled: false,
    interaction: {
      anchor: root,
      contactRadius: 0.22,
      maxUseDistance: 2.35,
      approachDirection: new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
      contactNormal: new THREE.Vector3(0, 1, 0),
    },
  };
}

export function createRenderOnlyFuseModel() {
  const root = new THREE.Group();
  root.name = "spare-fuse-model";
  root.userData.handGrip = {
    position: [0, -0.012, -0.018],
    rotation: [0, 0, 0],
    scale: 0.72,
  };
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.34, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0xe7d5a3,
      emissive: 0xa9813d,
      emissiveIntensity: 0.55,
      roughness: 0.44,
    }),
  );
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.045, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x77766e, metalness: 0.72, roughness: 0.34 }),
  );
  const bottom = new THREE.Mesh(top.geometry.clone(), top.material.clone());
  top.position.y = 0.19;
  bottom.position.y = -0.19;
  root.add(body, top, bottom);
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return root;
}

export function createWashbasin(scene, position, darkMetalMaterial) {
  const root = new THREE.Group();
  root.name = "washbasin";
  root.position.set(...position);
  root.userData.interactableId = "washbasin";

  const ceramicMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d6ca, roughness: 0.2, metalness: 0.02 });
  const ceramicEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b8ad, roughness: 0.32, metalness: 0.02 });
  const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4541, roughness: 0.58, metalness: 0.12 });
  const chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xa8b0aa, roughness: 0.18, metalness: 0.92 });
  const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x1c211f, roughness: 0.72, metalness: 0.08 });
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x83d4df,
    emissive: 0x16454a,
    emissiveIntensity: 0.16,
    roughness: 0.08,
    metalness: 0.04,
    transmission: 0.24,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  const waterSurfaceMaterial = waterMaterial.clone();
  waterSurfaceMaterial.opacity = 0.58;
  const rippleMaterial = new THREE.MeshBasicMaterial({
    color: 0xa8f5f4,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const countertop = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.18, 1.12), counterMaterial);
  countertop.position.set(-0.45, 0.12, 0);
  countertop.castShadow = true;
  countertop.receiveShadow = true;
  root.add(countertop);

  const backsplash = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.92, 1.18), ceramicEdgeMaterial);
  backsplash.position.set(0.03, 0.46, 0);
  backsplash.castShadow = true;
  root.add(backsplash);

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.44, 0.24, 32, 1, true), ceramicMaterial);
  bowl.position.set(-0.52, 0.3, 0);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  root.add(bowl);
  const bowlRim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.055, 10, 32), ceramicMaterial);
  bowlRim.rotation.x = Math.PI / 2;
  bowlRim.position.set(-0.52, 0.43, 0);
  root.add(bowlRim);
  const basinWater = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.018, 32), waterSurfaceMaterial);
  basinWater.position.set(-0.52, 0.405, 0);
  root.add(basinWater);
  const drain = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), darkMetalMaterial);
  drain.rotation.x = Math.PI / 2;
  drain.position.set(-0.52, 0.42, 0);
  root.add(drain);

  const faucetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.1, 0.42, 0),
    new THREE.Vector3(-0.1, 0.94, 0),
    new THREE.Vector3(-0.22, 1.08, 0),
    new THREE.Vector3(-0.46, 1.08, 0),
    new THREE.Vector3(-0.52, 0.93, 0),
  ]);
  const faucet = new THREE.Mesh(new THREE.TubeGeometry(faucetCurve, 20, 0.055, 10, false), chromeMaterial);
  faucet.castShadow = true;
  root.add(faucet);
  const faucetBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 18), chromeMaterial);
  faucetBase.position.set(-0.1, 0.44, 0);
  root.add(faucetBase);

  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 16), chromeMaterial);
    handle.position.set(-0.12, 0.46, side * 0.26);
    handle.rotation.x = Math.PI / 2;
    root.add(handle);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({
      color: side < 0 ? 0x9c3935 : 0x4b7288,
      roughness: 0.38,
      metalness: 0.3,
    }));
    cap.position.set(-0.19, 0.52, side * 0.26);
    root.add(cap);
  }

  const supplyPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.64, 10), rubberMaterial);
  supplyPipe.position.set(0.11, 0.22, 0);
  root.add(supplyPipe);
  const wallClamp = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16), chromeMaterial);
  wallClamp.rotation.x = Math.PI / 2;
  wallClamp.position.set(0.09, 0.5, 0);
  root.add(wallClamp);

  const waterGroup = new THREE.Group();
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.055, 0.54, 14), waterMaterial);
  stream.position.set(-0.52, 0.67, 0);
  waterGroup.add(stream);
  const ripples = [0.14, 0.25].map((radius, index) => {
    const ripple = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.009, 8, 28), rippleMaterial.clone());
    ripple.rotation.x = Math.PI / 2;
    ripple.position.set(-0.52, 0.425 + index * 0.004, 0);
    ripple.userData.phase = index * 0.45;
    waterGroup.add(ripple);
    return ripple;
  });
  const droplets = Array.from({ length: 8 }, (_, index) => {
    const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.026 + (index % 3) * 0.006, 10, 8), waterMaterial);
    droplet.userData.phase = index / 8;
    droplet.userData.speed = 0.72 + (index % 4) * 0.09;
    waterGroup.add(droplet);
    return droplet;
  });
  root.add(waterGroup);

  const splashLight = new THREE.PointLight(0x76d9df, 0, 1.8, 2.2);
  splashLight.position.set(-0.52, 0.52, 0);
  root.add(splashLight);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.27, 24),
    new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -1.02;
  halo.visible = false;
  root.add(halo);
  const visualGroup = new THREE.Group();
  visualGroup.position.set(0.5, -0.2, 0);
  for (const child of [...root.children]) {
    if (child !== halo) {
      root.remove(child);
      visualGroup.add(child);
    }
  }
  root.add(visualGroup);
  scene.add(root);

  const washbasin = {
    id: "washbasin",
    label: "打开水龙头",
    root,
    mesh: bowl,
    halo,
    enabled: true,
    running: false,
    waterSurface: basinWater,
    setRunning: null,
    toggle: null,
    update(delta, elapsed) {
      if (!washbasin.running) return;
      stream.scale.y = 0.94 + Math.sin(elapsed * 16) * 0.04;
      stream.position.x = -0.52 + Math.sin(elapsed * 12) * 0.008;
      for (const droplet of droplets) {
        const progress = (droplet.userData.phase + elapsed * droplet.userData.speed) % 1;
        droplet.position.set(
          -0.52 + Math.sin(elapsed * 8 + droplet.userData.phase * 12) * 0.018,
          0.91 - progress * 0.48,
          Math.cos(elapsed * 9 + droplet.userData.phase * 10) * 0.018,
        );
      }
      for (const ripple of ripples) {
        const pulse = 0.94 + (Math.sin(elapsed * 5.4 + ripple.userData.phase) + 1) * 0.12;
        ripple.scale.setScalar(pulse);
        ripple.material.opacity = 0.46 + pulse * 0.14;
      }
      splashLight.intensity = 0.18 + Math.sin(elapsed * 7) * 0.035;
    },
  };
  const updateVisual = (running) => {
    washbasin.running = running;
    washbasin.label = running ? "关闭水龙头" : "打开水龙头";
    waterGroup.visible = running;
    basinWater.visible = running;
    splashLight.intensity = running ? 0.18 : 0;
  };
  const state = createWashbasinState({ onChange: ({ running }) => updateVisual(running) });
  washbasin.setRunning = (running) => state.setRunning(running);
  washbasin.toggle = () => state.toggle();
  updateVisual(false);
  return washbasin;
}

function makeShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.filter = "blur(10px)";
  context.fillStyle = "rgba(0, 0, 0, 0.94)";
  context.beginPath();
  context.arc(128, 82, 40, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.roundRect(76, 118, 104, 282, 44);
  context.fill();
  context.fillRect(55, 160, 44, 232);
  context.fillRect(158, 160, 44, 232);
  context.fillRect(78, 360, 42, 145);
  context.fillRect(138, 360, 42, 145);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFlashlightCookie() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 16, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,0.96)");
  gradient.addColorStop(0.34, "rgba(255,248,224,0.82)");
  gradient.addColorStop(0.72, "rgba(255,228,177,0.27)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.08;
  context.strokeStyle = "#fff4d5";
  for (let index = 0; index < 18; index += 1) {
    context.beginPath();
    context.moveTo(44 + index * 10, 42);
    context.lineTo(70 + index * 7, 214);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const FLASHLIGHT_FOLLOW_SECONDS = 0.045;

export function updateFlashlightRig(rig, camera, delta) {
  camera.getWorldPosition(rig.group.position);
  camera.getWorldQuaternion(rig.targetQuaternion);
  const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : Infinity;
  const blend = elapsed === Infinity ? 1 : 1 - Math.exp(-elapsed / rig.followSeconds);
  rig.group.quaternion.slerp(rig.targetQuaternion, blend);
}

export function createFlashlightRig(camera, target, { cookieFactory = makeFlashlightCookie } = {}) {
  const group = new THREE.Group();
  group.name = "flashlight";

  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.position.copy(target);
  const core = new THREE.SpotLight(0xfff0c9, 42, 52, Math.PI / 7.2, 0.7, 1.55);
  core.position.set(0, -0.05, 0);
  core.target = flashlightTarget;
  core.castShadow = true;
  core.shadow.mapSize.set(512, 512);
  core.shadow.bias = -0.00018;
  core.shadow.normalBias = 0.024;
  core.map = cookieFactory();
  const spill = new THREE.SpotLight(0xffd6a0, 8.4, 30, Math.PI / 2.8, 0.96, 1.45);
  spill.position.set(0, -0.04, 0);
  spill.target = flashlightTarget;

  const outerBeam = new THREE.Mesh(
    new THREE.ConeGeometry(2.55, 15.4, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd7a1,
      transparent: true,
      opacity: 0.026,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    }),
  );
  // The physical torch held by RightHandFlashlight is the only visible
  // flashlight prop. Keep these meshes available for backwards-compatible
  // lighting controls, but make the old camera-space beam invisible so it
  // cannot read as a second floating torch in first person.
  outerBeam.visible = false;
  outerBeam.rotation.x = -Math.PI / 2;
  outerBeam.position.set(0, -0.05, -8.05);
  const innerBeam = new THREE.Mesh(
    new THREE.ConeGeometry(1.08, 11.8, 40, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffedc4,
      transparent: true,
      opacity: 0.024,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    }),
  );
  innerBeam.visible = false;
  innerBeam.rotation.x = -Math.PI / 2;
  innerBeam.position.set(0, -0.05, -6.05);
  group.add(core, spill, outerBeam, innerBeam, flashlightTarget);
  // Toggle state lives here: DesktopApp dims these lights via flashlight-state
  // instead of hiding the group, which would force a global shader recompile.
  group.userData.flashlightEnabled = true;
  group.userData.flashlightLights = [
    { light: core, intensity: core.intensity },
    { light: spill, intensity: spill.intensity },
  ];
  const rig = {
    group,
    core,
    spill,
    outerBeam,
    innerBeam,
    target: flashlightTarget,
    followSeconds: FLASHLIGHT_FOLLOW_SECONDS,
    targetQuaternion: new THREE.Quaternion(),
  };
  updateFlashlightRig(rig, camera, Infinity);
  return rig;
}

function createObservationWindow(scene, { trimMaterial, metalMaterial, wallMaterial, layout = null }) {
  const anchor = layout?.anchors?.shadowWindow ?? {
    position: [-2.5, 1.9, -14.4],
    taskPoint: [-2.38, 1.95, -13.92],
    figure: [-6.62, 1.22, -16.4],
  };
  const root = new THREE.Group();
  root.position.set(...anchor.position);
  root.userData.interactableId = "shadow-window";

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 1.52, 2.24),
    new THREE.MeshPhysicalMaterial({
      color: 0x526864,
      transparent: true,
      opacity: 0.2,
      roughness: 0.26,
      metalness: 0.08,
      transmission: 0.16,
      depthWrite: false,
    }),
  );
  glass.position.x = -0.02;
  root.add(glass);

  for (const z of [-1.18, 1.18]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.78, 0.12), trimMaterial);
    upright.position.set(0.02, 0, z);
    root.add(upright);
  }
  for (const y of [-0.83, 0.83]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 2.48), trimMaterial);
    rail.position.set(0.02, y, 0);
    root.add(rail);
  }
  const centerRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.58, 0.07), metalMaterial);
  centerRail.position.set(0.05, 0, 0);
  root.add(centerRail);

  const taskPoint = new THREE.Group();
  taskPoint.position.set(
    anchor.taskPoint[0] - anchor.position[0],
    anchor.taskPoint[1] - anchor.position[1],
    anchor.taskPoint[2] - anchor.position[2],
  );
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: 0xe7dfb7,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.17, 32), reticleMaterial);
  ring.rotation.y = Math.PI / 2;
  taskPoint.add(ring);
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.46), reticleMaterial);
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.46, 0.018), reticleMaterial);
  taskPoint.add(horizontal, vertical);
  taskPoint.visible = false;
  root.add(taskPoint);
  scene.add(root);

  const oppositeCorridor = new THREE.Group();
  const oppositeWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.35, 6.2), wallMaterial);
  oppositeWall.position.set(-6.9, 1.58, -14.4);
  const oppositeFloor = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.16, 6.2),
    new THREE.MeshStandardMaterial({ color: 0x1b201e, roughness: 0.94 }),
  );
  oppositeFloor.position.set(-5.94, -0.02, -14.4);
  const oppositeCeiling = oppositeFloor.clone();
  oppositeCeiling.position.y = 3.23;
  const farLeft = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.35, 0.18), wallMaterial);
  farLeft.position.set(-5.94, 1.58, -17.42);
  const farRight = farLeft.clone();
  farRight.position.z = -11.38;
  oppositeCorridor.add(oppositeWall, oppositeFloor, oppositeCeiling, farLeft, farRight);

  const operatingRoom = new THREE.Group();
  operatingRoom.position.set(-6.78, 1.18, -12.62);
  const operatingFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 1.5), metalMaterial);
  const operatingDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 2.35, 1.24),
    new THREE.MeshStandardMaterial({ color: 0x66736d, roughness: 0.47, metalness: 0.48 }),
  );
  operatingDoor.position.x = 0.08;
  const doorWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.74, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x9cae9f, emissive: 0x536d5f, emissiveIntensity: 0.5, roughness: 0.18 }),
  );
  doorWindow.position.set(0.05, 0.38, 0);
  operatingDoor.add(doorWindow);
  operatingRoom.add(operatingFrame, operatingDoor);
  oppositeCorridor.add(operatingRoom);

  const shadowFigure = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeShadowTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  }));
  shadowFigure.position.set(...anchor.figure);
  shadowFigure.scale.set(0.95, 2.42, 1);
  shadowFigure.visible = false;
  oppositeCorridor.add(shadowFigure);

  const oppositeLight = new THREE.RectAreaLight(0xa7b2a2, 2.2, 1.4, 0.35);
  oppositeLight.position.set(-6.15, 2.9, -14.5);
  oppositeLight.rotation.set(0, Math.PI / 2, 0);
  oppositeCorridor.add(oppositeLight);
  scene.add(oppositeCorridor);

  const window = {
    id: "shadow-window",
    label: "观察窗",
    root,
    mesh: glass,
    halo: null,
    enabled: false,
    anchor,
  };
  return { window, taskPoint, oppositeCorridor, operatingRoom, operatingDoor, shadowFigure, anchors: anchor };
}

export function disposePhysicsWorld(world) {
  world?.free?.();
}

const STANDARD_PIXEL_RATIO_CAP = 0.9;
const SOFTWARE_PIXEL_RATIO_CAP = 0.75;
const MAINSTREAM_PIXEL_RATIO_CAP = 0.75;
const SOFTWARE_RENDERER_PATTERN = /microsoft basic render driver|swiftshader|llvmpipe|software rasterizer|warp-webgl/i;
const MAINSTREAM_RENDERER_PATTERN = /gtx\s*(9\d\d|10\d\d|16\d\d)|mx\d{3}|rtx\s*2050|quadro|rx\s*(4[5-9]0|5[5-9]0)|vega\s*(8|11|56|64)|iris\s*xe|uhd\s*graphics|arc\s*a3\d\d|apple\s*m[12]\b|mali|adreno/i;

function readRendererName(renderer) {
  try {
    const context = renderer?.getContext?.();
    if (!context) return "";
    const debugInfo = context.getExtension?.("WEBGL_debug_renderer_info");
    const unmasked = debugInfo?.UNMASKED_RENDERER_WEBGL;
    const value = unmasked !== undefined
      ? context.getParameter?.(unmasked)
      : context.getParameter?.(context.RENDERER);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function detectRenderProfile(renderer) {
  const rendererName = readRendererName(renderer);
  const isSoftware = SOFTWARE_RENDERER_PATTERN.test(rendererName);
  const isMainstream = !isSoftware && MAINSTREAM_RENDERER_PATTERN.test(rendererName);
  return {
    kind: isSoftware ? "software" : isMainstream ? "mainstream" : rendererName ? "hardware" : "unknown",
    rendererName,
    isSoftware,
    isMainstream,
    pixelRatioCap: isSoftware || isMainstream ? SOFTWARE_PIXEL_RATIO_CAP : STANDARD_PIXEL_RATIO_CAP,
    environmentCullDistance: isSoftware ? 34 : isMainstream ? 48 : 112,
    foliageCullDistance: isSoftware ? 24 : isMainstream ? 28 : 80,
    fogNearCap: isSoftware ? 10 : isMainstream ? 13 : Number.POSITIVE_INFINITY,
    fogFarCap: isSoftware ? 34 : isMainstream ? 48 : Number.POSITIVE_INFINITY,
    moonShadows: !isSoftware && !isMainstream,
  };
}

function applyRenderProfile(renderer, profile) {
  const devicePixelRatio = Number(globalThis.window?.devicePixelRatio) || 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, profile.pixelRatioCap));
  if (profile.isSoftware && renderer.shadowMap) {
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
  }
  if (renderer.domElement?.dataset) {
    renderer.domElement.dataset.renderProfile = profile.kind;
    if (profile.rendererName) renderer.domElement.dataset.rendererName = profile.rendererName;
  }
  return profile;
}

async function prepareRenderer(renderer, scene, camera, profile) {
  if (profile.isSoftware || typeof renderer.compileAsync !== "function") return;
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    // Shader precompilation is an optimization. A browser-specific failure
    // must not prevent the playable scene from starting.
  }
}

async function createLegacyCorridorScene(host) {
  await RAPIER.init();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090a);
  scene.fog = new THREE.FogExp2(0x080b0b, 0.026);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 70);
  camera.position.set(0, 1.58, 1.2);
  camera.rotation.order = "YXZ";

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const renderProfile = applyRenderProfile(renderer, detectRenderProfile(renderer));
  host.replaceChildren(renderer.domElement);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const wallTexture = makeTexture("#454a45", "rgba(220, 222, 203, ALPHA)", 12);
  wallTexture.repeat.set(2.2, 7);
  const floorTexture = makeTexture("#252a27", "rgba(193, 187, 155, ALPHA)", 32);
  floorTexture.repeat.set(12, 55);
  const ceilingTexture = makeTexture("#2d332f", "rgba(219, 223, 206, ALPHA)", 4);
  ceilingTexture.repeat.set(12, 55);
  const doorTexture = makeTexture("#242322", "rgba(181, 155, 103, ALPHA)", 27);
  doorTexture.repeat.set(1, 2);
  const trimTexture = makeTexture("#111413", "rgba(210, 195, 161, ALPHA)", 44);
  const wallMaterial = material(wallTexture);
  const floorMaterial = material(floorTexture, 0.98);
  const ceilingMaterial = material(ceilingTexture);
  const doorMaterial = material(doorTexture, 0.78);
  const trimMaterial = material(trimTexture, 0.7);
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x555853, roughness: 0.5, metalness: 0.7 });
  const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x242827, roughness: 0.38, metalness: 0.85 });
  const paperMaterial = new THREE.MeshStandardMaterial({ map: makeLabelTexture("FUSE 12A"), roughness: 0.9 });

  const corridor = createCorridorLayout();
  for (const floor of corridor.floors) addLayoutMesh(scene, floor, floorMaterial);
  for (const ceiling of corridor.ceilings) addLayoutMesh(scene, ceiling, ceilingMaterial);
  for (const wall of corridor.walls) {
    if (wall.render !== false) addLayoutMesh(scene, wall, wallMaterial);
  }
  for (const collider of corridor.colliders) addLayoutCollider(world, collider);

  const innerWallX = [corridor.main.bounds.minX + 0.18, corridor.main.bounds.maxX - 0.18];
  for (const z of [-1.4, -6.6, -11.8, -17.1, -22.4]) {
    addDoor(scene, innerWallX[0], z, 1, doorMaterial, trimMaterial);
    addDoor(scene, innerWallX[1], z - 2.2, -1, doorMaterial, trimMaterial);
  }

  const wallSeamMaterial = new THREE.MeshStandardMaterial({ color: 0x272c29, roughness: 0.58, metalness: 0.32 });
  for (const side of [-1, 1]) {
    for (const z of [-3.95, -9.15, -14.4, -19.65, -24.85]) {
      box(scene, new THREE.BoxGeometry(0.035, 2.88, 0.028), wallSeamMaterial, [side * (corridor.width / 2 - 0.18), 1.7, z]);
    }
    box(scene, new THREE.BoxGeometry(0.045, 0.12, 34.8), wallSeamMaterial, [side * (corridor.width / 2 - 0.18), 0.16, -14.8]);
    box(scene, new THREE.BoxGeometry(0.045, 0.08, 34.8), wallSeamMaterial, [side * (corridor.width / 2 - 0.18), 3.2, -14.8]);
  }
  box(scene, new THREE.BoxGeometry(19.4, 0.12, 0.045), wallSeamMaterial, [13.2, 0.16, -29.6]);
  box(scene, new THREE.BoxGeometry(19.4, 0.08, 0.045), wallSeamMaterial, [13.2, 3.2, -29.6]);

  const windowGlass = new THREE.MeshStandardMaterial({ color: 0x172827, emissive: 0x0c2525, emissiveIntensity: 0.7, roughness: 0.28, metalness: 0.18 });
  for (const z of [-4.2, -24.6]) {
    box(scene, new THREE.BoxGeometry(0.07, 1.25, 1.75), windowGlass, [corridor.main.bounds.minX + 0.2, 1.9, z]);
    for (const offset of [-0.78, 0.78]) box(scene, new THREE.BoxGeometry(0.09, 1.35, 0.06), trimMaterial, [corridor.main.bounds.minX + 0.27, 1.9, z + offset]);
  }

  const shadowQuest = createObservationWindow(scene, { trimMaterial, metalMaterial, wallMaterial, layout: corridor });
  const washbasin = createWashbasin(scene, corridor.anchors.washbasin.position, darkMetalMaterial);

  for (const side of [-1, 1]) {
    box(scene, new THREE.BoxGeometry(0.08, 0.09, 34.6), darkMetalMaterial, [side * (corridor.width / 2 - 0.19), 0.92, -14.8]);
    const conduit = box(
      scene,
      new THREE.CylinderGeometry(0.026, 0.026, 34.5, 10),
      darkMetalMaterial,
      [side * (corridor.width / 2 - 0.22), 3.02, -14.8],
      [Math.PI / 2, 0, 0],
    );
    conduit.castShadow = false;
  }
  for (const x of [7.4, 13.2, 19]) {
    box(scene, new THREE.BoxGeometry(0.09, 0.08, 5.3), darkMetalMaterial, [x, 0.92, -29.6]);
  }

  const ceilingLights = [];
  const ceilingFixtureMaterial = new THREE.MeshStandardMaterial({ color: 0x9b9f91, emissive: 0x7e8a73, emissiveIntensity: 1.1, roughness: 0.42 });
  for (const definition of corridor.lights.filter((entry) => entry.kind === "ceiling")) {
    box(scene, new THREE.BoxGeometry(0.7, 0.08, 1.6), ceilingFixtureMaterial, definition.fixturePosition ?? definition.position);
    const light = new THREE.PointLight(definition.color, definition.intensity, definition.distance, definition.decay);
    light.name = definition.id;
    light.position.set(...definition.position);
    scene.add(light);
    ceilingLights.push(light);
  }

  const emergencyLights = [];
  for (const definition of corridor.lights.filter((entry) => entry.kind === "emergency")) {
    const light = new THREE.PointLight(definition.color, definition.intensity, definition.distance, definition.decay);
    light.name = definition.id;
    light.position.set(...definition.position);
    scene.add(light);
    emergencyLights.push(light);
  }

  const stormLight = new THREE.DirectionalLight(0x9bbcc2, 0);
  stormLight.position.set(-5, 4, -10);
  scene.add(stormLight);
  const hemi = new THREE.HemisphereLight(0x687a70, 0x151816, 0.72);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x242a26, 0.16));

  const flashlightRig = createFlashlightRig(camera, new THREE.Vector3(0, -0.05, -9));
  const flashlightGroup = flashlightRig.group;
  const flashlight = flashlightRig.core;
  const flashlightSpill = flashlightRig.spill;
  const beam = flashlightRig.outerBeam;
  scene.add(camera);
  scene.add(flashlightGroup);

  const fuse = addInteractable(scene, "fuse", "拾取备用保险丝", [-1.78, 1.25, -8.6], createRenderOnlyFuseModel());
  fuse.root.rotation.z = -0.22;
  fuse.root.position.fromArray(corridor.anchors.fuse.position);
  const heldFuse = createRenderOnlyFuseModel();
  heldFuse.visible = false;
  scene.add(heldFuse);
  box(scene, new THREE.BoxGeometry(0.52, 0.32, 0.14), paperMaterial, [corridor.anchors.fuse.position[0] - 0.07, 1.07, corridor.anchors.fuse.position[2]], [0, 0.2, 0]);

  const panelRoot = new THREE.Group();
  panelRoot.position.fromArray(corridor.anchors.panel.position);
  panelRoot.rotation.y = corridor.anchors.panel.rotationY;
  panelRoot.userData.interactableId = "panel";
  const panelBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 0.78), darkMetalMaterial);
  panelBody.castShadow = true;
  panelRoot.add(panelBody);
  const panelFace = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.82, 0.56), metalMaterial);
  panelFace.position.x = -0.1;
  panelRoot.add(panelFace);
  const panelLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: 0x9f3329, emissive: 0x8d2a20, emissiveIntensity: 2 }));
  panelLamp.position.set(-0.13, 0.26, -0.18);
  panelRoot.add(panelLamp);
  scene.add(panelRoot);
  const panel = { id: "panel", label: "安装保险丝", root: panelRoot, mesh: panelBody, halo: null, enabled: true, lamp: panelLamp };

  const exitDoor = createExitDoor({
    scene,
    camera,
    world,
    RAPIER,
    position: corridor.door.position,
    rotationY: corridor.door.rotationY,
    inwardNormal: corridor.door.inwardNormal,
    triggerPosition: corridor.door.triggerPosition,
    colliderPosition: corridor.door.collider.position,
    colliderHalfExtents: corridor.door.collider.halfExtents,
    materials: { door: doorMaterial, hardware: metalMaterial },
  });
  const foundPhone = createFoundPhoneProp({ scene, camera, position: corridor.anchors.foundPhone.position });

  const silhouette = new THREE.Group();
  silhouette.position.set(0.3, 0, -2.8);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x020303 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.05, 4, 8), shadowMaterial);
  torso.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), shadowMaterial);
  head.position.y = 2.03;
  const armGeometry = new THREE.CapsuleGeometry(0.07, 0.75, 3, 6);
  const leftArm = new THREE.Mesh(armGeometry, shadowMaterial);
  const rightArm = new THREE.Mesh(armGeometry, shadowMaterial);
  leftArm.position.set(-0.36, 1.2, 0);
  rightArm.position.set(0.36, 1.2, 0);
  leftArm.rotation.z = -0.1;
  rightArm.rotation.z = 0.1;
  silhouette.add(torso, head, leftArm, rightArm);
  silhouette.visible = false;
  scene.add(silhouette);

  const interactables = [fuse, panel, foundPhone, washbasin, shadowQuest.window];
  for (const entry of interactables) {
    entry.interaction ??= {
      anchor: entry.interactionAnchor ?? entry.root,
      contactRadius: 0.22,
      maxUseDistance: 2.35,
      approachDirection: null,
    };
  }
  const staticOccluderRoots = scene.children.filter((root) => (
    root !== camera
    && root !== flashlightGroup
    && root !== silhouette
    && root !== heldFuse
    && root !== exitDoor.root
    && !interactables.some((entry) => entry.root === root)
  ));
  const corridorWorldAnchors = {
    door: exitDoor.root,
    triggerPosition: exitDoor.triggerPosition,
    foundPhone: foundPhone.root,
    washbasin: washbasin.root,
    fuse: fuse.root,
    panel: panel.root,
    shadowWindow: shadowQuest.window.root,
    shadowTaskPoint: shadowQuest.taskPoint,
  };
  let disposed = false;
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyRenderProfile(renderer, renderProfile);
  };
  window.addEventListener("resize", resize);

  return {
    RAPIER,
    scene,
    camera,
    renderer,
    world,
    interactables,
    staticOccluderRoots,
    objects: {
      flashlight: flashlightGroup,
      flashlightCore: flashlight,
      flashlightSpill,
      flashlightBeam: beam,
      ceilingLights,
      emergencyLights,
      stormLight,
      hemi,
      silhouette,
      exitDoor,
      foundPhone,
      panel,
      fuse,
      heldFuse,
      washbasin,
      shadowQuest,
      corridor: {
        layout: corridor,
        anchors: corridor.anchors,
        worldAnchors: corridorWorldAnchors,
        anchorObjects: corridorWorldAnchors,
      },
    },
    update(delta, elapsed) {
      const pulse = 0.56 + Math.sin(elapsed * 7.4) * 0.045;
      for (const light of emergencyLights) light.intensity = pulse;
      updateFlashlightRig(flashlightRig, camera, delta);
      washbasin.update(delta, elapsed);
      foundPhone.update(delta);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", resize);
      try {
        renderer.dispose();
        scene.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((entry) => {
              entry.map?.dispose();
              entry.dispose();
            });
          }
        });
      } finally {
        disposePhysicsWorld(world);
      }
    },
  };
}

const VILLAGE_MANIFEST_URL = "/assets/environment/elderboom-v1/manifest.json";

function authoredInteraction(entry, definition) {
  entry.interaction = {
    anchor: entry.root,
    contactRadius: 0.22,
    maxUseDistance: definition.maxUseDistance,
    approachDirection: definition.approachDirection
      ? new THREE.Vector3(...definition.approachDirection)
      : null,
    contactNormal: new THREE.Vector3(...definition.contactNormal),
  };
  return entry;
}

function villageLightCompatibility(environment) {
  const byRole = environment.lights?.byRole ?? {};
  const byId = environment.lights?.byId ?? {};
  return {
    ceilingLights: byRole["power-sequence"] ?? [],
    emergencyLights: byRole.emergency ?? [],
    stormLight: byRole.storm?.[0] ?? null,
    hemi: byId["night-hemi"] ?? byRole.moon?.find((light) => light.isHemisphereLight) ?? null,
  };
}

function applyEnvironmentRenderProfile(environment, profile) {
  const moon = environment?.lights?.byId?.["moon-key"];
  if (!moon?.isDirectionalLight) return;
  moon.castShadow = profile.moonShadows !== false;
  if (moon.castShadow && moon.shadow) {
    // The moon and every environment mesh are static: render its shadow map
    // once instead of paying for it again on every frame.
    moon.shadow.autoUpdate = false;
    moon.shadow.needsUpdate = true;
  }
}

function collectEnvironmentCullables(environment) {
  const meshes = [];
  environment?.root?.traverse?.((object) => {
    if (!object.isMesh) return;
    if (object.userData.environmentCull) {
      meshes.push(object);
      return;
    }
    const geometry = object.geometry;
    if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere?.();
    if (geometry?.boundingSphere && Number.isFinite(geometry.boundingSphere.radius)) {
      meshes.push(object);
    }
  });
  return meshes;
}

function createEnvironmentCuller(renderProfile, camera) {
  const worldCenter = new THREE.Vector3();
  const state = { meshes: [], lastX: Number.POSITIVE_INFINITY, lastZ: Number.POSITIVE_INFINITY, lastTime: -Number.POSITIVE_INFINITY };
  const cullDistance = Number.isFinite(renderProfile.environmentCullDistance)
    ? renderProfile.environmentCullDistance
    : Number.POSITIVE_INFINITY;
  // Dense instanced foliage is the frame-rate villain; in the dark it is
  // invisible past ~28 m, so it culls far tighter than buildings.
  const foliageDistance = Number.isFinite(renderProfile.foliageCullDistance)
    ? renderProfile.foliageCullDistance
    : cullDistance;
  return {
    register(environment) {
      state.meshes = collectEnvironmentCullables(environment);
      state.lastX = Number.POSITIVE_INFINITY;
      state.lastZ = Number.POSITIVE_INFINITY;
      state.lastTime = -Number.POSITIVE_INFINITY;
      environment?.root?.updateMatrixWorld?.(true);
      this.refresh();
    },
    refresh() {
      if (!Number.isFinite(cullDistance)) return;
      const { position } = camera;
      for (const mesh of state.meshes) {
        const sphere = mesh.userData.environmentCull ?? mesh.geometry?.boundingSphere;
        if (!sphere?.center) continue;
        worldCenter.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
        const limit = mesh.userData.environmentCull ? foliageDistance : cullDistance;
        mesh.visible = worldCenter.distanceTo(position) - sphere.radius < limit;
      }
    },
    tick(elapsed) {
      const { position } = camera;
      const moved = (position.x - state.lastX) ** 2 + (position.z - state.lastZ) ** 2;
      if (moved <= 4 && elapsed - state.lastTime <= 0.4) return;
      state.lastX = position.x;
      state.lastZ = position.z;
      state.lastTime = elapsed;
      this.refresh();
    },
  };
}

export async function createScene(host, {
  RAPIER: rapier = RAPIER,
  rendererFactory = null,
  loadEnvironment = loadVillageEnvironment,
  createEnvironmentColliders = createVillageColliders,
  createNpcSystem = ({ scene }) => new VillageNpcSystem({ scene }),
  manifestUrl = VILLAGE_MANIFEST_URL,
  environmentQuality = null,
  signal,
  onEnvironmentProgress,
} = {}) {
  await rapier.init();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080c);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 140);
  camera.rotation.order = "YXZ";

  const renderer = rendererFactory
    ? rendererFactory({ antialias: true, powerPreference: "high-performance" })
    : new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.74;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const renderProfile = applyRenderProfile(renderer, detectRenderProfile(renderer));
  // A GPU hiccup must not kill the session: let the context restore instead
  // of Electron tearing the whole window down.
  renderer.domElement.addEventListener?.("webglcontextlost", (event) => event.preventDefault());
  // Auto texture tier: midrange GPUs (GTX 1060 class) start on the low tier to
  // stay within VRAM; the player can still raise it from the settings menu.
  const effectiveEnvironmentQuality = environmentQuality
    ?? (renderProfile.isSoftware || renderProfile.isMainstream ? "low" : ENVIRONMENT_DEFAULT_QUALITY);
  host.replaceChildren(renderer.domElement);

  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
  const gameplayRoot = new THREE.Group();
  gameplayRoot.name = "village-gameplay-props";
  scene.add(gameplayRoot, camera);

  let environment = null;
  let environmentColliders = null;
  let flashlightRig = null;
  let npcSystem = null;
  let disposed = false;
  let resizeAttached = false;

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyRenderProfile(renderer, renderProfile);
  };

  const dispose = ({ clearHost = true } = {}) => {
    if (disposed) return;
    disposed = true;
    if (resizeAttached) {
      window.removeEventListener("resize", resize);
      document.removeEventListener?.("fullscreenchange", resize);
    }
    environment?.dispose?.();
    environmentColliders?.dispose?.();
    npcSystem?.destroy?.();
    disposeEnvironmentResources([gameplayRoot, camera], {
      environmentTextures: [flashlightRig?.core?.map],
    });
    flashlightRig?.core?.shadow?.map?.dispose?.();
    flashlightRig?.core?.shadow?.mapPass?.dispose?.();
    flashlightRig?.spill?.shadow?.map?.dispose?.();
    flashlightRig?.spill?.shadow?.mapPass?.dispose?.();
    gameplayRoot.removeFromParent();
    camera.removeFromParent();
    renderer.dispose();
    disposePhysicsWorld(world);
    const ownsHost = renderer.domElement?.parentNode === host
      || renderer.domElement?.parentNode === undefined;
    if (clearHost && ownsHost) host.replaceChildren();
  };

  try {
    environment = await loadEnvironment({
      scene,
      manifestUrl,
      signal,
      quality: effectiveEnvironmentQuality,
      onProgress: onEnvironmentProgress,
    });
    const { manifest } = environment;
    scene.background = new THREE.Color(manifest.atmosphere.background);
    const fogNear = Math.min(manifest.atmosphere.fog.near, renderProfile.fogNearCap ?? Number.POSITIVE_INFINITY);
    const fogFar = Math.min(manifest.atmosphere.fog.far, renderProfile.fogFarCap ?? Number.POSITIVE_INFINITY);
    scene.fog = new THREE.Fog(manifest.atmosphere.fog.color, fogNear, fogFar);
    camera.far = Math.min(camera.far, fogFar + 28);
    camera.updateProjectionMatrix();
    // The environment manifest owns the moon and practical lights. Keep only
    // a low fill here so night remains readable without washing out the beam.
    scene.add(new THREE.HemisphereLight(0x35435f, 0x131712, 0.1));

    environmentColliders = createEnvironmentColliders({
      RAPIER: rapier,
      world,
      manifest,
      environmentRoot: environment.root,
    });
    applyVillageGroundTexture(environment.root);
    applyEnvironmentRenderProfile(environment, renderProfile);
    const environmentCuller = createEnvironmentCuller(renderProfile, camera);
    environmentCuller.register(environment);
    scene.add(...environmentColliders.occluderRoots);

    npcSystem = createNpcSystem({ scene });
    Promise.resolve(npcSystem?.load?.()).catch(() => null);

    camera.position.set(
      manifest.spawn.position[0],
      manifest.spawn.position[1] + 0.55,
      manifest.spawn.position[2],
    );
    camera.rotation.y = manifest.spawn.yaw;

    flashlightRig = createFlashlightRig(camera, new THREE.Vector3(0, -0.05, -9));
    const flashlightGroup = flashlightRig.group;
    gameplayRoot.add(flashlightGroup);

    const fuseDefinition = manifest.tasks.fuse;
    const fuse = authoredInteraction(
      addInteractable(
        gameplayRoot,
        "fuse",
        "拾取备用保险丝",
        fuseDefinition.position,
        createRenderOnlyFuseModel(),
      ),
      fuseDefinition,
    );
    fuse.root.rotation.y = fuseDefinition.rotationY;

    const heldFuse = createRenderOnlyFuseModel();
    heldFuse.visible = false;
    gameplayRoot.add(heldFuse);

    const phoneDefinition = manifest.tasks["found-phone"];
    const foundPhone = authoredInteraction(createFoundPhoneProp({
      scene: gameplayRoot,
      camera,
      position: phoneDefinition.position,
      rotationY: phoneDefinition.rotationY,
    }), phoneDefinition);

    const washbasinDefinition = manifest.tasks.washbasin;
    const washbasin = authoredInteraction(createWashbasin(
      gameplayRoot,
      washbasinDefinition.position,
      new THREE.MeshStandardMaterial({ color: 0x242827, roughness: 0.38, metalness: 0.85 }),
    ), washbasinDefinition);
    washbasin.root.rotation.y = washbasinDefinition.rotationY;

    const knockDoorDefinition = manifest.tasks["exit-door"];
    const knockDoor = createKnockDoorProp(
      gameplayRoot,
      knockDoorDefinition.position,
      knockDoorDefinition.rotationY,
    );
    const presentationPaper = createPresentationPaper(
      gameplayRoot,
      knockDoorDefinition.position,
      knockDoorDefinition.rotationY,
    );

    const interactables = [fuse, foundPhone, washbasin, knockDoor, presentationPaper];
    const staticOccluderRoots = environmentColliders.occluderRoots;
    let compatibleLights = villageLightCompatibility(environment);
    const worldAnchors = {
      fuse: fuse.root,
      foundPhone: foundPhone.root,
      washbasin: washbasin.root,
      knockDoor: knockDoor.root,
      presentationPaper: presentationPaper.root,
    };

    await prepareRenderer(renderer, scene, camera, renderProfile);
    window.addEventListener("resize", resize);
    document.addEventListener?.("fullscreenchange", resize);
    resizeAttached = true;

    let activeEnvironmentQuality = environment.quality ?? effectiveEnvironmentQuality;
    let environmentQualityGeneration = 0;
    const objects = {
      environment,
      flashlight: flashlightGroup,
      flashlightCore: flashlightRig.core,
      flashlightSpill: flashlightRig.spill,
      flashlightBeam: flashlightRig.outerBeam,
      ...compatibleLights,
      fuse,
      heldFuse,
      foundPhone,
      washbasin,
      knockDoor,
      presentationPaper,
      npcs: npcSystem,
      corridor: {
        layout: null,
        anchors: environment.anchors,
        worldAnchors,
        anchorObjects: worldAnchors,
      },
    };

    const setEnvironmentQuality = async (nextQuality) => {
      if (!ENVIRONMENT_QUALITY_LEVELS.includes(nextQuality)) {
        throw new TypeError(`Unknown environment quality: ${nextQuality}`);
      }
      if (disposed) throw new Error("Unable to switch environment quality after scene disposal");
      if (nextQuality === activeEnvironmentQuality) return environment;
      const generation = environmentQualityGeneration + 1;
      environmentQualityGeneration = generation;
      const next = await loadEnvironment({
        scene,
        manifestUrl,
        quality: nextQuality,
        onProgress: onEnvironmentProgress,
      });
      if (disposed || generation !== environmentQualityGeneration) {
        next.dispose();
        return environment;
      }
      const previous = environment;
      environment = next;
      activeEnvironmentQuality = nextQuality;
      applyVillageGroundTexture(next.root);
      applyEnvironmentRenderProfile(next, renderProfile);
      environmentCuller.register(next);
      compatibleLights = villageLightCompatibility(next);
      objects.environment = next;
      objects.ceilingLights = compatibleLights.ceilingLights;
      objects.emergencyLights = compatibleLights.emergencyLights;
      objects.stormLight = compatibleLights.stormLight;
      objects.hemi = compatibleLights.hemi;
      objects.corridor.anchors = next.anchors;
      previous.dispose();
      return next;
    };

    return {
      RAPIER: rapier,
      scene,
      camera,
      renderer,
      renderProfile,
      world,
      spawn: manifest.spawn,
      get environmentQuality() {
        return activeEnvironmentQuality;
      },
      setEnvironmentQuality,
      interactables,
      staticOccluderRoots,
      objects,
      update(delta, elapsed) {
        const pulse = 0.46 + Math.sin(elapsed * 7.4) * 0.04;
        for (const light of compatibleLights.emergencyLights) light.intensity = pulse;
        updateFlashlightRig(flashlightRig, camera, delta);
        washbasin.update(delta, elapsed);
        foundPhone.update(delta);
        npcSystem?.update?.(delta, elapsed, camera.position);
        environmentCuller.tick(elapsed);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
