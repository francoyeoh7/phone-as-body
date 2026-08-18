import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { KnockDoorDirector } from "../src/desktop/KnockDoorDirector.js";

function harness() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(11.52, 1.6, -8.4);
  camera.rotation.order = "YXZ";
  const player = {
    snapshotPose: vi.fn(() => ({
      body: { x: 11.52, y: 1.05, z: -8.4 },
      camera: { x: 11.52, y: 1.6, z: -8.4 },
      cameraYaw: 0, cameraPitch: 0, cameraRenderYaw: 0, cameraRenderPitch: 0,
      crouching: false, crouchAmount: 0,
    })),
    beginCinematic: vi.fn(),
    setCinematicCamera: vi.fn(),
    restorePose: vi.fn(),
    endCinematic: vi.fn(),
  };
  const door = {
    root: new THREE.Group(),
    leafPivot: new THREE.Group(),
    rightLeafPivot: new THREE.Group(),
    gapLight: new THREE.Mesh(),
    grabArm: new THREE.Group(),
    bloodMark: new THREE.Mesh(),
    triggerPosition: new THREE.Vector3(11.52, 1.35, -8.4),
  };
  door.grabArm.position.set(-0.28, 1.12, -0.42);
  door.grabArm.userData.restPosition = door.grabArm.position.clone();
  door.root.add(door.leafPivot, door.rightLeafPivot, door.gapLight, door.grabArm, door.bloodMark);
  door.root.position.set(11.52, 0, -9.92);
  const handTracking = {
    lastSample: { pose: { grabStrength: 0.9, openness: 0.1 }, gesturePose: { grabStrength: 0.9, openness: 0.1 } },
    setCinematicPose: vi.fn(),
    clearCinematicPose: vi.fn(),
    hand: {
      root: new THREE.Group(),
      presentationBones: { handL: new THREE.Bone() },
      bones: { wrist: new THREE.Bone() },
      applyPose: vi.fn(),
    },
  };
  handTracking.hand.root.add(handTracking.hand.presentationBones.handL);
  const director = new KnockDoorDirector({
    experience: { camera, objects: { knockDoor: door } },
    player,
    handTracking,
    audio: { cue: vi.fn() },
    ui: { setPrompt: vi.fn(), setSubtitle: vi.fn() },
    now: () => 0,
  });
  return { director, player, door, handTracking, camera };
}

describe("KnockDoorDirector", () => {
  it("aligns at the door and reaches the grab hand toward the player", () => {
    const h = harness();
    expect(h.director.startFromKnock()).toBe(true);
    expect(h.player.beginCinematic).toHaveBeenCalledOnce();
    expect(h.handTracking.setCinematicPose).toHaveBeenCalledOnce();

    h.director.update(0.9);
    const aligned = h.player.setCinematicCamera.mock.calls.at(-1)[0];
    expect(aligned.z).toBeGreaterThan(h.door.root.position.z);

    h.director.update(0.8);
    expect(h.door.grabArm.visible).toBe(true);
    expect(h.door.grabArm.position.z).toBeGreaterThan(h.door.grabArm.userData.restPosition.z + 0.4);
    expect(h.door.leafPivot.rotation.y).toBeGreaterThan(THREE.MathUtils.degToRad(10));
    expect(h.door.rightLeafPivot.rotation.y).toBeLessThan(THREE.MathUtils.degToRad(-10));
    const grabbedHand = h.handTracking.setCinematicPose.mock.calls.at(-1)[0];
    expect(grabbedHand.cinematicOffset[0]).toBeGreaterThan(0.1);
    expect(h.player.setCinematicCamera.mock.calls.at(-1)[0].distanceTo(h.director.alignedPosition)).toBeLessThan(0.01);
  });

  it("animates the player hand and camera through repeated pulls, a fall, and a low upward view", () => {
    const h = harness();
    h.director.startFromKnock();
    h.director.update(2.3);
    const firstPull = h.player.setCinematicCamera.mock.calls.at(-1)[0].clone();
    const firstHand = h.handTracking.setCinematicPose.mock.calls.at(-1)[0];
    h.director.update(0.55);
    const resistance = h.player.setCinematicCamera.mock.calls.at(-1)[0].clone();
    const resistanceHand = h.handTracking.setCinematicPose.mock.calls.at(-1)[0];

    expect(Math.abs(firstPull.z - resistance.z)).toBeGreaterThan(0.08);
    expect(firstHand.cinematicOffset).not.toEqual(resistanceHand.cinematicOffset);
    expect(firstHand.cinematicCurls).not.toEqual(resistanceHand.cinematicCurls);

    h.director.update(4.25);
    expect(h.director.phase).toBe("fall");
    const [fallenPosition, fallenTarget] = h.player.setCinematicCamera.mock.calls.at(-1);
    expect(fallenPosition.y).toBeLessThan(0.9);
    expect(fallenTarget.y).toBeGreaterThan(fallenPosition.y + 0.6);

    h.director.update(0.75);
    expect(h.director.phase).toBe("slam");
    expect(h.door.leafPivot.rotation.y).toBeLessThan(THREE.MathUtils.degToRad(3));
  });

  it("leaves a wrist-bound blood stain and restores the exact pose after the full sequence", () => {
    const h = harness();
    expect(h.director.startFromKnock()).toBe(true);
    for (let i = 0; i < 110; i += 1) h.director.update(0.1);
    expect(h.director.phase).toBe("complete");
    expect(h.door.bloodMark.visible).toBe(true);
    expect(h.door.bloodMark.parent).toBe(h.handTracking.hand.presentationBones.handL);
    expect(h.door.bloodMark.position.length()).toBeLessThan(0.12);
    expect(h.door.bloodMark.scale.x).toBeLessThanOrEqual(0.8);
    expect(h.player.restorePose).toHaveBeenCalledOnce();
    expect(h.player.endCinematic).toHaveBeenCalledOnce();
    expect(h.handTracking.clearCinematicPose).toHaveBeenCalledOnce();
    expect(h.handTracking.hand.applyPose).toHaveBeenCalledWith(expect.objectContaining({
      cinematicOffset: [0, 0, 0],
    }), expect.any(Number));
  });

  it("aborts safely and restores control before completion", () => {
    const h = harness();
    h.director.startFromKnock();
    h.director.update(1.5);
    expect(h.director.abort()).toBe(true);
    expect(h.player.restorePose).toHaveBeenCalledOnce();
    expect(h.player.endCinematic).toHaveBeenCalledOnce();
    expect(h.door.grabArm.visible).toBe(false);
  });
});
