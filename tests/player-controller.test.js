import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PlayerController } from "../src/desktop/PlayerController.js";

function createPlayer() {
  return Object.assign(Object.create(PlayerController.prototype), {
    cameraYaw: 0.8,
    cameraPitch: -0.35,
    cameraRenderYaw: 0.8,
    cameraRenderPitch: -0.35,
    lastViewSequence: -1,
    settings: { sensitivity: 1, smoothing: 0.18, invertY: false },
    pitchOverflow: 0,
    aimAssist: null,
  });
}

function createCrouchPlayer({ phoneConnected = true, fallback = false } = {}) {
  const translation = { x: 0, y: 1.05, z: 1.2 };
  return Object.assign(Object.create(PlayerController.prototype), {
    paused: false,
    cinematic: false,
    fallback,
    phoneConnected,
    crouching: false,
    crouchAmount: 0,
    movementSpeed: 3.25,
    phoneInput: {
      seq: -1,
      viewDelta: { yaw: 0, pitch: 0 },
      move: { x: 0, y: 0 },
      clutch: false,
      crouch: false,
    },
    keys: new Set(),
    velocity: { x: 0, z: 0 },
    cameraYaw: 0,
    cameraPitch: 0,
    cameraRenderYaw: 0,
    cameraRenderPitch: 0,
    lastViewSequence: -1,
    settings: { sensitivity: 1, smoothing: 0.18, invertY: false },
    pitchOverflow: 0,
    aimAssist: null,
    camera: { position: new THREE.Vector3(), rotation: {} },
    body: {
      translation: () => ({ ...translation }),
      setTranslation: vi.fn((next) => Object.assign(translation, next)),
      setNextKinematicTranslation: vi.fn((next) => Object.assign(translation, next)),
    },
    collider: {},
    characterController: {
      computeColliderMovement: vi.fn(),
      computedMovement: () => ({ x: 0, y: 0, z: 0 }),
    },
    updateCameraPresentation: vi.fn(),
    updateInteraction: vi.fn(),
  });
}

function createConstructorHarness(spawn) {
  const bodyDescriptor = {
    translation: null,
    setTranslation(x, y, z) {
      this.translation = [x, y, z];
      return this;
    },
  };
  const characterController = {
    enableAutostep: vi.fn(),
    enableSnapToGround: vi.fn(),
    setApplyImpulsesToDynamicBodies: vi.fn(),
  };
  const body = {};
  const collider = {};
  const world = {
    createRigidBody: vi.fn(() => body),
    createCollider: vi.fn(() => collider),
    createCharacterController: vi.fn(() => characterController),
  };
  const RAPIER = {
    RigidBodyDesc: { kinematicPositionBased: vi.fn(() => bodyDescriptor) },
    ColliderDesc: { capsule: vi.fn(() => ({})) },
  };
  const eventTarget = { addEventListener: vi.fn(), removeEventListener: vi.fn(), pointerLockElement: null };
  const domElement = { addEventListener: vi.fn(), removeEventListener: vi.fn(), requestPointerLock: vi.fn() };
  vi.stubGlobal("window", eventTarget);
  vi.stubGlobal("document", eventTarget);
  const camera = new THREE.PerspectiveCamera();
  const player = new PlayerController({
    RAPIER,
    world,
    camera,
    renderer: { domElement },
    interactables: [],
    staticOccluderRoots: [],
    spawn,
  });
  return { bodyDescriptor, camera, player };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player village spawn", () => {
  it("uses an authored body translation and initial logical/render yaw", () => {
    const { bodyDescriptor, player } = createConstructorHarness({
      position: [6.5, 1.05, -2],
      yaw: Math.PI,
    });

    expect(bodyDescriptor.translation).toEqual([6.5, 1.05, -2]);
    expect(player.cameraYaw).toBe(Math.PI);
    expect(player.cameraRenderYaw).toBe(Math.PI);
    expect(player.cameraPitch).toBe(0);
    expect(player.cameraRenderPitch).toBe(0);
  });

  it("preserves the legacy isolated-test spawn when no manifest spawn is supplied", () => {
    const { bodyDescriptor, player } = createConstructorHarness(undefined);

    expect(bodyDescriptor.translation).toEqual([0, 1.05, 1.2]);
    expect(player.cameraYaw).toBe(0);
    expect(player.cameraRenderYaw).toBe(0);
  });
});

describe("player phone view deltas", () => {
  it("preserves the interaction source for scene-specific input rules", () => {
    const onInteract = vi.fn();
    const player = Object.assign(Object.create(PlayerController.prototype), {
      cinematic: false,
      selected: { id: "found-phone" },
      onInteract,
    });

    player.interact("hand");

    expect(onInteract).toHaveBeenCalledExactlyOnceWith("found-phone", { source: "hand" });
  });

  it("softly attracts the camera and reports a newly focused assisted target", () => {
    const focused = [];
    const interactionAnchor = {
      getWorldPosition: (target) => target.set(0.1, 0.2, -0.9),
    };
    const targetRoot = {
      visible: true,
      getWorldPosition: (target) => target.set(0, 0, -1),
    };
    const player = Object.assign(Object.create(PlayerController.prototype), {
      camera: {
        position: new THREE.Vector3(0, 0, 0),
        getWorldDirection: (target) => target.set(0, 0, -1),
      },
      raycaster: {
        setFromCamera: () => {},
        intersectObjects: () => [],
      },
      interactables: [{ id: "fuse", label: "拿取保险丝", enabled: true, root: targetRoot, halo: { visible: false } }],
      targetPosition: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      selected: null,
      aimAssist: null,
      onPrompt: () => {},
      onTarget: (event) => focused.push(event),
    });

    player.interactables[0].interactionAnchor = interactionAnchor;
    player.updateInteraction();

    expect(player.selected.id).toBe("fuse");
    expect(player.aimAssist.target).toEqual(new THREE.Vector3(0.1, 0.2, -0.9));
    expect(player.aimAssist.strength).toBe(0.28);
    expect(focused).toEqual([expect.objectContaining({
      id: "fuse",
      focused: true,
      contactPoint: { x: 0.1, y: 0.2, z: -0.9 },
    })]);
    expect(focused[0].contactNormal.x).toBeCloseTo(0, 8);
    expect(focused[0].contactNormal.y).toBeCloseTo(0, 8);
    expect(focused[0].contactNormal.z).toBeCloseTo(1, 8);
    expect(focused[0].focusedAt).toEqual(expect.any(Number));
  });

  it("reports an authored contact normal for an assisted manifest target", () => {
    const focused = [];
    const root = {
      visible: true,
      getWorldPosition: (target) => target.set(0, 0, -1),
    };
    const player = Object.assign(Object.create(PlayerController.prototype), {
      camera: {
        position: new THREE.Vector3(0, 0, 0),
        getWorldDirection: (target) => target.set(0, 0, -1),
      },
      raycaster: { setFromCamera: vi.fn(), intersectObjects: vi.fn(() => []) },
      interactables: [{
        id: "panel",
        label: "panel",
        enabled: true,
        root,
        halo: { visible: false },
        interaction: {
          anchor: root,
          contactRadius: 0.22,
          maxUseDistance: 2.35,
          approachDirection: null,
          contactNormal: new THREE.Vector3(1, 0, 0),
        },
      }],
      staticOccluderRoots: [],
      targetPosition: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      selected: null,
      aimAssist: null,
      onPrompt: vi.fn(),
      onTarget: (event) => focused.push(event),
    });

    player.updateInteraction();

    expect(focused[0].contactNormal).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("reports the actual raycast hit point and world-space surface normal", () => {
    const focused = [];
    const targetObject = {
      userData: { interactableId: "faucet" },
      matrixWorld: new THREE.Matrix4().makeRotationY(Math.PI / 2),
    };
    const targetRoot = { visible: true };
    const hit = {
      distance: 1.1,
      object: targetObject,
      point: new THREE.Vector3(0.25, 1.2, -1.4),
      face: { normal: new THREE.Vector3(0, 0, 1) },
    };
    const player = Object.assign(Object.create(PlayerController.prototype), {
      camera: {
        position: new THREE.Vector3(0, 0, 0),
        getWorldDirection: (target) => target.set(0, 0, -1),
      },
      raycaster: {
        setFromCamera: () => {},
        intersectObjects: () => [hit],
      },
      interactables: [{ id: "faucet", label: "水龙头", enabled: true, root: targetRoot, halo: { visible: false } }],
      targetPosition: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      selected: null,
      aimAssist: null,
      onPrompt: () => {},
      onTarget: (event) => focused.push(event),
    });
    targetObject.parent = targetRoot;

    player.updateInteraction();

    expect(focused).toHaveLength(1);
    expect(focused[0]).toEqual(expect.objectContaining({
      id: "faucet",
      focused: true,
      contactPoint: { x: 0.25, y: 1.2, z: -1.4 },
    }));
    expect(focused[0].contactNormal.x).toBeCloseTo(1, 8);
    expect(focused[0].contactNormal.y).toBeCloseTo(0, 8);
    expect(focused[0].contactNormal.z).toBeCloseTo(0, 8);
    expect(focused[0].focusedAt).toEqual(expect.any(Number));
  });

  it("rejects a direct interactable hit when a static wall is closer", () => {
    const targetObject = {
      userData: { interactableId: "faucet" },
      matrixWorld: new THREE.Matrix4(),
    };
    const targetRoot = {
      visible: true,
      getWorldPosition: (target) => target.set(0, 0, -1.4),
    };
    targetObject.parent = targetRoot;
    const onTarget = vi.fn();
    const player = Object.assign(Object.create(PlayerController.prototype), {
      camera: {
        position: new THREE.Vector3(0, 0, 0),
        getWorldDirection: (target) => target.set(0, 0, -1),
      },
      raycaster: {
        setFromCamera: vi.fn(),
        intersectObjects: vi.fn(() => [{
          distance: 1.4,
          object: targetObject,
          point: new THREE.Vector3(0, 0, -1.4),
          face: { normal: new THREE.Vector3(0, 0, 1) },
        }]),
      },
      occlusionRaycaster: {
        set: vi.fn(),
        intersectObjects: vi.fn(() => [{ distance: 0.6, object: { isMesh: true } }]),
      },
      staticOccluderRoots: [{ visible: true }],
      interactables: [{ id: "faucet", label: "faucet", enabled: true, root: targetRoot, halo: { visible: false } }],
      targetPosition: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      selected: null,
      aimAssist: null,
      onPrompt: vi.fn(),
      onTarget,
    });

    player.updateInteraction();

    expect(player.selected).toBeNull();
    expect(player.aimAssist).toBeNull();
    expect(onTarget).not.toHaveBeenCalled();
  });

  it("ignores decorative sprites while evaluating anchor occlusion", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    sprite.position.set(0, 0, -0.6);
    sprite.updateMatrixWorld(true);
    const player = Object.assign(Object.create(PlayerController.prototype), {
      camera,
      occlusionRaycaster: new THREE.Raycaster(),
      staticOccluderRoots: [sprite],
    });

    expect(() => player.isAnchorOccluded(new THREE.Vector3(0, 0, -1.4), 0.22)).not.toThrow();
    expect(player.isAnchorOccluded(new THREE.Vector3(0, 0, -1.4), 0.22)).toBe(false);
  });

  it("switches to keyboard fallback without applying a stale phone delta", () => {
    const player = createPlayer();
    player.phoneInput = { seq: 7, viewDelta: { yaw: 40, pitch: 10 }, move: { x: 0, y: 0 }, clutch: false };

    expect(() => player.setFallback(true)).not.toThrow();

    expect(player.fallback).toBe(true);
    expect(player.lastViewSequence).toBe(7);
  });

  it("applies each view delta once in degrees", () => {
    const player = createPlayer();
    const input = { seq: 4, viewDelta: { yaw: 90, pitch: 20 }, clutch: true };

    player.applyPhoneViewDelta(input);
    const firstYaw = player.cameraYaw;
    player.applyPhoneViewDelta(input);

    expect(firstYaw).toBeCloseTo(0.8 + Math.PI / 2, 6);
    expect(player.cameraYaw).toBeCloseTo(firstYaw, 6);
    expect(player.cameraPitch).toBeCloseTo(-0.35 + 20 * Math.PI / 180, 6);
  });

  it("honors sensitivity, inversion, and pitch clamp", () => {
    const player = createPlayer();
    player.settings = { sensitivity: 0.5, invertY: true };
    player.cameraPitch = -1.2;

    player.applyPhoneViewDelta({ seq: 1, viewDelta: { yaw: 40, pitch: 40 }, clutch: true });

    expect(player.cameraYaw).toBeCloseTo(0.8 + 20 * Math.PI / 180, 6);
    expect(player.cameraPitch).toBeCloseTo(-1.25, 6);
  });

  it("lets an opposite phone delta unwind pitch that hit the camera limit", () => {
    const player = createPlayer();
    player.cameraPitch = 0.8;

    player.applyPhoneViewDelta({ seq: 1, viewDelta: { yaw: 0, pitch: 60 }, clutch: true });
    player.applyPhoneViewDelta({ seq: 2, viewDelta: { yaw: 0, pitch: -60 }, clutch: true });

    expect(player.cameraPitch).toBeCloseTo(0.8, 6);
    expect(player.pitchOverflow).toBeCloseTo(0, 6);
  });

  it("clears hidden pitch overflow when the joystick is released", () => {
    const player = createPlayer();
    player.cameraPitch = 0.8;

    player.applyPhoneViewDelta({ seq: 1, viewDelta: { yaw: 0, pitch: 60 }, clutch: true });
    player.applyPhoneViewDelta({ seq: 2, viewDelta: { yaw: 0, pitch: 0 }, clutch: false });
    player.applyPhoneViewDelta({ seq: 3, viewDelta: { yaw: 0, pitch: -10 }, clutch: true });

    expect(player.pitchOverflow).toBeCloseTo(0, 6);
    expect(player.cameraPitch).toBeCloseTo(1.25 - 10 * Math.PI / 180, 6);
  });

  it("snaps the rendered camera to the target when smoothing is zero", () => {
    const player = createPlayer();
    player.settings.smoothing = 0;
    player.cameraYaw = 2.4;
    player.cameraPitch = 0.4;

    player.updateCameraPresentation(1 / 60);

    expect(player.cameraRenderYaw).toBe(2.4);
    expect(player.cameraRenderPitch).toBe(0.4);
  });

  it("smooths only the rendered view without changing target angles", () => {
    const player = createPlayer();
    player.cameraYaw = 1.8;
    player.cameraPitch = 0.25;

    player.updateCameraPresentation(1 / 60);

    expect(player.cameraRenderYaw).toBeGreaterThan(0.8);
    expect(player.cameraRenderYaw).toBeLessThan(1.8);
    expect(player.cameraRenderPitch).toBeGreaterThan(-0.35);
    expect(player.cameraRenderPitch).toBeLessThan(0.25);
    expect(player.cameraYaw).toBe(1.8);
    expect(player.cameraPitch).toBe(0.25);
  });

  it("is frame-rate independent over equal elapsed time", () => {
    const fast = createPlayer();
    const slow = createPlayer();
    fast.cameraYaw = 2;
    slow.cameraYaw = 2;

    for (let index = 0; index < 60; index += 1) fast.updateCameraPresentation(1 / 60);
    for (let index = 0; index < 30; index += 1) slow.updateCameraPresentation(1 / 30);

    expect(fast.cameraRenderYaw).toBeCloseTo(slow.cameraRenderYaw, 8);
  });

  it("keeps aim assist consistent across display refresh rates", () => {
    const fast = createPlayer();
    const slow = createPlayer();
    for (const player of [fast, slow]) {
      player.camera = { position: new THREE.Vector3(0, 0, 0) };
      player.cameraRenderYaw = 0;
      player.cameraRenderPitch = 0;
      player.setAimAssist(new THREE.Vector3(-1, 0, -1), 0.22);
    }

    for (let index = 0; index < 30; index += 1) fast.applyAimAssist(1 / 120);
    for (let index = 0; index < 15; index += 1) slow.applyAimAssist(1 / 60);

    expect(fast.cameraRenderYaw).toBeCloseTo(slow.cameraRenderYaw, 8);
    expect(fast.cameraRenderPitch).toBeCloseTo(slow.cameraRenderPitch, 8);
  });
});

describe("player crouch presentation", () => {
  it.each([30, 60, 120])("approaches the crouched pose monotonically at %ifps", (fps) => {
    const player = createCrouchPlayer();
    player.setCrouching(true);
    let previous = player.crouchAmount;

    for (let index = 0; index < fps; index += 1) {
      player.update(1 / fps);
      expect(player.crouchAmount).toBeGreaterThanOrEqual(previous);
      previous = player.crouchAmount;
    }
    player.syncAfterPhysics();

    expect(player.crouchAmount).toBeGreaterThan(0.98);
    expect(player.camera.position.y - player.body.translation().y).toBeCloseTo(0.20, 2);
  });

  it("interpolates eye height and speed, then recovers after release", () => {
    const player = createCrouchPlayer();
    player.setCrouching(true);
    for (let index = 0; index < 60; index += 1) player.update(1 / 60);
    player.syncAfterPhysics();

    expect(player.camera.position.y - player.body.translation().y).toBeCloseTo(0.20, 2);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeCloseTo(0, 6);
    expect(player.movementSpeed).toBeCloseTo(2.0, 2);

    player.setCrouching(false);
    for (let index = 0; index < 60; index += 1) player.update(1 / 60);
    player.syncAfterPhysics();

    expect(player.crouchAmount).toBeLessThan(0.02);
    expect(player.camera.position.y - player.body.translation().y).toBeCloseTo(0.55, 2);
    expect(player.movementSpeed).toBeCloseTo(3.25, 2);
  });

  it("uses fresh phone crouch input and Control/C fallback keys", () => {
    const phonePlayer = createCrouchPlayer();
    phonePlayer.setControllerInput({
      seq: 1,
      viewDelta: { yaw: 0, pitch: 0 },
      move: { x: 0, y: 0 },
      clutch: false,
      crouch: true,
    }, true);
    phonePlayer.update(1 / 60);
    expect(phonePlayer.crouchAmount).toBeGreaterThan(0);

    const fallbackPlayer = createCrouchPlayer({ phoneConnected: false, fallback: true });
    fallbackPlayer.keys.add("ControlLeft");
    fallbackPlayer.update(1 / 60);
    expect(fallbackPlayer.crouchAmount).toBeGreaterThan(0);
    fallbackPlayer.keys.delete("ControlLeft");
    fallbackPlayer.keys.add("KeyC");
    fallbackPlayer.update(1 / 60);
    expect(fallbackPlayer.crouchAmount).toBeGreaterThan(0);
  });

  it("resets crouch when paused, disconnected, or entering a cinematic", () => {
    const player = createCrouchPlayer();
    player.setCrouching(true);
    player.setPaused(true);
    expect(player.crouchAmount).toBe(0);

    player.setCrouching(true);
    player.setControllerInput(null, false);
    expect(player.crouchAmount).toBe(0);

    player.setCrouching(true);
    player.beginCinematic();
    expect(player.crouchAmount).toBe(0);
  });

  it("snapshots and restores crouch presentation", () => {
    const player = createCrouchPlayer();
    player.setCrouching(true);
    for (let index = 0; index < 60; index += 1) player.update(1 / 60);
    const pose = player.snapshotPose();
    player.setCrouching(false);
    player.restorePose(pose);

    expect(pose.crouchAmount).toBeGreaterThan(0.98);
    expect(player.crouchAmount).toBeCloseTo(pose.crouchAmount, 8);
  });
});
