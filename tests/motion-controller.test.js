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
  const telemetry = [];
  const states = [];
  const interacts = vi.fn();
  const controller = new MotionController({
    eventTarget: target,
    onSample: (sample) => samples.push(sample),
    onTelemetry: (sample) => telemetry.push(sample),
    onState: (state) => states.push(state),
    onInteract: interacts,
    ...options,
  });
  return { controller, target, samples, telemetry, states, interacts };
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
    expect(harness.controller.engage).toBeTypeOf("function");
    harness.controller.engage();
    harness.target.dispatch("deviceorientation", { quaternion: { x: 0, y: 0, z: Math.sin(Math.PI / 18), w: Math.cos(Math.PI / 18) } });

    expect(harness.samples.at(-1).yaw).toBeGreaterThan(0);
    expect(harness.samples.at(-1).pitch).toBe(0);
  });

  it("freezes released motion and recalibrates every engagement", async () => {
    const harness = createController();
    await harness.controller.requestPermission();
    harness.target.dispatch("deviceorientation", { quaternion: { x: 0, y: 0, z: 0, w: 1 } });

    expect(harness.controller.engage).toBeTypeOf("function");
    expect(harness.controller.disengage).toBeTypeOf("function");
    harness.controller.engage();
    harness.target.dispatch("deviceorientation", {
      quaternion: { x: 0, y: 0, z: Math.sin(Math.PI / 36), w: Math.cos(Math.PI / 36) },
    });
    expect(harness.samples.at(-1).yaw).toBeGreaterThan(0);

    harness.controller.disengage();
    const releasedSampleCount = harness.samples.length;
    harness.target.dispatch("deviceorientation", {
      quaternion: { x: 0, y: 0, z: -Math.sin(Math.PI / 18), w: Math.cos(Math.PI / 18) },
    });
    expect(harness.samples).toHaveLength(releasedSampleCount);

    harness.controller.engage();
    harness.target.dispatch("deviceorientation", {
      quaternion: { x: 0, y: 0, z: -Math.sin(Math.PI / 12), w: Math.cos(Math.PI / 12) },
    });
    expect(harness.samples.at(-1).yaw).toBeLessThan(0);
  });

  it("reports raw sensor axes, physical aim, output, and sample rate", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("deviceorientation", {
      alpha: 10,
      beta: 20,
      gamma: 30,
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      timeStamp: 100,
    });
    harness.controller.reset();
    harness.target.dispatch("deviceorientation", {
      alpha: 12,
      beta: 21,
      gamma: 29,
      quaternion: { x: 0, y: 0, z: Math.sin(Math.PI / 36), w: Math.cos(Math.PI / 36) },
      timeStamp: 120,
    });
    harness.target.dispatch("deviceorientation", {
      alpha: 12,
      beta: 21,
      gamma: 29,
      quaternion: { x: 0, y: 0, z: Math.sin(Math.PI / 36), w: Math.cos(Math.PI / 36) },
      timeStamp: 140,
    });

    expect(harness.telemetry.at(-1)).toMatchObject({
      alpha: 12,
      beta: 21,
      gamma: 29,
      sensorHz: 50,
      physicalYaw: 10,
      outputYaw: 0,
      outputPitch: 0,
    });
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
