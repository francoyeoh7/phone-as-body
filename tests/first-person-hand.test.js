import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import fs from "node:fs";
import path from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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

  it("anchors the hand at the lower edge and preserves the authored wrist position", async () => {
    const left = fakeScene();
    const camera = new THREE.Group();
    const hand = new FirstPersonHand({ camera, loader: loaderFor({ "/assets/hands/left.glb": left.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    const wristRest = hand.bones.wrist.position.clone();
    hand.applyPose({ ...openHand(), handedness: "left", center: [0.2, 0.2, 0], palmSpan: 0.2, reachEligible: false, trackingConfidence: 1 }, 0.016);
    const first = hand.root.position.clone();
    expect(first.x).toBeLessThan(0);
    expect(first.y).toBeLessThan(-0.2);
    hand.applyPose({ ...openHand(), handedness: "left", center: [0.8, 0.45, 0], palmSpan: 0.2, reachEligible: true, trackingConfidence: 1 }, 0.016);
    expect(hand.root.position.x).toBeGreaterThan(first.x);
    expect(hand.root.position.y).toBeGreaterThan(first.y);
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
    expect(neutral.y).toBeLessThan(-0.2);

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

  it("deforms phalanxes, fades loss without moving, and remains a fixed left rig", async () => {
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
    hand.applyPose({ state: "lost", opacity: 0, handedness: "left" }, 0.175);
    expect(hand.opacity).toBeCloseTo(0.5, 6);
    hand.applyPose({ state: "lost", opacity: 0, handedness: "left" }, 0.175);
    expect(hand.opacity).toBeCloseTo(0, 6);
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
});
