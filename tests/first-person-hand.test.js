import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import fs from "node:fs";
import path from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { FirstPersonHand, WEBXR_JOINTS, expandMediaPipeJoints } from "../src/desktop/FirstPersonHand.js";
import { deriveHandFeatures } from "../src/shared/hand-pose.js";
import { openHand, curledHand } from "./fixtures/hand-landmarks.js";

function fakeScene() {
  const root = new THREE.Group();
  const bones = {};
  for (const name of WEBXR_JOINTS) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones[name] = bone;
    root.add(bone);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial());
  mesh.isSkinnedMesh = true;
  root.add(mesh);
  return { root, bones };
}

function loaderFor(scenes, reject = false) {
  return { loadAsync: vi.fn(async (url) => {
    if (reject) throw new Error("asset unavailable");
    return { scene: scenes[url] };
  }) };
}

function assetLoader() {
  globalThis.self ??= globalThis;
  const parser = new GLTFLoader();
  return { loadAsync: vi.fn(async (url) => {
    const file = path.resolve("public", url.replace(/^\//, ""));
    const bytes = fs.readFileSync(file);
    return parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "/assets/hands/");
  }) };
}

function boundsInFrame(root, frame) {
  root.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const worldToFrame = frame.matrixWorld.clone().invert();
  const points = [];
  root.traverse((object) => {
    if (!object.geometry) return;
    object.geometry.computeBoundingBox?.();
    const box = object.geometry.boundingBox;
    if (!box) return;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          points.push(new THREE.Vector3(x, y, z)
            .applyMatrix4(object.matrixWorld)
            .applyMatrix4(worldToFrame));
        }
      }
    }
  });
  return new THREE.Box3().setFromPoints(points);
}

function leftFingerEnvelope(hand) {
  const palm = hand.presentationBones.handL;
  palm.updateWorldMatrix(true, false);
  const worldToPalm = palm.matrixWorld.clone().invert();
  const points = Object.entries(hand.presentationBones)
    .filter(([name]) => name.endsWith("L") && /^(hand|palm|thumb|f_)/.test(name))
    .map(([, bone]) => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(worldToPalm));
  return new THREE.Box3().setFromPoints(points);
}

describe("FirstPersonHand", () => {
  it("expands 21 landmarks by joint name into 25 finite normalized transforms", () => {
    const expanded = expandMediaPipeJoints({ ...openHand(), worldLandmarks: openHand().worldLandmarks });
    expect(expanded).toHaveLength(25);
    expect(expanded.map((joint) => joint.name)).toEqual(WEBXR_JOINTS);
    for (const joint of expanded) {
      expect(joint.position.every(Number.isFinite)).toBe(true);
      expect(joint.quaternion.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...joint.quaternion)).toBeCloseTo(1, 6);
    }
    expect(expanded.find((joint) => joint.name === "index-finger-metacarpal").position).not.toEqual(expanded.find((joint) => joint.name === "wrist").position);
  });

  it("maps the tracked wrist across the camera frame and preserves the authored wrist position", async () => {
    const left = fakeScene();
    const camera = new THREE.Group();
    const hand = new FirstPersonHand({ camera, loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    const wristRest = hand.bones.wrist.position.clone();
    hand.applyPose({ ...openHand(), handedness: "left", center: [0.2, 0.2, 0], palmSpan: 0.2, reachEligible: false, trackingConfidence: 1 }, 0.016);
    const first = hand.root.position.clone();
    expect(first.x).toBeLessThan(0);
    expect(first.y).toBeGreaterThan(0);
    hand.applyPose({ ...openHand(), handedness: "left", center: [0.8, 0.45, 0], palmSpan: 0.2, reachEligible: true, trackingConfidence: 1 }, 0.016);
    expect(hand.root.position.x).toBeGreaterThan(first.x);
    expect(hand.root.position.y).toBeLessThan(first.y);
    expect(hand.bones.wrist.position.distanceTo(wristRest)).toBeLessThan(1e-6);
  });

  it("reaches a focused contact only while the matching gesture candidate is engaged", async () => {
    const left = fakeScene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const hand = new FirstPersonHand({ camera, loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    const contact = new THREE.Vector3(0.18, 0.12, -1);
    const tracked = { ...openHand({ physicalHandedness: "Left" }), handedness: "left", palmSpan: 0.2, reachEligible: true, reachProgress: 1, trackingConfidence: 1 };
    hand.setTargetContact({ point: contact, normal: [0, 0, 1], epoch: 8, engaged: false });
    hand.applyPose(tracked, 0.2);
    const neutral = hand.root.position.clone();
    expect(neutral.x).toBeLessThan(-0.16);
    expect(neutral.y).toBeLessThan(0);

    hand.setTargetContact({ point: contact, normal: [0, 0, 1], epoch: 8, engaged: true });
    hand.applyPose(tracked, 0.2);
    const wristScreen = hand.root.position.clone().project(camera);
    const contactScreen = contact.clone().project(camera);
    expect(wristScreen.x).toBeCloseTo(contactScreen.x, 1);
    expect(wristScreen.y).toBeCloseTo(contactScreen.y, 1);
    expect(hand.root.position.distanceTo(neutral)).toBeGreaterThan(0.15);
    expect(hand.root.position.y).toBeGreaterThan(-0.2);
    const beforeFinger = hand.bones["index-finger-phalanx-proximal"].quaternion.clone();
    hand.applyPose(tracked, 0.2);
    expect(hand.bones["index-finger-phalanx-proximal"].quaternion.equals(beforeFinger)).toBe(true);
  });

  it("deforms phalanxes, hides immediately without moving, and remains a fixed left rig", async () => {
    const left = fakeScene();
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    const before = hand.bones["index-finger-phalanx-proximal"].quaternion.clone();
    hand.applyPose({ ...curledHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    expect(hand.bones["index-finger-phalanx-proximal"].quaternion.equals(before)).toBe(false);
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.5);
    expect(hand.handedness).toBe("left");
    const position = hand.root.position.clone();
    hand.applyPose({ state: "lost", opacity: 0, handedness: "left" }, 0.016);
    expect(hand.opacity).toBe(0);
    expect(hand.root.visible).toBe(false);
    expect(hand.root.position.equals(position)).toBe(true);
    const beforeRightPose = hand.bones["index-finger-phalanx-proximal"].quaternion.clone();
    hand.applyPose({ ...curledHand(), handedness: "right", trackingConfidence: 1 }, 0.1);
    expect(hand.handedness).toBe("left");
    expect(hand.bones["index-finger-phalanx-proximal"].quaternion.equals(beforeRightPose)).toBe(true);
    hand.applyPose({ ...openHand(), handedness: "right", trackingConfidence: 1 }, 0.5);
    expect(hand.handedness).toBe("left");
    expect(hand.models.right).toBeUndefined();
    expect(hand.bones["index-finger-phalanx-proximal"].quaternion.equals(beforeRightPose)).toBe(true);
  });

  it("ignores non-finite mapped transforms instead of corrupting the visible hand", async () => {
    const left = fakeScene();
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.016);

    const bone = hand.bones["index-finger-phalanx-proximal"];
    const beforeRoot = hand.root.quaternion.clone();
    const beforePosition = bone.position.clone();
    const beforeQuaternion = bone.quaternion.clone();
    hand.adapter = {
      mapJoints: () => ({
        rootQuaternion: new THREE.Quaternion(Number.NaN, 0, 0, 1),
        transforms: {
          "index-finger-phalanx-proximal": {
            position: new THREE.Vector3(Number.NaN, 0, 0),
            quaternion: new THREE.Quaternion(0, Number.NaN, 0, 1),
          },
        },
      }),
    };

    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    expect(hand.root.quaternion.equals(beforeRoot)).toBe(true);
    expect(bone.position.equals(beforePosition)).toBe(true);
    expect(bone.quaternion.equals(beforeQuaternion)).toBe(true);
  });

  it("keeps failed loads hidden and destroy removes the camera attachment", async () => {
    const camera = new THREE.Group();
    const hand = new FirstPersonHand({ camera, loader: loaderFor({}, true) });
    await expect(hand.load()).resolves.toBe(false);
    expect(hand.root.visible).toBe(false);
    expect(hand.fallback).toBe(true);
    expect(() => hand.applyPose(openHand(), 0.016)).not.toThrow();
    hand.destroy();
    expect(camera.children.includes(hand.root)).toBe(false);
  });

  it("disposes a cloned presentation scene when sleeve construction falls back", async () => {
    let cloneCount = 0;
    let presentationGeometryDispose;
    const hand = new FirstPersonHand({
      camera: new THREE.Group(),
      loader: assetLoader(),
      cloneScene: (scene) => {
        const clone = SkeletonUtils.clone(scene);
        cloneCount += 1;
        if (cloneCount === 2) {
          const arms = clone.getObjectByName("ArmsMesh");
          const retainedGeometry = arms.geometry.clone();
          presentationGeometryDispose = vi.spyOn(retainedGeometry, "dispose");
          vi.spyOn(arms.geometry, "clone").mockReturnValueOnce(retainedGeometry);
          clone.getObjectByName("upper_armL").name = "brokenUpperArmL";
        }
        return clone;
      },
    });

    await expect(hand.load()).resolves.toBe(true);
    expect(hand.presentationModel).toBeNull();
    expect(hand.presentationLoadError?.message).toMatch(/upper-arm/);
    expect(presentationGeometryDispose).toHaveBeenCalledOnce();
    hand.destroy();
    expect(presentationGeometryDispose).toHaveBeenCalledOnce();
  });

  it("loads only the checked-in left rig with a cohesive authored forearm", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await expect(hand.load()).resolves.toBe(true);
    let skinned = 0;
    const found = [];
    hand.models.left.traverse((object) => {
        if (object.isSkinnedMesh) {
          skinned += 1;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            expect(material.transparent).toBe(true);
            expect(material.opacity).toBe(0);
            expect(material.depthWrite).toBe(false);
          }
          expect(object.frustumCulled).toBe(false);
          expect(object.castShadow).toBe(true);
          expect(object.receiveShadow).toBe(true);
        }
        if (WEBXR_JOINTS.includes(object.name)) found.push(object.name);
    });
    expect(skinned).toBe(1);
    expect(found.sort()).toEqual([...WEBXR_JOINTS].sort());
    expect(hand.models.right).toBeUndefined();
    expect(hand.boneSets.left.wrist.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
    expect(hand.boneSets.left.wrist.position.x).toBeLessThan(0);
    expect(hand.presentationLoadError?.message).toBeUndefined();
    expect(hand.presentationBones).not.toBeNull();

    const tracked = deriveHandFeatures(openHand({ physicalHandedness: "Left" }));
    hand.applyPose({ ...tracked, trackingConfidence: 1, reachEligible: true }, 0.016);
    const openIndex = hand.presentationBones.f_index02L.quaternion.clone();
    const curled = deriveHandFeatures(curledHand({ physicalHandedness: "Left" }));
    hand.applyPose({ ...curled, trackingConfidence: 1, reachEligible: true }, 0.016);
    expect(hand.presentationBones.f_index02L.quaternion.angleTo(openIndex)).toBeGreaterThan(0.8);
    expect(hand.presentationBones.f_index02L.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });

  it("changes real arm length with the tracked wrist while preserving palm size and wrist centering", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const tracked = deriveHandFeatures(openHand({
      physicalHandedness: "Left",
      inputMirrored: true,
    }));
    const measure = () => {
      hand.root.updateWorldMatrix(true, true);
      const shoulder = hand.presentationBones.shoulderL.getWorldPosition(new THREE.Vector3());
      const wrist = hand.presentationBones.handL.getWorldPosition(new THREE.Vector3());
      const palm = hand.presentationBones.palm02L.getWorldPosition(new THREE.Vector3());
      const root = hand.root.getWorldPosition(new THREE.Vector3());
      return {
        arm: shoulder.distanceTo(wrist),
        palm: wrist.distanceTo(palm),
        wristOffset: wrist.distanceTo(root),
      };
    };

    hand.applyPose({
      ...tracked,
      center: [0.08, 0.9, 0],
      relativeScale: 1,
      trackingConfidence: 1,
      reachEligible: true,
    }, 1);
    const shortArm = measure();
    hand.applyPose({
      ...tracked,
      center: [0.72, 0.35, -0.08],
      relativeScale: 1,
      trackingConfidence: 1,
      reachEligible: true,
    }, 1);
    const longArm = measure();

    expect(longArm.arm).toBeGreaterThan(shortArm.arm + 0.05);
    expect(longArm.arm).toBeLessThan(0.95);
    expect(longArm.palm).toBeCloseTo(shortArm.palm, 5);
    expect(shortArm.wristOffset).toBeLessThan(1e-4);
    expect(longArm.wristOffset).toBeLessThan(1e-4);
  });

  it("drives every real MCP and the thumb root into the authored fist for curledHand", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const openPose = deriveHandFeatures(openHand({ physicalHandedness: "Left" }));
    hand.applyPose({ ...openPose, trackingConfidence: 1 }, 0.016);
    const openMcp = Object.fromEntries(
      ["f_index01L", "f_middle01L", "f_ring01L", "f_pinky01L"]
        .map((name) => [name, hand.presentationBones[name].quaternion.clone()]),
    );

    const fistPose = deriveHandFeatures(curledHand({ physicalHandedness: "Left" }));
    hand.applyPose({ ...fistPose, trackingConfidence: 1 }, 0.016);
    const grab = hand.presentationModel.animations.find((clip) => clip.name === "grab.L");
    const roots = ["thumb01L", "f_index01L", "f_middle01L", "f_ring01L", "f_pinky01L"];
    for (const name of roots) {
      const track = grab.tracks.find((entry) => entry.name === `${name}.quaternion`);
      const value = track.createInterpolant(new Float32Array(4)).evaluate(grab.duration);
      const authoredFist = new THREE.Quaternion(...value).normalize();
      expect(hand.presentationBones[name].quaternion.angleTo(authoredFist)).toBeLessThan(0.03);
    }
    for (const [name, open] of Object.entries(openMcp)) {
      expect(hand.presentationBones[name].quaternion.angleTo(open)).toBeGreaterThan(1.1);
    }
  });

  it("renders the requested local-Z finger spread from a real openHand pose", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const pose = deriveHandFeatures(openHand({ physicalHandedness: "Left" }));
    hand.applyPose({ ...pose, trackingConfidence: 1 }, 0.016);
    const rest = hand.presentationModel.animations.find((clip) => clip.name === "rest");
    const expectedSpread = {
      thumb01L: 12,
      f_index01L: 8,
      f_middle01L: 2,
      f_ring01L: -4,
      f_pinky01L: -10,
    };

    for (const [name, degrees] of Object.entries(expectedSpread)) {
      const track = rest.tracks.find((entry) => entry.name === `${name}.quaternion`);
      const value = track.createInterpolant(new Float32Array(4)).evaluate(0);
      const authoredRest = new THREE.Quaternion(...value).normalize();
      const localDelta = authoredRest.invert()
        .multiply(hand.presentationBones[name].quaternion)
        .normalize();
      if (localDelta.w < 0) localDelta.set(-localDelta.x, -localDelta.y, -localDelta.z, -localDelta.w);
      const renderedDegrees = THREE.MathUtils.radToDeg(2 * Math.atan2(localDelta.z, localDelta.w));
      expect(renderedDegrees).toBeCloseTo(degrees, 1);
      expect(Math.abs(localDelta.x)).toBeLessThan(1e-5);
      expect(Math.abs(localDelta.y)).toBeLessThan(1e-5);
    }
  });

  it("adds a textured skinned long-sleeve shell and separate cuff to the real left arm", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();

    const arms = hand.presentationModel.getObjectByName("ArmsMesh");
    const sleeve = hand.presentationModel.getObjectByName("LeftRealisticSleeve");
    const shell = sleeve?.getObjectByName("LeftSleeveShell");
    const cuff = sleeve?.getObjectByName("LeftSleeveCuff");

    expect(sleeve?.isGroup).toBe(true);
    expect(shell?.isSkinnedMesh).toBe(true);
    expect(cuff?.isSkinnedMesh).toBe(true);
    expect(shell.skeleton).toBe(arms.skeleton);
    expect(cuff.skeleton).toBe(arms.skeleton);
    expect(shell.bindMatrix.equals(arms.bindMatrix)).toBe(true);
    expect(shell.geometry.getAttribute("position").count).toBeGreaterThan(500);
    expect(shell.geometry.getAttribute("normal").count).toBe(shell.geometry.getAttribute("position").count);
    expect(shell.geometry.getAttribute("uv").count).toBe(shell.geometry.getAttribute("position").count);
    expect(shell.geometry.getAttribute("skinIndex").itemSize).toBe(4);
    expect(shell.geometry.getAttribute("skinWeight").itemSize).toBe(4);
    expect(shell.userData.radialScale).toBeCloseTo(1.18, 6);
    expect(cuff.geometry).not.toBe(shell.geometry);
    expect(cuff.material).not.toBe(shell.material);
    expect(shell.material.name).toBe("LeftSleeveFabricMaterial");
    expect(shell.material.isMeshStandardMaterial).toBe(true);
    expect(shell.material.metalness).toBe(0);
    expect(shell.material.roughness).toBeGreaterThanOrEqual(0.75);
    expect(shell.material.map?.isDataTexture).toBe(true);
    expect(shell.material.normalMap?.isDataTexture).toBe(true);
    expect(shell.material.roughnessMap?.isDataTexture).toBe(true);
    expect(arms.material.name).toBe("Arms");
    expect(arms.skeleton.bones.some((bone) => bone.name === "f_index01L")).toBe(true);
  });

  it("keeps the sleeve shell on upper-arm and forearm dominated vertices", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const arms = hand.presentationModel.getObjectByName("ArmsMesh");
    const shell = hand.presentationModel.getObjectByName("LeftSleeveShell");
    const skinIndex = arms.geometry.getAttribute("skinIndex");
    const skinWeight = arms.geometry.getAttribute("skinWeight");
    const allowedBones = new Set(["upper_armL", "forearmL"]);
    const renderedBones = new Set();
    const offArmVertices = [];

    for (const vertex of new Set(shell.geometry.index.array)) {
      let dominantSlot = 0;
      for (let slot = 1; slot < 4; slot += 1) {
        if (skinWeight.getComponent(vertex, slot) > skinWeight.getComponent(vertex, dominantSlot)) {
          dominantSlot = slot;
        }
      }
      const boneIndex = skinIndex.getComponent(vertex, dominantSlot);
      const boneName = arms.skeleton.bones[boneIndex]?.name;
      renderedBones.add(boneName);
      if (!allowedBones.has(boneName)) offArmVertices.push({ vertex, boneName });
    }

    expect(offArmVertices).toEqual([]);
    expect(renderedBones).toEqual(allowedBones);
  });

  it("winds every sleeve triangle toward its outward normals for front-side rendering", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const sleeve = hand.presentationModel.getObjectByName("LeftRealisticSleeve");

    for (const name of ["LeftSleeveShell", "LeftSleeveCuff"]) {
      const geometry = sleeve.getObjectByName(name).geometry;
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const indices = geometry.index.array;
      for (let offset = 0; offset < indices.length; offset += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, indices[offset]);
        const b = new THREE.Vector3().fromBufferAttribute(positions, indices[offset + 1]);
        const c = new THREE.Vector3().fromBufferAttribute(positions, indices[offset + 2]);
        const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
        const vertexNormal = new THREE.Vector3().fromBufferAttribute(normals, indices[offset])
          .add(new THREE.Vector3().fromBufferAttribute(normals, indices[offset + 1]))
          .add(new THREE.Vector3().fromBufferAttribute(normals, indices[offset + 2]))
          .normalize();
        expect(faceNormal.dot(vertexNormal)).toBeGreaterThan(0.8);
      }
    }
  });

  it("inflates the real upper-arm and forearm surface by eighteen percent around the bone axes", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const arms = hand.presentationModel.getObjectByName("ArmsMesh");
    const shell = hand.presentationModel.getObjectByName("LeftSleeveShell");
    const sourcePositions = arms.geometry.getAttribute("position");
    const sleevePositions = shell.geometry.getAttribute("position");
    expect(sleevePositions.count).toBe(sourcePositions.count);
    const parent = arms.parent;
    parent.updateWorldMatrix(true, true);
    const localBonePosition = (name) => parent.worldToLocal(
      hand.presentationBones[name].getWorldPosition(new THREE.Vector3()),
    );
    const upper = localBonePosition("upper_armL");
    const elbow = localBonePosition("forearmL");
    const wrist = localBonePosition("handL");
    const closestOnSegment = (point, start, end) => {
      const axis = end.clone().sub(start);
      const amount = THREE.MathUtils.clamp(point.clone().sub(start).dot(axis) / axis.lengthSq(), 0, 1);
      return start.clone().addScaledVector(axis, amount);
    };
    const axisPoint = (point) => {
      const upperPoint = closestOnSegment(point, upper, elbow);
      const forearmPoint = closestOnSegment(point, elbow, wrist);
      return point.distanceToSquared(upperPoint) <= point.distanceToSquared(forearmPoint)
        ? upperPoint
        : forearmPoint;
    };

    for (const index of new Set(shell.geometry.index.array)) {
      const source = new THREE.Vector3().fromBufferAttribute(sourcePositions, index);
      const sleeve = new THREE.Vector3().fromBufferAttribute(sleevePositions, index);
      const center = axisPoint(source);
      const sourceRadius = source.distanceTo(center);
      expect(sourceRadius).toBeGreaterThan(1e-4);
      expect(sleeve.distanceTo(center) / sourceRadius).toBeCloseTo(1.18, 4);
    }
  });

  it("disposes every sleeve-owned geometry, material, and texture exactly once", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const sleeve = hand.presentationModel.getObjectByName("LeftRealisticSleeve");
    const shell = sleeve.getObjectByName("LeftSleeveShell");
    const cuff = sleeve.getObjectByName("LeftSleeveCuff");
    const resources = new Set([
      shell.geometry,
      cuff.geometry,
      shell.material,
      cuff.material,
      shell.material.map,
      shell.material.normalMap,
      shell.material.roughnessMap,
    ]);
    const disposers = [...resources].map((resource) => vi.spyOn(resource, "dispose"));

    hand.destroy();

    expect(disposers.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });

  it("disposes clone-owned geometry and materials during destroy", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const disposers = [];
    for (const model of Object.values(hand.models)) model.traverse((object) => {
      if (object.geometry) disposers.push(vi.spyOn(object.geometry, "dispose"));
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) disposers.push(vi.spyOn(material, "dispose"));
    });
    hand.destroy();
    expect(disposers.length).toBeGreaterThan(0);
    expect(disposers.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });

  it("attaches a detached item to a palm grip and shares hand visibility and opacity", async () => {
    const left = fakeScene();
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    const material = new THREE.MeshBasicMaterial();
    const geometry = new THREE.BoxGeometry(0.1, 0.2, 0.1);
    const held = new THREE.Mesh(geometry, material);
    held.userData.interactableId = "fuse";

    hand.setHeldItem(held).setHolding(true);
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 0.7 }, 0.016);

    expect(held.parent?.name).toBe("left-palm-grip");
    expect(hand.heldSocket.parent).toBe(hand.bones.wrist);
    expect(hand.heldGrip.parent).toBe(hand.camera);
    expect(held.userData.interactableId).toBeUndefined();
    expect(held.visible).toBe(true);
    expect(material.opacity).toBeCloseTo(0.7, 6);
    hand.setVisible(false);
    expect(hand.root.visible).toBe(false);

    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    hand.destroy();
    hand.destroy();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });

  it("fits held equipment beside the real curled fingers without entering their envelope", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    const held = new THREE.Group();
    held.userData.handGrip = {
      position: [0, -0.012, -0.018],
      rotation: [0, 0, 0],
      scale: 0.72,
    };
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.34, 0.16),
      new THREE.MeshBasicMaterial(),
    );
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.045, 0.18),
      new THREE.MeshBasicMaterial(),
    );
    const otherCap = cap.clone();
    cap.position.y = 0.19;
    otherCap.position.y = -0.19;
    held.add(body, cap, otherCap);

    hand.setHeldItem(held).setHolding(true);
    const pose = deriveHandFeatures(curledHand({ physicalHandedness: "Left" }));
    hand.applyPose({ ...pose, trackingConfidence: 1 }, 0.016);
    for (let frame = 0; frame < 60; frame += 1) hand.updateHeldGrip(1 / 60);

    const fingers = leftFingerEnvelope(hand);
    const equipment = boundsInFrame(held, hand.presentationBones.handL);
    const equipmentSize = equipment.getSize(new THREE.Vector3());
    const equipmentCenter = equipment.getCenter(new THREE.Vector3());

    expect(equipment.min.x).toBeGreaterThanOrEqual(fingers.max.x + 0.014);
    expect(equipment.min.x - fingers.max.x).toBeLessThan(0.025);
    expect(equipmentCenter.y).toBeGreaterThan(fingers.min.y);
    expect(equipmentCenter.y).toBeLessThan(fingers.max.y);
    expect(equipmentCenter.z).toBeGreaterThan(fingers.min.z);
    expect(equipmentCenter.z).toBeLessThan(fingers.max.z);
    expect(Math.max(...equipmentSize.toArray())).toBeLessThanOrEqual(0.15);
  });

  it("springs held equipment toward a separate palm socket instead of welding it to the wrist", async () => {
    const left = fakeScene();
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    const held = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), new THREE.MeshBasicMaterial());
    hand.setHeldItem(held).setHolding(true);
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    const settled = hand.heldGrip.position.clone();

    hand.heldSocket.position.x += 0.24;
    hand.heldSocket.rotation.y += 0.45;
    const beforeTarget = hand.heldSocket.getWorldPosition(new THREE.Vector3());
    hand.heldGrip.parent.worldToLocal(beforeTarget);
    const initialDistance = settled.distanceTo(beforeTarget);
    hand.updateHeldGrip(1 / 60);
    const target = hand.heldSocket.getWorldPosition(new THREE.Vector3());
    hand.heldGrip.parent.worldToLocal(target);

    expect(hand.heldGrip.position.distanceTo(target)).toBeLessThan(initialDistance);
    expect(hand.heldGrip.position.distanceTo(target)).toBeGreaterThan(0.01);
    expect(hand.heldGrip.quaternion.angleTo(hand.heldSocket.getWorldQuaternion(new THREE.Quaternion())))
      .toBeGreaterThan(0.01);
    for (let frame = 0; frame < 90; frame += 1) hand.updateHeldGrip(1 / 60);
    expect(hand.heldGrip.position.distanceTo(target)).toBeLessThan(0.002);
  });

  it("eases a newly selected item into the palm instead of teleporting it onto the socket", async () => {
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
    await hand.load();
    hand.setHeldItem(new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.08),
      new THREE.MeshBasicMaterial(),
    )).setHolding(true);

    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    const target = hand.heldSocket.getWorldPosition(new THREE.Vector3());
    hand.heldGrip.parent.worldToLocal(target);
    const entryDistance = hand.heldGrip.position.distanceTo(target);

    expect(entryDistance).toBeGreaterThan(0.018);
    expect(entryDistance).toBeLessThan(0.06);
    if (hand.presentationBones?.handL) {
      const fingers = leftFingerEnvelope(hand);
      const equipment = boundsInFrame(hand.heldItem, hand.presentationBones.handL);
      expect(equipment.min.x).toBeGreaterThanOrEqual(fingers.max.x + 0.014);
    }
    for (let frame = 0; frame < 60; frame += 1) hand.updateHeldGrip(1 / 60);
    expect(hand.heldGrip.position.distanceTo(target)).toBeLessThan(0.002);
  });

  it("disposes a late model when a startup signal is aborted", async () => {
    let resolveLoad;
    const source = fakeScene();
    const mesh = source.root.children.find((child) => child.isMesh);
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(mesh.material, "dispose");
    const hand = new FirstPersonHand({
      camera: new THREE.Group(),
      loader: { loadAsync: vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; })) },
      cloneScene: (scene) => scene,
    });
    const controller = new AbortController();
    const loading = hand.load({ signal: controller.signal });

    controller.abort(new DOMException("destroy", "AbortError"));
    resolveLoad({ scene: source.root });

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(hand.root.parent).toBeNull();
  });
});
