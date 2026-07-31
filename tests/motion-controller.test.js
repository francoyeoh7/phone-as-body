import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MotionController,
  mapCameraSample,
  normalizeRoll,
  chooseTwistRate,
  totalRotationSpeed,
  wrappedAngleDelta,
} from "../src/controller/MotionController.js";

const zeroRaw = { x: 0, y: 0, scaleVelocity: 0, rotation: 0, confidence: 0 };

function createEventTarget({ motionPermission = "granted", orientationPermission = "granted" } = {}) {
  const listeners = new Map();
  const screenListeners = new Map();
  const target = {
    isSecureContext: true,
    location: { hostname: "controller.test" },
    DeviceMotionEvent: { requestPermission: vi.fn(async () => motionPermission) },
    DeviceOrientationEvent: { requestPermission: vi.fn(async () => orientationPermission) },
    screen: {
      orientation: {
        angle: 0,
        addEventListener: vi.fn((type, listener) => screenListeners.set(type, listener)),
        removeEventListener: vi.fn((type, listener) => {
          if (screenListeners.get(type) === listener) screenListeners.delete(type);
        }),
      },
    },
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    }),
    setTimeout,
    clearTimeout,
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    dispatchScreen(type, event = {}) {
      screenListeners.get(type)?.(event);
    },
  };
  return target;
}

function createCameraTracker(startResult = true) {
  return {
    onSample: null,
    onState: null,
    start: vi.fn(async () => startResult),
    setFrozen: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    emitSample(sample) {
      this.onSample?.(sample);
    },
  };
}

function createController({ target = createEventTarget(), cameraTracker = createCameraTracker(), ...options } = {}) {
  const samples = [];
  const states = [];
  const candidates = vi.fn();
  const interacts = vi.fn();
  const controller = new MotionController({
    eventTarget: target,
    cameraTracker,
    onSample: (sample) => samples.push(sample),
    onState: (state) => states.push(state),
    onTwistCandidate: candidates,
    onInteract: interacts,
    ...options,
  });
  return { controller, target, cameraTracker, samples, states, candidates, interacts };
}

describe("motion controller helpers", () => {
  it("wraps finite angle deltas to the shortest signed degree", () => {
    expect(wrappedAngleDelta(179, -179)).toBe(2);
    expect(wrappedAngleDelta(-179, 179)).toBe(-2);
    expect(wrappedAngleDelta(0, 180)).toBe(180);
    expect(wrappedAngleDelta(0, -180)).toBe(-180);
  });

  it("returns zero for invalid angle deltas and rates", () => {
    expect(wrappedAngleDelta(Number.NaN, 1)).toBe(0);
    expect(wrappedAngleDelta(1, Number.POSITIVE_INFINITY)).toBe(0);
    expect(chooseTwistRate({ gamma: Number.NaN }, 12)).toBe(12);
    expect(chooseTwistRate({ gamma: 8 }, 12)).toBe(8);
    expect(chooseTwistRate(null, Number.NaN)).toBe(0);
    expect(totalRotationSpeed({ alpha: Number.NaN, beta: 3, gamma: Number.NaN }, 4)).toBe(5);
    expect(Number.isNaN(totalRotationSpeed(null, Number.NaN))).toBe(false);
  });

  it("normalizes relative roll against a baseline", () => {
    expect(normalizeRoll(-179, 179)).toBe(2);
    expect(normalizeRoll(Number.NaN, 0)).toBe(0);
    expect(normalizeRoll(20, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("remaps camera axes for grip roll without inventing motion", () => {
    const neutral = mapCameraSample(
      { x: 0, y: 0, scaleVelocity: 0, confidence: 1 },
      { gravity: { x: 0, y: 0, z: 9.81 }, currentGamma: 0, baselineGamma: 0 },
    );
    const rolled = mapCameraSample(
      { x: 0, y: 1, scaleVelocity: 0, confidence: 1 },
      { gravity: { x: 0, y: 0, z: 9.81 }, currentGamma: 90, baselineGamma: 0 },
    );

    expect(neutral).toEqual({ x: 0, y: 0, confidence: 1 });
    expect(rolled.x).toBeCloseTo(9 / 13, 8);
    expect(rolled.y).toBe(0);
    expect(rolled.confidence).toBe(1);
  });

  it("adds screen-up scale to vertical view motion and preserves the confidence gate", () => {
    const screenUp = mapCameraSample(
      { x: 0, y: 0, scaleVelocity: 0.5, confidence: 1 },
      { gravity: { x: 0, y: 0, z: 9.81 }, currentGamma: 0, baselineGamma: 0 },
    );
    const weak = mapCameraSample(
      { x: 1, y: 1, scaleVelocity: 1, confidence: 0.44 },
      { gravity: { x: 0, y: 0, z: 0 }, currentGamma: 0, baselineGamma: 0 },
    );

    expect(screenUp.y).toBeGreaterThan(0);
    expect(screenUp.x).toBe(0);
    expect(weak).toEqual({ x: 0, y: 0, confidence: 0.44 });
  });

  it("returns neutral output for an invalid camera sample", () => {
    expect(mapCameraSample(null, {})).toEqual({ x: 0, y: 0, confidence: 0 });
    expect(mapCameraSample({ x: Number.NaN, y: 1, scaleVelocity: 0, confidence: 1 }, {}))
      .toEqual({ x: 0, y: 0, confidence: 0 });
  });
});

describe("motion controller permissions and lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("grants motion and camera, registers each sensor listener once, and forwards camera states", async () => {
    const harness = createController();

    await expect(harness.controller.requestPermission()).resolves.toEqual({
      motionGranted: true,
      cameraGranted: true,
    });
    await expect(harness.controller.requestPermission()).resolves.toEqual({
      motionGranted: true,
      cameraGranted: true,
    });

    expect(harness.target.DeviceMotionEvent.requestPermission).toHaveBeenCalledTimes(1);
    expect(harness.target.DeviceOrientationEvent.requestPermission).toHaveBeenCalledTimes(1);
    expect(harness.target.addEventListener).toHaveBeenCalledTimes(3);
    expect(harness.cameraTracker.start).toHaveBeenCalledTimes(1);

    harness.cameraTracker.onState("camera-active");
    expect(harness.states).toContain("camera-active");
  });

  it("starts both static sensor permission requests in the same interaction", async () => {
    const target = createEventTarget();
    let resolveMotion;
    target.DeviceMotionEvent.requestPermission.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMotion = resolve;
    }));
    const harness = createController({ target });

    const permission = harness.controller.requestPermission();
    await Promise.resolve();

    expect(target.DeviceMotionEvent.requestPermission).toHaveBeenCalledTimes(1);
    expect(target.DeviceOrientationEvent.requestPermission).toHaveBeenCalledTimes(1);

    resolveMotion("granted");
    await expect(permission).resolves.toEqual({ motionGranted: true, cameraGranted: true });
  });

  it("keeps the sensor failure result when motion is denied", async () => {
    const target = createEventTarget({ motionPermission: "denied" });
    const harness = createController({ target });

    await expect(harness.controller.requestPermission()).resolves.toEqual({
      motionGranted: false,
      cameraGranted: false,
    });
    expect(harness.cameraTracker.start).not.toHaveBeenCalled();
    expect(harness.states).toContain("denied");
  });

  it("keeps motion usable when camera access is denied", async () => {
    const harness = createController({ cameraTracker: createCameraTracker(false) });

    await expect(harness.controller.requestPermission()).resolves.toEqual({
      motionGranted: true,
      cameraGranted: false,
    });
    expect(harness.target.addEventListener).toHaveBeenCalledTimes(3);
  });

  it("resumes sensors without attempting to restart the camera", async () => {
    const harness = createController({ cameraTracker: createCameraTracker(false) });

    await harness.controller.requestPermission();
    harness.controller.suspend();
    harness.controller.resumeSensors();

    expect(harness.controller.suspended).toBe(false);
    expect(harness.cameraTracker.start).toHaveBeenCalledTimes(1);
    expect(harness.cameraTracker.setFrozen).toHaveBeenLastCalledWith(false);
  });

  it("starts camera when first enable follows a pre-permission suspend", async () => {
    const harness = createController();

    harness.controller.suspend();

    await expect(harness.controller.requestPermission()).resolves.toEqual({
      motionGranted: true,
      cameraGranted: true,
    });
    expect(harness.cameraTracker.start).toHaveBeenCalledTimes(1);
  });

  it("does not start camera when suspension interrupts pending permission", async () => {
    const target = createEventTarget();
    let resolveMotion;
    target.DeviceMotionEvent.requestPermission.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMotion = resolve;
    }));
    const harness = createController({ target });
    const permission = harness.controller.requestPermission();
    await Promise.resolve();

    harness.controller.suspend();
    resolveMotion("granted");

    await expect(permission).resolves.toEqual({
      motionGranted: true,
      cameraGranted: false,
    });
    expect(harness.cameraTracker.start).not.toHaveBeenCalled();
    expect(harness.controller.suspended).toBe(true);
  });

  it("does not reactivate camera when startup resolves after suspension", async () => {
    const cameraTracker = createCameraTracker();
    let resolveStart;
    cameraTracker.start.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));
    const harness = createController({ cameraTracker });
    const permission = harness.controller.requestPermission();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    expect(cameraTracker.start).toHaveBeenCalledTimes(1);
    harness.controller.suspend();
    resolveStart(true);

    await expect(permission).resolves.toEqual({
      motionGranted: true,
      cameraGranted: false,
    });
    expect(harness.controller.suspended).toBe(true);
    expect(harness.controller.cameraActive).toBe(false);
  });

  it("keeps a small wrap-boundary orientation change available for translation", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("deviceorientation", { gamma: 179, timeStamp: 0 });
    harness.target.dispatch("deviceorientation", { gamma: -179, timeStamp: 100 });
    harness.target.dispatch("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      rotationRate: { alpha: 0, beta: 0, gamma: Number.NaN },
      timeStamp: 100,
    });
    harness.target.dispatch("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      timeStamp: 140,
    });

    expect(harness.cameraTracker.setFrozen).not.toHaveBeenCalled();
  });

  it("consumes a derived gamma fallback for only one motion event", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("deviceorientation", { gamma: 0, timeStamp: 0 });
    harness.target.dispatch("deviceorientation", { gamma: 20, timeStamp: 100 });
    harness.target.dispatch("devicemotion", {
      rotationRate: { alpha: 0, beta: 0, gamma: Number.NaN },
      timeStamp: 100,
    });
    harness.target.dispatch("devicemotion", {
      rotationRate: { alpha: 0, beta: 0, gamma: Number.NaN },
      timeStamp: 140,
    });

    expect(harness.cameraTracker.setFrozen).toHaveBeenNthCalledWith(1, true);
    expect(harness.cameraTracker.setFrozen).toHaveBeenNthCalledWith(2, false);
  });

  it("holds camera output neutral until the first calibration reset", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.cameraTracker.emitSample({ x: 1, y: 0, scaleVelocity: 0, confidence: 1 });
    expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });

    harness.controller.reset();
    harness.cameraTracker.emitSample({ x: 1, y: 0, scaleVelocity: 0, confidence: 1 });
    expect(harness.samples.at(-1).x).toBeGreaterThan(0);

    harness.target.dispatch("orientationchange");
    vi.advanceTimersByTime(350);
    harness.cameraTracker.emitSample({ x: 1, y: 0, scaleVelocity: 0, confidence: 1 });
    expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });

    harness.controller.reset();
    harness.controller.suspend();
    await harness.controller.resume();
    harness.cameraTracker.emitSample({ x: 1, y: 0, scaleVelocity: 0, confidence: 1 });
    expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });
  });

  it("suppresses camera samples during both threshold and fast rotation", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    for (const alpha of [55, 220]) {
      harness.target.dispatch("devicemotion", {
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
        rotationRate: { alpha, beta: 0, gamma: 0 },
        timeStamp: alpha,
      });
      harness.cameraTracker.emitSample({ x: 1, y: 0, scaleVelocity: 0, confidence: 1 });
      expect(harness.cameraTracker.setFrozen).toHaveBeenLastCalledWith(true);
      expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });

      harness.target.dispatch("devicemotion", {
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        timeStamp: alpha + 1,
      });
      expect(harness.cameraTracker.setFrozen).toHaveBeenLastCalledWith(false);
    }
  });

  it("does not freeze camera translation for ordinary hand motion", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      rotationRate: { alpha: 20, beta: 0, gamma: 0 },
      timeStamp: 20,
    });

    expect(harness.cameraTracker.setFrozen).not.toHaveBeenCalled();
  });

  it("routes real opposite twist candidates to the two callbacks", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    const emitTwist = (start, gamma) => {
      [0, 40, 80, 120].forEach((offset) => harness.target.dispatch("devicemotion", {
        rotationRate: { alpha: 0, beta: 0, gamma },
        timeStamp: start + offset,
      }));
      harness.target.dispatch("devicemotion", {
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        timeStamp: start + 160,
      });
    };

    emitTwist(0, 220);
    emitTwist(300, -220);

    expect(harness.candidates).toHaveBeenCalledTimes(1);
    expect(harness.interacts).toHaveBeenCalledTimes(1);
  });

  it("resets and suspends with zero output, restarts camera on resume, and cleans up once", async () => {
    const harness = createController();
    await harness.controller.requestPermission();
    harness.cameraTracker.emitSample({ x: 1, y: 0, scaleVelocity: 0, confidence: 1 });

    harness.controller.reset();
    expect(harness.cameraTracker.reset).toHaveBeenCalledTimes(1);
    expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });

    harness.controller.suspend();
    expect(harness.cameraTracker.stop).toHaveBeenCalledTimes(1);
    expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });
    expect(await harness.controller.resume()).toBe(true);
    expect(harness.cameraTracker.start).toHaveBeenCalledTimes(2);
    expect(harness.target.addEventListener).toHaveBeenCalledTimes(3);

    harness.controller.destroy();
    harness.controller.destroy();
    expect(harness.cameraTracker.destroy).toHaveBeenCalledTimes(1);
    expect(harness.target.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it("holds zero output while reorienting and resumes after the grace period", async () => {
    const harness = createController();
    await harness.controller.requestPermission();

    harness.target.dispatch("orientationchange");
    harness.cameraTracker.emitSample({ x: 1, y: 1, scaleVelocity: 0, confidence: 1 });

    expect(harness.states).toContain("reorienting");
    expect(harness.samples.at(-1)).toEqual({ x: 0, y: 0, confidence: 0 });
    expect(harness.cameraTracker.setFrozen).toHaveBeenCalledWith(true);

    vi.advanceTimersByTime(350);
    expect(harness.cameraTracker.setFrozen).toHaveBeenLastCalledWith(false);
    expect(harness.states).toContain("waiting");
  });
});
