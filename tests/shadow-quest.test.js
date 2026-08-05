import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ShadowQuestDirector } from "../src/desktop/ShadowQuestDirector.js";

function createHarness({ flashlightVisible = true, lookAtWindow = true, corridor = null } = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, -14.4);
  camera.lookAt(lookAtWindow ? new THREE.Vector3(-2.5, 1.95, -13.92) : new THREE.Vector3(0, 1.6, -20));
  camera.updateMatrixWorld(true);

  const taskPoint = new THREE.Object3D();
  taskPoint.position.set(-2.38, 1.95, -13.92);
  taskPoint.visible = false;
  taskPoint.updateMatrixWorld(true);
  const shadowFigure = new THREE.Sprite(new THREE.SpriteMaterial({ opacity: 0.9 }));
  const operatingDoor = new THREE.Object3D();
  const windowTarget = { enabled: false };
  const savedPose = {
    body: { x: 0, y: 1.05, z: -14.4 },
    camera: { x: 0, y: 1.6, z: -14.4 },
    cameraYaw: Math.PI / 2,
    cameraPitch: 0,
    cameraRenderYaw: Math.PI / 2,
    cameraRenderPitch: 0,
  };
  const player = {
    setAimAssist: vi.fn(),
    clearAimAssist: vi.fn(),
    snapshotPose: vi.fn(() => structuredClone(savedPose)),
    beginCinematic: vi.fn(),
    setCinematicCamera: vi.fn(),
    restorePose: vi.fn(),
    endCinematic: vi.fn(),
  };
  const ui = { setPrompt: vi.fn(), setSubtitle: vi.fn() };
  const audio = { cue: vi.fn() };
  const experience = {
    camera,
    objects: {
      flashlight: { visible: flashlightVisible },
      shadowQuest: {
        window: windowTarget,
        taskPoint,
        shadowFigure,
        operatingDoor,
      },
      ...(corridor ? { corridor } : {}),
    },
  };
  const director = new ShadowQuestDirector({ experience, player, ui, audio });
  return { director, player, ui, audio, taskPoint, shadowFigure, windowTarget, savedPose };
}

describe("shadow side quest", () => {
  it("uses the corridor shadow anchors for the cinematic peek when supplied", () => {
    const corridor = {
      anchors: {
        shadowWindow: {
          peekPosition: [-1.2, 1.92, -14.18],
          peekTarget: [-5.7, 1.42, -13.45],
        },
      },
    };
    const harness = createHarness({ corridor });

    expect(harness.director.peekPosition.toArray()).toEqual([-1.2, 1.92, -14.18]);
    expect(harness.director.peekTarget.toArray()).toEqual([-5.7, 1.42, -13.45]);
  });

  it("reveals the task point only near the window with flashlight aim", () => {
    const harness = createHarness();

    harness.director.update(0.016);

    expect(harness.director.isAvailable()).toBe(true);
    expect(harness.taskPoint.visible).toBe(true);
    expect(harness.windowTarget.enabled).toBe(true);
  });

  it("does not reveal or assist when the light is off", () => {
    const harness = createHarness({ flashlightVisible: false });

    harness.director.update(0.016);

    expect(harness.director.isAvailable()).toBe(false);
    expect(harness.taskPoint.visible).toBe(false);
    expect(harness.player.setAimAssist).not.toHaveBeenCalled();
  });

  it("does not reveal or assist when aim is outside the cone", () => {
    const harness = createHarness({ lookAtWindow: false });

    harness.director.update(0.016);

    expect(harness.director.isAvailable()).toBe(false);
    expect(harness.taskPoint.visible).toBe(false);
    expect(harness.player.setAimAssist).not.toHaveBeenCalled();
  });

  it("restores the exact saved player pose after the one-shot cinematic", () => {
    const harness = createHarness();
    harness.director.update(0.016);

    expect(harness.director.handleInteraction("shadow-window")).toBe(true);
    harness.director.update(6.5);

    expect(harness.director.complete).toBe(true);
    expect(harness.player.restorePose).toHaveBeenCalledWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.shadowFigure.visible).toBe(false);
    expect(harness.director.handleInteraction("shadow-window")).toBe(false);
  });

  it("restores controls when a cinematic is aborted", () => {
    const harness = createHarness();
    harness.director.update(0.016);
    harness.director.handleInteraction("shadow-window");

    harness.director.abort();

    expect(harness.player.restorePose).toHaveBeenCalledWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.director.complete).toBe(false);
  });
});
