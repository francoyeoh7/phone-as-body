import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createArmRigAdapter, createFlatWebXRAdapter } from "../src/desktop/hand-asset-adapter.js";
import { WEBXR_JOINTS } from "../src/desktop/FirstPersonHand.js";

function makeBones() {
  const bones = {};
  for (const name of WEBXR_JOINTS) bones[name] = new THREE.Bone();
  bones.wrist.position.set(0.04, 0.06, 0.01);
  bones["index-finger-metacarpal"].position.set(0.03, 0.03, -0.01);
  bones["middle-finger-metacarpal"].position.set(0.03, 0.025, 0.005);
  bones["pinky-finger-metacarpal"].position.set(0.03, 0.02, 0.03);
  for (const name of WEBXR_JOINTS) {
    if (name !== "wrist" && bones[name].position.lengthSq() === 0) bones[name].position.copy(bones["middle-finger-metacarpal"].position);
  }
  bones.wrist.quaternion.setFromEuler(new THREE.Euler(0.1, 0.2, 0.3));
  return bones;
}

function entries() {
  return [
    { name: "wrist", position: [0, 0, 0] },
    { name: "middle-finger-metacarpal", position: [0, -0.2, 0] },
    { name: "index-finger-metacarpal", position: [0.08, -0.18, 0] },
    { name: "pinky-finger-metacarpal", position: [-0.08, -0.18, 0] },
  ];
}

function makeArmRig() {
  const root = new THREE.Group();
  const bones = {};
  const addChain = (name, suffix, start, end) => {
    const parent = bones[`hand${suffix}`] ?? root;
    const bone = new THREE.Bone();
    bone.name = `${name}${suffix}`;
    bone.position.set(...start);
    parent.add(bone);
    bones[bone.name] = bone;
    const child = new THREE.Bone();
    child.name = `${name}Child${suffix}`;
    child.position.set(...end);
    bone.add(child);
    return bone;
  };
  for (const suffix of ["L", "R"]) {
    const shoulder = new THREE.Bone();
    shoulder.name = `shoulder${suffix}`;
    root.add(shoulder);
    bones[shoulder.name] = shoulder;
    const hand = new THREE.Bone();
    hand.name = `hand${suffix}`;
    hand.position.set(0, 0.2, 0);
    shoulder.add(hand);
    bones[hand.name] = hand;
    for (const name of ["palm01", "palm02", "palm03", "palm04", "thumb01", "thumb02", "thumb03", "f_index01", "f_index02", "f_index03", "f_middle01", "f_middle02", "f_middle03", "f_ring01", "f_ring02", "f_ring03", "f_pinky01", "f_pinky02", "f_pinky03"]) {
      addChain(name, suffix, [0, 0.02, 0], [0, 0.06, 0]);
    }
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

describe("flat WebXR hand asset adapter", () => {
  it("maps a wrist-origin pose into authored armature space instead of raw zero coordinates", () => {
    const bones = makeBones();
    const adapter = createFlatWebXRAdapter(bones, "right");
    const result = adapter.mapJoints(entries(), {
      palmSpan: 0.2,
      wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
    });

    expect(result.transforms.wrist.position.toArray()).toEqual(bones.wrist.position.toArray());
    expect(result.transforms["middle-finger-metacarpal"].position.equals(bones.wrist.position)).toBe(false);
    expect(result.transforms.wrist.position.equals(new THREE.Vector3(0, 0, 0))).toBe(false);
  });

  it("keeps every mapped position and quaternion finite and bounded", () => {
    const adapter = createFlatWebXRAdapter(makeBones(), "left");
    const result = adapter.mapJoints(entries(), {
      palmSpan: 0.001,
      wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
    });

    for (const transform of Object.values(result.transforms)) {
      expect(transform.position.toArray().every(Number.isFinite)).toBe(true);
      expect(transform.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(result.scale).toBeLessThanOrEqual(0.8);
  });
});

describe("hierarchical arm rig adapter", () => {
  it("blends authored finger poses from each MediaPipe curl without breaking the rig", () => {
    const { root, bones } = makeArmRig();
    const open = new THREE.Quaternion();
    const closed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const animations = [
      new THREE.AnimationClip("rest", 1, [
        new THREE.QuaternionKeyframeTrack("f_index01L.quaternion", [0, 1], [...open.toArray(), ...open.toArray()]),
      ]),
      new THREE.AnimationClip("grab.L", 1, [
        new THREE.QuaternionKeyframeTrack("f_index01L.quaternion", [0, 1], [...open.toArray(), ...closed.toArray()]),
      ]),
    ];
    const adapter = createArmRigAdapter(root, bones, "right", animations);
    const result = adapter.mapJoints([{ name: "wrist", position: [0, 0, 0] }], {
      wrist: { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1] },
      curls: [0, 0.5, 0, 0, 0],
      relativeScale: 1,
    });

    expect(result.transforms.f_index01L.quaternion.angleTo(open)).toBeCloseTo(Math.PI / 4, 5);
  });

  it("converts MediaPipe camera axes into a matching Three.js palm orientation", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "right");
    const result = adapter.mapJoints([
      { name: "wrist", position: [0, 0, 0] },
      { name: "middle-finger-metacarpal", position: [0, -0.2, 0] },
    ], {
      wrist: { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1] },
      relativeScale: 1,
    });

    const achievedPalm = result.rootQuaternion.clone()
      .multiply(result.transforms.handL.quaternion)
      .multiply(adapter.handToPalmQuaternion)
      .normalize();
    expect(achievedPalm.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    expect(result.rootQuaternion.angleTo(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI - THREE.MathUtils.degToRad(42),
      ),
    )).toBeLessThan(1e-6);
  });

  it("keeps a forearm rig anchored at the wrist and returns a finite palm rotation", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "right");
    adapter.prepareModel();
    const result = adapter.mapJoints([
      { name: "wrist", position: [0, 0, 0] },
      { name: "index-finger-metacarpal", position: [0.1, 0.2, 0] },
      { name: "middle-finger-metacarpal", position: [0, 0.22, 0] },
      { name: "ring-finger-metacarpal", position: [-0.08, 0.2, 0] },
      { name: "pinky-finger-metacarpal", position: [-0.14, 0.17, 0] },
      { name: "thumb-metacarpal", position: [0.08, 0.04, 0] },
      { name: "thumb-phalanx-proximal", position: [0.13, 0.01, 0] },
      { name: "thumb-phalanx-distal", position: [0.16, -0.02, 0] },
      { name: "thumb-tip", position: [0.18, -0.04, 0] },
      { name: "index-finger-phalanx-proximal", position: [0.1, 0.24, 0] },
      { name: "index-finger-phalanx-intermediate", position: [0.1, 0.3, 0] },
      { name: "index-finger-phalanx-distal", position: [0.1, 0.36, 0] },
      { name: "index-finger-tip", position: [0.1, 0.41, 0] },
    ], {
      palmSpan: 0.2,
      wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
    });

    expect(result.rootQuaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(result.transforms.f_index01L.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(result.scale).toBeCloseTo(1.05, 6);
    expect(bones.shoulderR.scale.x).toBeCloseTo(0.0001, 8);
    expect(bones.shoulderR.position.y).toBeLessThan(-10);
  });
});
