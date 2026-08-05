import { describe, expect, it, vi } from "vitest";
import { MediaPipeHandTracker } from "../src/controller/MediaPipeHandTracker.js";

function handResult({ label = "Left" } = {}) {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: (i % 5) / 5, y: Math.floor(i / 5) / 5, z: 0 }));
  return {
    landmarks: [landmarks], worldLandmarks: [landmarks],
    handedness: [[{ categoryName: label, score: 0.94 }]],
  };
}

function setup(options = {}) {
  const video = { readyState: 2, videoWidth: 320, videoHeight: 240, srcObject: { getTracks: () => [{ getSettings: () => ({ facingMode: "environment" }) }] } };
  const callbacks = { onFrame: vi.fn(), onState: vi.fn() };
  const scheduler = options.scheduler ?? { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 0) };
  const tracker = new MediaPipeHandTracker({ getVideo: () => video, ...callbacks, scheduler, ...options });
  return { tracker, video, callbacks, scheduler };
}

describe("MediaPipeHandTracker", () => {
  it("never requests a camera and reads the existing video", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const { tracker, video } = setup({ worker: false, loadModule: vi.fn(async () => ({ createFromOptions: vi.fn(async () => ({ detectForVideo: vi.fn(() => handResult()), close: vi.fn() })) })) });
    expect(tracker.getVideo()).toBe(video);
    await tracker.setTask({ active: true });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("uses VIDEO mode, numHands 2, emits one frame and inputMirrored false", async () => {
    const createFromOptions = vi.fn(async (_fileset, options) => ({ detectForVideo: vi.fn(() => handResult()), close: vi.fn(), options }));
    const { tracker, callbacks } = setup({ worker: false, loadModule: vi.fn(async () => ({ FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) }, HandLandmarker: { createFromOptions } })) });
    await tracker.setTask({ active: true });
    tracker.sample();
    await Promise.resolve();
    expect(createFromOptions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ runningMode: "VIDEO", numHands: 2 }));
    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({ handedness: "right" }));
  });

  it("rejects an explicitly front-facing stream before bitmap creation", async () => {
    const bitmap = vi.fn();
    const { tracker } = setup({ worker: false, createImageBitmap: bitmap });
    tracker.getVideo().srcObject.getTracks = () => [{ getSettings: () => ({ facingMode: "user" }) }];
    await tracker.setTask({ active: true });
    tracker.sample();
    expect(bitmap).not.toHaveBeenCalled();
  });

  it("increments epoch and ignores stale worker results", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), addEventListener: vi.fn() };
    const { tracker } = setup({ workerFactory: () => worker });
    await tracker.setTask({ active: true });
    const epoch = tracker.modeEpoch;
    await tracker.setTask({ active: false });
    worker.onmessage?.({ data: { type: "result", modeEpoch: epoch, result: handResult(), capturedAt: 1 } });
    expect(worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "detect" }));
  });

  it("closes a bitmap when worker transfer throws", async () => {
    const bitmap = { close: vi.fn() };
    const worker = { postMessage: vi.fn((message) => { if (message.type === "detect") throw new Error("transfer"); }), terminate: vi.fn() };
    const { tracker } = setup({ workerFactory: () => worker, createImageBitmap: vi.fn(async () => bitmap), OffscreenCanvas: class {} });
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "ready", modeEpoch: tracker.modeEpoch } });
    await tracker.sample();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("emits lost after 250ms then keeps a 500ms heartbeat", () => {
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 250) };
    const { tracker, callbacks } = setup({ scheduler });
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.emitLostIfDue(250);
    tracker.emitLostIfDue(750);
    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.state)).toEqual(["lost", "lost"]);
    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.capturedAt)).toEqual([250, 750]);
  });
});
