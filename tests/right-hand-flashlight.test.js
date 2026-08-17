import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  RightHandFlashlight,
  motionProfileForSpeed,
  __rightHandFlashlightInternals,
} from "../src/desktop/RightHandFlashlight.js";

function assetLoader() {
  globalThis.self ??= globalThis;
  const parser = new GLTFLoader();
  return { loadAsync: vi.fn(async (url) => {
    const file = path.resolve("public", url.replace(/^\//, ""));
    const bytes = fs.readFileSync(file);
    return parser.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "/assets/hands/",
    );
  }) };
}

function palmCenter(rig) {
  const result = new THREE.Vector3();
  for (const name of ["palm01R", "palm02R", "palm03R", "palm04R"]) {
    result.add(rig.bones[name].getWorldPosition(new THREE.Vector3()));
  }
  return result.multiplyScalar(0.25);
}

function palmFrame(rig) {
  const palm01 = rig.bones.palm01R.getWorldPosition(new THREE.Vector3());
  const palm04 = rig.bones.palm04R.getWorldPosition(new THREE.Vector3());
  const wrist = rig.bones.handR.getWorldPosition(new THREE.Vector3());
  const center = palmCenter(rig);
  const lateral = palm01.sub(palm04).normalize();
  const longitudinal = center.sub(wrist).normalize();
  return {
    lateral,
    longitudinal,
    normal: lateral.clone().cross(longitudinal).normalize(),
  };
}

function lowerBoundaryEntry(camera, shoulder, wrist) {
  const shoulderNdc = shoulder.clone().project(camera);
  const wristNdc = wrist.clone().project(camera);
  const delta = wristNdc.clone().sub(shoulderNdc);
  const t = (-1 - shoulderNdc.y) / delta.y;
  return shoulderNdc.addScaledVector(delta, t);
}

function sampleGrabClipEnd() {
  globalThis.self ??= globalThis;
  const parser = new GLTFLoader();
  const bytes = fs.readFileSync(path.resolve("public/assets/hands/psx-arms.glb"));
  return parser.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "/assets/hands/",
  ).then((gltf) => {
    const clip = gltf.animations.find((candidate) => candidate.name === "grab.R");
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(clip.duration);
    mixer.update(0);
    const quaternions = {};
    gltf.scene.traverse((object) => {
      if (object.isBone && /^(palm|thumb|f_)/.test(object.name)) {
        quaternions[object.name] = object.quaternion.clone();
      }
    });
    return quaternions;
  });
}

function expectQuaternionComponentsClose(actual, expected, tolerance = 1e-5) {
  for (const component of ["x", "y", "z", "w"]) {
    expect(Math.abs(actual[component] - expected[component])).toBeLessThan(tolerance);
  }
}

function projectedPixels(camera, point, width = 1920, height = 1080) {
  const projected = point.clone().project(camera);
  return new THREE.Vector2(
    (projected.x + 1) * width * 0.5,
    (1 - projected.y) * height * 0.5,
  );
}

function closestSegmentDistance(a0, a1, b0, b1) {
  // Closest points between two finite line segments. Clamping both parameters
  // matters here: a finger beyond either flashlight end is not gripping it.
  const u = a1.clone().sub(a0);
  const v = b1.clone().sub(b0);
  const w = a0.clone().sub(b0);
  const a = u.dot(u);
  const b = u.dot(v);
  const c = v.dot(v);
  const d = u.dot(w);
  const e = v.dot(w);
  const denominator = a * c - b * b;
  let s = denominator > 1e-10 ? THREE.MathUtils.clamp((b * e - c * d) / denominator, 0, 1) : 0;
  let t = c > 1e-10 ? (b * s + e) / c : 0;

  if (t < 0) {
    t = 0;
    s = a > 1e-10 ? THREE.MathUtils.clamp(-d / a, 0, 1) : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-10 ? THREE.MathUtils.clamp((b - d) / a, 0, 1) : 0;
  }

  return a0.clone().addScaledVector(u, s)
    .distanceTo(b0.clone().addScaledVector(v, t));
}

function fingerToFlashlightAxisDistances(rig) {
  const body = rig.flashlightBody;
  body.updateWorldMatrix(true, false);
  const bodyCenter = body.getWorldPosition(new THREE.Vector3());
  const bodyAxis = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  const halfLength = body.geometry.parameters.height * 0.5;
  const axisStart = bodyCenter.clone().addScaledVector(bodyAxis, -halfLength);
  const axisEnd = bodyCenter.clone().addScaledVector(bodyAxis, halfLength);
  const distances = {};

  for (const finger of ["index", "middle", "ring", "pinky"]) {
    const joints = [1, 2, 3].map((joint) => (
      rig.bones[`f_${finger}0${joint}R`].getWorldPosition(new THREE.Vector3())
    ));
    distances[finger] = Math.min(
      closestSegmentDistance(joints[0], joints[1], axisStart, axisEnd),
      closestSegmentDistance(joints[1], joints[2], axisStart, axisEnd),
    );
  }

  return {
    distances,
    radius: Math.max(
      body.geometry.parameters.radiusTop,
      body.geometry.parameters.radiusBottom,
    ),
  };
}

function triangleHasUpperArmInfluence(mesh, offset) {
  const indices = mesh.geometry.index.array;
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  const upper = new Set(mesh.skeleton.bones
    .map((bone, index) => (["shoulderR", "upper_armR"].includes(bone.name) ? index : -1))
    .filter((index) => index >= 0));
  return [indices[offset], indices[offset + 1], indices[offset + 2]].some((vertex) => {
    let upperWeight = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      if (upper.has(skinIndex.getComponent(vertex, slot))) upperWeight += skinWeight.getComponent(vertex, slot);
    }
    return upperWeight > 0.25;
  });
}

function dominantSleeveBones(mesh) {
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  const result = new Set();
  for (const vertex of new Set(mesh.geometry.index.array)) {
    let slot = 0;
    for (let candidate = 1; candidate < 4; candidate += 1) {
      if (skinWeight.getComponent(vertex, candidate) > skinWeight.getComponent(vertex, slot)) {
        slot = candidate;
      }
    }
    result.add(mesh.skeleton.bones[skinIndex.getComponent(vertex, slot)]?.name);
  }
  return result;
}

function nearestSleeveEdgeMaxNdcY(camera, mesh, shoulder, count = 24) {
  mesh.skeleton.update();
  mesh.updateWorldMatrix(true, false);
  return Math.max(...[...new Set(mesh.geometry.index.array)]
    .map((index) => mesh.localToWorld(mesh.applyBoneTransform(
      index,
      new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), index),
    )))
    .sort((left, right) => left.distanceToSquared(shoulder) - right.distanceToSquared(shoulder))
    .slice(0, count)
    .map((point) => point.project(camera).y));
}

describe("RightHandFlashlight", () => {
  it("keeps idle natural motion at 0.2 Hz while preserving walking and running cadence", () => {
    const idle = motionProfileForSpeed(0, 3.25);
    const walk = motionProfileForSpeed(0.64 * 3.25, 3.25);
    const run = motionProfileForSpeed(3.25, 3.25);

    expect(idle.frequency).toBeCloseTo(0.2, 6);
    expect(walk.frequency).toBeCloseTo(6.2, 6);
    expect(run.frequency).toBeCloseTo(8.9, 6);
  });

  it("keeps lower-right entry in camera NDC after yaw and roll", async () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    camera.rotation.set(0.17, 1.08, -0.24, "YXZ");
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });

    await rig.load();
    camera.updateMatrixWorld(true);
    rig.root.updateMatrixWorld(true);

    const wrist = rig.bones.handR.getWorldPosition(new THREE.Vector3());
    const shoulder = rig.bones.shoulderR.getWorldPosition(new THREE.Vector3());
    const entry = lowerBoundaryEntry(camera, shoulder, wrist);
    const wristNdc = wrist.clone().project(camera);
    expect(entry.x).toBeGreaterThan(wristNdc.x + 0.16);
    expect(wristNdc.y).toBeGreaterThan(entry.y + 0.12);
    expect(wristNdc.x).toBeLessThan(entry.x - 0.16);
  });

  it("preserves every authored grab.R local quaternion from an independent source clip", async () => {
    const sampled = await sampleGrabClipEnd();
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });

    await rig.load();
    for (const [name, quaternion] of Object.entries(sampled)) {
      expectQuaternionComponentsClose(rig.model.getObjectByName(name).quaternion, quaternion);
    }
  });

  it("guards non-finite camera/frame inputs without writing invalid bone quaternions", async () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    camera.quaternion.set(Number.NaN, 0, 0, 1);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });

    await expect(rig.load()).resolves.toBe(true);
    rig.model.traverse((object) => {
      if (!object.isBone) return;
      expect(Number.isFinite(object.quaternion.x)).toBe(true);
      expect(Number.isFinite(object.quaternion.y)).toBe(true);
      expect(Number.isFinite(object.quaternion.z)).toBe(true);
      expect(Number.isFinite(object.quaternion.w)).toBe(true);
      expect(object.quaternion.length()).toBeCloseTo(1, 6);
    });

    const parallel = __rightHandFlashlightInternals.frameFromPalmAxes(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(0, 0, 0),
    );
    expect(Number.isFinite(parallel.x)).toBe(true);
    expect(Number.isFinite(parallel.y)).toBe(true);
    expect(Number.isFinite(parallel.z)).toBe(true);
    expect(Number.isFinite(parallel.w)).toBe(true);
    expect(parallel.length()).toBeCloseTo(1, 6);

    const root = new THREE.Group();
    const bone = new THREE.Bone();
    const endBone = new THREE.Bone();
    root.add(bone);
    bone.add(endBone);
    const before = bone.quaternion.clone();
    __rightHandFlashlightInternals.aimBoneAtDirection(
      root,
      bone,
      endBone,
      new THREE.Vector3(Number.NaN, 0, 0),
    );
    expect(bone.quaternion.x).toBe(before.x);
    expect(bone.quaternion.y).toBe(before.y);
    expect(bone.quaternion.z).toBe(before.z);
    expect(bone.quaternion.w).toBe(before.w);
  });

  it("aligns the final wrist to the camera reference frame while the arm enters diagonally", async () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });
    const authoredGrab = await sampleGrabClipEnd();

    await rig.load();
    camera.updateMatrixWorld(true);
    rig.root.updateMatrixWorld(true);

    const frame = palmFrame(rig);
    const cameraForward = camera.getWorldDirection(new THREE.Vector3());
    expect(frame.normal.dot(cameraForward)).toBeGreaterThan(0.88);
    expect(frame.longitudinal.x).toBeLessThan(-0.15);
    expect(frame.longitudinal.y).toBeGreaterThan(0.65);

    const wrist = rig.bones.handR.getWorldPosition(new THREE.Vector3());
    const shoulder = rig.bones.shoulderR.getWorldPosition(new THREE.Vector3());
    const entry = lowerBoundaryEntry(camera, shoulder, wrist);
    const wristNdc = wrist.clone().project(camera);

    expect(entry.x).toBeGreaterThan(wristNdc.x + 0.16);
    expect(wristNdc.y).toBeGreaterThan(entry.y + 0.12);
    expect(wristNdc.x).toBeLessThan(entry.x - 0.16);
    for (const [name, quaternion] of Object.entries(authoredGrab)) {
      expectQuaternionComponentsClose(rig.model.getObjectByName(name).quaternion, quaternion);
    }
    rig.model.traverse((object) => {
      if (!object.isBone) return;
      expect(Number.isFinite(object.quaternion.x)).toBe(true);
      expect(Number.isFinite(object.quaternion.y)).toBe(true);
      expect(Number.isFinite(object.quaternion.z)).toBe(true);
      expect(Number.isFinite(object.quaternion.w)).toBe(true);
      expect(object.quaternion.length()).toBeCloseTo(1, 6);
    });
    expect(rig.model.userData.firstPersonWristReference).toMatchObject({
      alignment: "camera-relative-palm-frame",
    });
  });

  it("loads the authored right arm, keeps the grip socket in the palm, and aims the torch forward", async () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });

    await expect(rig.load()).resolves.toBe(true);
    camera.updateMatrixWorld(true);
    rig.root.updateMatrixWorld(true);

    expect(rig.root.parent).toBe(camera);
    expect(rig.handBone?.name).toBe("handR");
    expect(rig.flashlightSocket.parent).toBe(rig.handBone);
    expect(rig.model.getObjectByName("RightRealisticSleeve")).not.toBeNull();
    expect(rig.model.getObjectByName("RightSleeveCuff").visible).toBe(true);
    const wristCuff = rig.model.getObjectByName("RightWristCuff");
    expect(wristCuff).toBeUndefined();

    const gripPosition = rig.flashlightSocket.getWorldPosition(new THREE.Vector3());
    expect(gripPosition.distanceTo(palmCenter(rig))).toBeLessThan(0.045);

    const torchAxis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(rig.flashlightSocket.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const cameraForward = camera.getWorldDirection(new THREE.Vector3());
    expect(torchAxis.dot(cameraForward)).toBeGreaterThan(0.94);

    const wristPixels = projectedPixels(camera, rig.bones.handR.getWorldPosition(new THREE.Vector3()));
    const fingertipPixels = projectedPixels(camera, rig.bones.f_middle03R.getWorldPosition(new THREE.Vector3()));
    expect(fingertipPixels.y).toBeLessThan(wristPixels.y - 2);

    expect(rig.basePosition.x).toBeGreaterThan(0.3);
    expect(rig.basePosition.y).toBeLessThan(-0.25);

    const arms = rig.model.getObjectByName("ArmsMesh");
    let upperArmTriangles = 0;
    for (let offset = 0; offset < arms.geometry.index.count; offset += 3) {
      if (triangleHasUpperArmInfluence(arms, offset)) upperArmTriangles += 1;
    }
    expect(upperArmTriangles).toBeGreaterThan(0);

    const sleeve = rig.model.getObjectByName("RightSleeveShell");
    const sleeveBones = dominantSleeveBones(sleeve);
    expect(sleeveBones).toContain("upper_armR");
    expect(sleeveBones).toContain("forearmR");
    const shoulder = rig.bones.shoulderR.getWorldPosition(new THREE.Vector3());
    expect(nearestSleeveEdgeMaxNdcY(camera, sleeve, shoulder)).toBeLessThan(-1.02);
  });

  it("keeps an adult male palm silhouette instead of a thin miniature hand", async () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });
    await rig.load();
    camera.updateMatrixWorld(true);
    rig.root.updateMatrixWorld(true);

    const palm01 = rig.bones.palm01R.getWorldPosition(new THREE.Vector3());
    const palm04 = rig.bones.palm04R.getWorldPosition(new THREE.Vector3());
    const wrist = rig.bones.handR.getWorldPosition(new THREE.Vector3());
    const middleTip = rig.bones.f_middle03R.getWorldPosition(new THREE.Vector3());
    const palmPixels = projectedPixels(camera, palm01)
      .distanceTo(projectedPixels(camera, palm04));
    const handPixels = projectedPixels(camera, wrist)
      .distanceTo(projectedPixels(camera, middleTip));

    // The previous rig projected the knuckle span to only about 26 px at
    // 1080p, reproducing the user's miniature/thin-hand complaint.
    expect(palmPixels).toBeGreaterThanOrEqual(40);
    expect(palmPixels / handPixels).toBeGreaterThanOrEqual(0.42);
  });

  it("fits the flashlight inside all four finger grip arcs without bone-axis penetration", async () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });
    await rig.load();
    rig.root.updateMatrixWorld(true);

    const { distances, radius } = fingerToFlashlightAxisDistances(rig);
    for (const finger of ["index", "middle", "ring", "pinky"]) {
      // Bone centerlines may sit just inside the nominal surface because the
      // cylinder and skin are discrete meshes, but they must never cross deep
      // through the body and every finger must actually wrap its grip cavity.
      expect(distances[finger]).toBeGreaterThanOrEqual(radius * 0.8);
      expect(distances[finger]).toBeLessThanOrEqual(radius * 1.9);
    }
    expect(Math.max(...Object.values(distances)) - Math.min(...Object.values(distances)))
      .toBeLessThanOrEqual(radius);
  });

  it("uses mapped fabric on a complete skinned upper-arm and forearm sleeve", async () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });
    await rig.load();
    const sleeve = rig.model.getObjectByName("RightSleeveShell");
    const { geometry, material } = sleeve;

    expect(material.map?.isTexture).toBe(true);
    expect(material.normalMap?.isTexture).toBe(true);
    expect(material.roughnessMap?.isTexture).toBe(true);
    expect(material.normalMap).not.toBe(material.map);
    expect(material.roughnessMap).not.toBe(material.map);
    expect(material.roughnessMap).not.toBe(material.normalMap);
    expect(Math.min(
      material.map.anisotropy,
      material.normalMap.anisotropy,
      material.roughnessMap.anisotropy,
    )).toBeGreaterThanOrEqual(4);
    expect(geometry.getAttribute("position").count).toBeGreaterThan(500);
    expect(sleeve.skeleton).toBe(rig.model.getObjectByName("ArmsMesh").skeleton);
    const sleeveBones = dominantSleeveBones(sleeve);
    expect(sleeveBones).toContain("upper_armR");
    expect(sleeveBones).toContain("forearmR");
  });

  it("keeps idle motion restrained and gives running a clearly larger envelope than walking", () => {
    const idle = motionProfileForSpeed(0, 3.25);
    const walk = motionProfileForSpeed(1.65, 3.25);
    const run = motionProfileForSpeed(3.2, 3.25);

    expect(idle.translationAmplitude).toBeGreaterThan(0);
    expect(walk.translationAmplitude).toBeGreaterThan(idle.translationAmplitude * 2);
    expect(run.translationAmplitude).toBeGreaterThan(walk.translationAmplitude * 1.6);
    expect(run.rotationAmplitude).toBeGreaterThan(walk.rotationAmplitude * 1.5);
    expect(run.translationAmplitude).toBeLessThan(0.05);
  });

  it("updates with bounded natural bob and disposes owned resources exactly once", async () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    const rig = new RightHandFlashlight({ camera, loader: assetLoader() });
    await rig.load();
    const bodyGeometryDispose = vi.spyOn(rig.flashlightBody.geometry, "dispose");
    const bodyMaterialDispose = vi.spyOn(rig.flashlightBody.material, "dispose");
    const base = rig.basePosition.clone();
    const sleeve = rig.model.getObjectByName("RightSleeveShell");
    let highestSleeveEdge = -Infinity;

    for (let frame = 0; frame < 600; frame += 1) {
      rig.update(1 / 60, { speed: 3.2, maxSpeed: 3.25 });
      camera.updateMatrixWorld(true);
      rig.root.updateMatrixWorld(true);
      highestSleeveEdge = Math.max(
        highestSleeveEdge,
        nearestSleeveEdgeMaxNdcY(
          camera,
          sleeve,
          rig.bones.shoulderR.getWorldPosition(new THREE.Vector3()),
        ),
      );
      expect(rig.root.position.distanceTo(base)).toBeLessThan(0.065);
    }
    expect(rig.root.position.distanceTo(base)).toBeGreaterThan(0.001);
    expect(highestSleeveEdge).toBeLessThan(-1.02);

    rig.destroy();
    rig.destroy();
    expect(rig.root.parent).toBeNull();
    expect(bodyGeometryDispose).toHaveBeenCalledOnce();
    expect(bodyMaterialDispose).toHaveBeenCalledOnce();
  });

  it("disposes a late GLB result when startup is aborted", async () => {
    let resolveLoad;
    const lateScene = new THREE.Group();
    const lateGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const lateMaterial = new THREE.MeshBasicMaterial();
    lateScene.add(new THREE.Mesh(lateGeometry, lateMaterial));
    const geometryDispose = vi.spyOn(lateGeometry, "dispose");
    const materialDispose = vi.spyOn(lateMaterial, "dispose");
    const camera = new THREE.Group();
    const rig = new RightHandFlashlight({
      camera,
      loader: { loadAsync: vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; })) },
    });
    const controller = new AbortController();
    const loading = rig.load({ signal: controller.signal });

    controller.abort(new DOMException("stopped", "AbortError"));
    resolveLoad({ scene: lateScene, animations: [] });

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(rig.root.parent).toBeNull();
  });
});
