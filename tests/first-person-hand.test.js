import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { FirstPersonHand, WEBXR_JOINTS, expandMediaPipeJoints } from "../src/desktop/FirstPersonHand.js";
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

  it("maps center and relative scale into bounded camera-local root motion/depth", async () => {
    const left = fakeScene();
    const right = fakeScene();
    const camera = new THREE.Group();
    const hand = new FirstPersonHand({ camera, loader: loaderFor({ "/assets/hands/left.glb": left.root, "/assets/hands/right.glb": right.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    hand.applyPose({ ...openHand(), handedness: "left", center: [0.2, 0.2, 0], relativeScale: 0.5, trackingConfidence: 1 }, 0.016);
    const first = hand.root.position.clone();
    hand.applyPose({ ...openHand(), handedness: "left", center: [0.8, 0.8, 0], relativeScale: 1.5, trackingConfidence: 1 }, 0.016);
    expect(hand.root.position.x).toBeGreaterThan(first.x);
    expect(hand.root.position.y).toBeGreaterThan(first.y);
    expect(hand.root.position.z).toBeGreaterThan(first.z);
    expect(hand.root.position.x).toBeGreaterThanOrEqual(-0.31);
    expect(hand.root.position.x).toBeLessThanOrEqual(0.31);
    expect(hand.root.position.y).toBeGreaterThanOrEqual(-0.21);
    expect(hand.root.position.y).toBeLessThanOrEqual(0.21);
  });

  it("deforms phalanxes from curl, fades loss without moving, and switches handedness after stabilization", async () => {
    const left = fakeScene();
    const right = fakeScene();
    const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: loaderFor({ "/assets/hands/left.glb": left.root, "/assets/hands/right.glb": right.root }), cloneScene: (scene) => scene.clone(true) });
    await hand.load();
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    const before = hand.bones["index-finger-phalanx-proximal"].quaternion.clone();
    hand.applyPose({ ...curledHand(), handedness: "left", trackingConfidence: 1 }, 0.016);
    expect(hand.bones["index-finger-phalanx-proximal"].quaternion.equals(before)).toBe(false);
    hand.applyPose({ ...openHand(), handedness: "left", trackingConfidence: 1 }, 0.5);
    expect(hand.handedness).toBe("left");
    const position = hand.root.position.clone();
    hand.applyPose({ state: "lost", opacity: 0, handedness: "left" }, 0.1);
    expect(hand.root.position.equals(position)).toBe(true);
    hand.applyPose({ ...openHand(), handedness: "right", trackingConfidence: 1 }, 0.1);
    expect(hand.handedness).toBe("left");
    hand.applyPose({ ...openHand(), handedness: "right", trackingConfidence: 1 }, 0.5);
    expect(hand.handedness).toBe("right");
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
});
