import { describe, expect, it, vi } from "vitest";
import { MotionController } from "../src/controller/MotionController.js";

function createEventTarget({ motionPermission = "granted", orientationPermission = "granted" } = {}) {
  const listeners = new Map();
  const target = {
    isSecureContext: true,
    location: { hostname: "controller.test" },
    DeviceMotionEvent: { requestPermission: vi.fn(async () => motionPermission) },
    DeviceOrientationEvent: { requestPermission: vi.fn(async () => orientationPermission) },
    screen: { orientation: { angle: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } },
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
  return target;
}

function createController({ target = createEventTarget(), ...options } = {}) {
  const samples = [];
  const states = [];
  const interacts = vi.fn();
  const controller = new MotionController({
    eventTarget: target,
    onSample: (sample) => samples.push(sample),
    onState: (state) => states.push(state),
    onInteract: interacts,
    ...options,
  });
  return { controller, target, samples, states, interacts };
}

describe("motion controller", () => {
  it("requests motion and orientation without requesting camera access", async () => {
    const harness = createController();

    await expect(harness.controller.requestPermission()).resolves.toEqual({ motionGranted: true });

    expect(harness.target.DeviceMotionEvent.requestPermission).toHaveBeenCalledTimes(1);
    expect(harness.target.DeviceOrientationEvent.requestPermission).toHaveBeenCalledTimes(1);
    expect(harness.target.navigator?.mediaDevices).toBeUndefined();
  });

  it("emits calibrated orientation deltas", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("deviceorientation", { quaternion: { x: 0, y: 0, z: 0, w: 1 } });
    harness.controller.reset();
    harness.target.dispatch("deviceorientation", { quaternion: { x: 0, y: 0, z: Math.sin(Math.PI / 18), w: Math.cos(Math.PI / 18) } });

    expect(harness.samples.at(-1).yaw).toBeGreaterThan(0);
    expect(harness.samples.at(-1).pitch).toBe(0);
  });

  it("turns one physical impact into one interaction and enforces cooldown", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("devicemotion", { acceleration: { x: 14, y: 0, z: 0 }, timeStamp: 10 });
    harness.target.dispatch("devicemotion", { acceleration: { x: 0, y: 0, z: 0 }, timeStamp: 80 });
    harness.target.dispatch("devicemotion", { acceleration: { x: 15, y: 0, z: 0 }, timeStamp: 120 });
    harness.target.dispatch("devicemotion", { acceleration: { x: 0, y: 0, z: 0 }, timeStamp: 180 });

    expect(harness.interacts).toHaveBeenCalledTimes(1);
  });

  it("does not treat ordinary rotation as a knock", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("devicemotion", { rotationRate: { alpha: 180, beta: 0, gamma: 0 }, timeStamp: 10 });
    harness.target.dispatch("devicemotion", { rotationRate: { alpha: 0, beta: 0, gamma: 0 }, timeStamp: 80 });

    expect(harness.interacts).not.toHaveBeenCalled();
  });
});
