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
    const upperArm = new THREE.Bone();
    upperArm.name = `upper_arm${suffix}`;
    upperArm.position.set(0, 0.05, 0);
    shoulder.add(upperArm);
    bones[upperArm.name] = upperArm;
    const forearm = new THREE.Bone();
    forearm.name = `forearm${suffix}`;
    forearm.position.set(0, 0.08, 0);
    upperArm.add(forearm);
    bones[forearm.name] = forearm;
    const hand = new THREE.Bone();
    hand.name = `hand${suffix}`;
    hand.position.set(0, 0.07, 0);
    forearm.add(hand);
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
  it("changes arm-chain length between shoulder and wrist without scaling the palm", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "left");
    const trackedJoints = [{ name: "wrist", position: [0, 0, 0] }];
    const pose = {
      center: [0.5, 0.6, 0],
      relativeScale: 1,
      wrist: { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1] },
    };
    const shoulderTarget = new THREE.Vector3(-0.55, -0.55, -0.72);
    const shortArm = adapter.mapJoints(trackedJoints, pose, {
      shoulderTarget,
      wristTarget: new THREE.Vector3(-0.45, -0.45, -0.72),
    });
    const longArm = adapter.mapJoints(trackedJoints, pose, {
      shoulderTarget,
      wristTarget: new THREE.Vector3(-0.18, -0.12, -0.62),
    });
    const chainLength = (mapped) => ["upper_armL", "forearmL", "handL"]
      .reduce((total, name) => total + mapped.transforms[name].position.length(), 0);

    expect(longArm.armLengthScale).toBeGreaterThan(shortArm.armLengthScale);
    expect(longArm.armLengthScale).toBeLessThanOrEqual(1.2);
    expect(chainLength(longArm)).toBeGreaterThan(chainLength(shortArm));
    expect(longArm.handOffset.distanceTo(shortArm.handOffset)).toBeGreaterThan(0.05);
    expect(longArm.palmScale).toBeCloseTo(shortArm.palmScale, 8);
    expect(longArm.transforms.palm02L?.position).toBeUndefined();
  });

  it("amplifies whole-finger curl at the MCP and retains open-hand spread", () => {
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
    const adapter = createArmRigAdapter(root, bones, "left", animations);
    const result = adapter.mapJoints([
      { name: "wrist", position: [0, 0, 0] },
      { name: "index-finger-phalanx-proximal", position: [0, 0.1, 0], curl: 0.5 },
    ], {
      wrist: { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1] },
      curls: [0, 0.5, 0, 0, 0],
      relativeScale: 1,
    });

    const curl = (0.5 - 0.05) / 0.55;
    const expected = open.clone().slerp(closed, curl).multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(8 * (1 - curl)),
      ),
    );
    expect(result.transforms.f_index01L.quaternion.angleTo(expected)).toBeLessThan(1e-6);
  });

  it("converts MediaPipe camera axes into a matching Three.js palm orientation", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "left");
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
  });

  it("updates the forearm root when the tracked wrist orientation changes", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "left");
    const trackedJoints = [{ name: "wrist", position: [0, 0, 0] }];
    const neutral = adapter.mapJoints(trackedJoints, {
      center: [0.35, 0.72, 0],
      wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
    });
    const turned = adapter.mapJoints(trackedJoints, {
      center: [0.65, 0.48, -0.05],
      wrist: { right: [0, 1, 0], up: [-1, 0, 0], forward: [0, 0, 1] },
    });

    expect(neutral.rootQuaternion.angleTo(turned.rootQuaternion)).toBeGreaterThan(0.25);
  });

  it("converts tracked wrist depth into the Three.js camera axis", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "left");
    const result = adapter.mapJoints([{ name: "wrist", position: [0, 0, 0] }], {
      center: [0.02, 0.88, 0.28],
      wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
    });

    const achievedForearmDirection = new THREE.Vector3(0, -1, 0)
      .applyQuaternion(result.rootQuaternion);
    expect(achievedForearmDirection.z).toBeGreaterThan(0.5);
  });

  it("keeps a forearm rig anchored at the wrist and returns a finite palm rotation", () => {
    const { root, bones } = makeArmRig();
    const adapter = createArmRigAdapter(root, bones, "left");
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
    expect(bones.shoulderR.scale.x).toBe(1);
    expect(bones.shoulderR.position.y).toBe(0);
  });

  it("uses whole-finger curl at the MCP while retaining each distal tracked bend", () => {
    const { root, bones } = makeArmRig();
    const open = new THREE.Quaternion();
    const closed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const animations = [new THREE.AnimationClip("grab.L", 1, [
      new THREE.QuaternionKeyframeTrack("f_index01L.quaternion", [0, 1], [...open.toArray(), ...closed.toArray()]),
      new THREE.QuaternionKeyframeTrack("f_index02L.quaternion", [0, 1], [...open.toArray(), ...closed.toArray()]),
    ])];
    const adapter = createArmRigAdapter(root, bones, "left", animations);
    const result = adapter.mapJoints([
      { name: "wrist", position: [0, 0, 0] },
      { name: "index-finger-phalanx-proximal", position: [0, 0.1, 0], curl: 0.15 },
      { name: "index-finger-phalanx-intermediate", position: [0, 0.2, 0], curl: 0.85 },
    ], { wrist: { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1] }, curls: [0, 0.5, 0, 0, 0] });

    const rootCurl = (0.5 - 0.05) / 0.55;
    const expectedRoot = open.clone().slerp(closed, rootCurl).multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(8 * (1 - rootCurl)),
      ),
    );
    const expectedIntermediate = open.clone().slerp(closed, 0.85);
    expect(result.transforms.f_index01L.quaternion.angleTo(expectedRoot)).toBeLessThan(1e-6);
    expect(result.transforms.f_index02L.quaternion.angleTo(expectedIntermediate)).toBeLessThan(1e-6);
  });
});
