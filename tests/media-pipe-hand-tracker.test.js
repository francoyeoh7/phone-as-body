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

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
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

  it("resumes with the same supplied camera video without another camera request", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const { tracker, video } = setup({
      workerFactory: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
      OffscreenCanvas: class {},
    });
    await tracker.setTask({ active: true });
    tracker.suspend();
    tracker.resume();
    worker.onmessage({ data: { type: "ready", modeEpoch: tracker.modeEpoch } });

    expect(tracker.getVideo()).toBe(video);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledOnce();
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

  it("reports unavailable when the authorized rear video never becomes ready", async () => {
    let now = 0;
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => now) };
    const createFromOptions = vi.fn(async () => ({ detectForVideo: vi.fn(), close: vi.fn() }));
    const { tracker, video, callbacks } = setup({
      worker: false,
      scheduler,
      loadModule: vi.fn(async () => ({
        FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
        HandLandmarker: { createFromOptions },
      })),
    });
    video.readyState = 0;
    await tracker.setTask({ active: true });

    tracker.sample();
    now = 2_999;
    tracker.sample();
    expect(callbacks.onFrame).not.toHaveBeenCalledWith(expect.objectContaining({ state: "unavailable" }));

    now = 3_000;
    tracker.sample();
    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({
      state: "unavailable",
      reason: "video-not-ready",
    }));
    expect(tracker.active).toBe(false);
  });

  it("increments epoch and ignores stale worker results", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), addEventListener: vi.fn() };
    const { tracker } = setup({
      workerFactory: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
      OffscreenCanvas: class {},
    });
    await tracker.setTask({ active: true });
    const epoch = tracker.modeEpoch;
    await tracker.setTask({ active: false });
    worker.onmessage?.({ data: { type: "result", modeEpoch: epoch, result: handResult(), capturedAt: 1 } });
    expect(worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "detect" }));
  });

  it("does not capture for a new epoch until that epoch reports worker ready", async () => {
    const bitmap = { close: vi.fn() };
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const { tracker } = setup({ workerFactory: () => worker, createImageBitmap: vi.fn(async () => bitmap), OffscreenCanvas: class {} });
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "ready", modeEpoch: 1 } });
    await tracker.sample();
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "result", modeEpoch: 1, result: { landmarks: [] }, capturedAt: 2 } });
    await tracker.sample();

    expect(worker.postMessage.mock.calls.map(([message]) => `${message.type}:${message.modeEpoch}`)).toEqual([
      "init:1", "detect:1", "init:2",
    ]);
    worker.onmessage({ data: { type: "ready", modeEpoch: 2 } });
    await tracker.sample();
    expect(worker.postMessage.mock.calls.map(([message]) => `${message.type}:${message.modeEpoch}`)).toEqual([
      "init:1", "detect:1", "init:2", "detect:2",
    ]);
  });

  it("limits capture scheduling to 15Hz and drops a busy capture", async () => {
    const pending = deferred();
    const bitmap = { close: vi.fn() };
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const createImageBitmap = vi.fn(() => pending.promise);
    const { tracker, scheduler } = setup({ workerFactory: () => worker, createImageBitmap, OffscreenCanvas: class {} });
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "ready", modeEpoch: 1 } });
    const first = tracker.sample();
    await tracker.sample();
    expect(createImageBitmap).toHaveBeenCalledOnce();
    pending.resolve(bitmap);
    await first;
    worker.onmessage({ data: { type: "result", modeEpoch: 1, result: { landmarks: [] }, capturedAt: 1 } });
    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), expect.closeTo(1000 / 15, 5));
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

  it("emits one lost transition then suppresses no-hand inference until the heartbeat", () => {
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 0) };
    const { tracker, callbacks } = setup({ scheduler });
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.lastResultAt = 0;

    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 250 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 316 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 382 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 750 });

    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.capturedAt)).toEqual([250, 750]);
  });

  it("drops and closes a bitmap that resolves after suspension or an epoch change", async () => {
    const pending = deferred();
    const bitmap = { close: vi.fn() };
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const { tracker } = setup({ workerFactory: () => worker, createImageBitmap: vi.fn(() => pending.promise), OffscreenCanvas: class {} });
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "ready", modeEpoch: tracker.modeEpoch } });
    const sampling = tracker.sample();
    tracker.suspend();
    await tracker.setTask({ active: false });
    await tracker.setTask({ active: true });
    pending.resolve(bitmap);
    await sampling;

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "detect" }));
    expect(tracker.inferencePending).toBe(false);
  });

  it("closes fallback task creation that resolves after destroy", async () => {
    const pendingLandmarker = deferred();
    const landmarker = { close: vi.fn(), detectForVideo: vi.fn() };
    const createFromOptions = vi.fn(() => pendingLandmarker.promise);
    const forVisionTasks = vi.fn(async () => ({}));
    const { tracker } = setup({
      worker: false,
      loadModule: vi.fn(async () => ({ FilesetResolver: { forVisionTasks }, HandLandmarker: { createFromOptions } })),
    });
    const activating = tracker.setTask({ active: true });
    await vi.waitFor(() => expect(createFromOptions).toHaveBeenCalledOnce());
    tracker.destroy();
    pendingLandmarker.resolve(landmarker);
    await activating;

    expect(landmarker.close).toHaveBeenCalledOnce();
    expect(tracker.landmarker).toBeNull();
  });

  it("closes the previous fallback landmarker before repeated task activation", async () => {
    const first = { close: vi.fn(), detectForVideo: vi.fn() };
    const second = { close: vi.fn(), detectForVideo: vi.fn() };
    const createFromOptions = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const { tracker } = setup({
      worker: false,
      loadModule: vi.fn(async () => ({ FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) }, HandLandmarker: { createFromOptions } })),
    });

    await tracker.setTask({ active: true });
    await tracker.setTask({ active: true });

    expect(first.close).toHaveBeenCalledOnce();
    expect(tracker.landmarker).toBe(second);
  });

  it("stops after an explicit worker inference error instead of rescheduling at 15Hz", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const { tracker, scheduler, callbacks } = setup({
      workerFactory: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
      OffscreenCanvas: class {},
    });
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "error", modeEpoch: tracker.modeEpoch, reason: "detect" } });

    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({ state: "unavailable" }));
    expect(scheduler.setTimeout).not.toHaveBeenCalledWith(expect.any(Function), tracker.sampleIntervalMs);
  });

  it("selects the highest-confidence handed candidate when continuity is absent", () => {
    const { tracker, callbacks } = setup();
    tracker.active = true;
    tracker.modeEpoch = 1;
    const result = handResult({ label: "Left" });
    result.landmarks.push(result.landmarks[0]);
    result.worldLandmarks.push(result.worldLandmarks[0]);
    result.handedness.push([{ categoryName: "Right", score: 0.99 }]);
    result.handedness[0][0].score = 0.2;

    tracker.handleResult({ result, capturedAt: 1 });

    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({ handedness: "left" }));
  });

  it("uses the main-thread fallback when worker construction lacks OffscreenCanvas", async () => {
    const detectForVideo = vi.fn(() => handResult());
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const { tracker, callbacks } = setup({
      workerFactory: () => worker,
      OffscreenCanvas: undefined,
      createImageBitmap: null,
      loadModule: vi.fn(async () => ({
        FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
        HandLandmarker: { createFromOptions: vi.fn(async () => ({ detectForVideo, close: vi.fn() })) },
      })),
    });

    await tracker.setTask({ active: true });
    tracker.sample();

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(detectForVideo).toHaveBeenCalledOnce();
    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({ state: "tracked" }));
  });
});
