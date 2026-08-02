import { describe, expect, it } from "vitest";
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

describe("player phone view deltas", () => {
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
