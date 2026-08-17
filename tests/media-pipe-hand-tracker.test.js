import { describe, expect, it, vi } from "vitest";
import { MediaPipeHandTracker } from "../src/controller/MediaPipeHandTracker.js";

function handResult({ label = "Right" } = {}) {
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
  const tracker = new MediaPipeHandTracker({
    getVideo: () => video,
    ...callbacks,
    scheduler,
    inputMirrored: false,
    ...options,
  });
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

  it("does not carry an isolated miss across suspension", () => {
    const { tracker, callbacks } = setup();
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.handleResult({ result: handResult(), capturedAt: 20 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 87 });

    tracker.suspend();
    tracker.resume();
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 154 });

    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.state)).toEqual(["tracked"]);

    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 221 });
    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.state)).toEqual(["tracked", "lost"]);
  });

  it("uses VIDEO mode with one physical left hand and emits a left frame", async () => {
    const createFromOptions = vi.fn(async (_fileset, options) => ({ detectForVideo: vi.fn(() => handResult()), close: vi.fn(), options }));
    const { tracker, callbacks } = setup({ worker: false, loadModule: vi.fn(async () => ({ FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) }, HandLandmarker: { createFromOptions } })) });
    await tracker.setTask({ active: true });
    tracker.sample();
    await Promise.resolve();
    expect(createFromOptions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ runningMode: "VIDEO", numHands: 1 }));
    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({ handedness: "left", palmSpan: expect.any(Number) }));
  });

  it("drops a physical right hand before reach and transport", () => {
    const { tracker, callbacks } = setup();
    tracker.active = true;
    tracker.modeEpoch = 1;

    tracker.handleResult({ result: handResult({ label: "Left" }), capturedAt: 20 });

    expect(callbacks.onFrame).not.toHaveBeenCalledWith(expect.objectContaining({ state: "tracked" }));
    expect(tracker.reachState.acquired).toBe(false);
    expect(tracker.previous).toBeNull();
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

  it("keeps isolated empty results from accumulating and loses only on consecutive misses", () => {
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 87) };
    const { tracker, callbacks } = setup({ scheduler });
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.handleResult({ result: handResult(), capturedAt: 20 });

    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 87 });

    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.state)).toEqual(["tracked"]);
    expect(tracker.previous).not.toBeNull();

    tracker.handleResult({ result: handResult(), capturedAt: 154 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 221 });

    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.state)).toEqual(["tracked", "tracked"]);

    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 288 });

    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.state)).toEqual(["tracked", "tracked", "lost"]);
    expect(callbacks.onFrame.mock.calls.at(-1)[0].capturedAt).toBe(288);
    expect(tracker.previous).toBeNull();
  });

  it("keeps a continuous acquired left hand through a temporary label flip", () => {
    const { tracker, callbacks } = setup({ inputMirrored: true });
    tracker.active = true;
    tracker.modeEpoch = 1;

    tracker.handleResult({ result: handResult({ label: "Left" }), capturedAt: 20 });
    tracker.handleResult({ result: handResult({ label: "Right" }), capturedAt: 87 });

    const tracked = callbacks.onFrame.mock.calls
      .map(([frame]) => frame)
      .filter((frame) => frame.state === "tracked");
    expect(tracked).toHaveLength(2);
    expect(tracked[1].handedness).toBe("left");
  });

  it("uses only the remaining absolute deadline after inference time", () => {
    let now = 45;
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => now) };
    const { tracker } = setup({ scheduler, sampleIntervalMs: 1000 / 15 });
    tracker.active = true;
    tracker.nextSampleDeadline = 1000 / 15;

    tracker.scheduleFromDeadline();

    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.closeTo(1000 / 15 - 45, 5),
    );
  });

  it("samples immediately when inference has overrun the next deadline", () => {
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 80) };
    const { tracker } = setup({ scheduler, sampleIntervalMs: 1000 / 15 });
    tracker.active = true;
    tracker.nextSampleDeadline = 1000 / 15;

    tracker.scheduleFromDeadline();

    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 0);
  });

  it("does not infer the same presented camera frame twice", async () => {
    const detectForVideo = vi.fn(() => handResult());
    const { tracker } = setup({ worker: false });
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.landmarker = { detectForVideo };

    await tracker.sample({ presentedFrames: 7 });
    await tracker.sample({ presentedFrames: 7 });

    expect(detectForVideo).toHaveBeenCalledOnce();
  });

  it("normalizes a landscape rear-camera frame using the live screen angle", () => {
    const { tracker, video, callbacks } = setup({ getScreenOrientation: () => 90 });
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    tracker.active = true;
    tracker.modeEpoch = 1;

    tracker.handleResult({ result: handResult(), capturedAt: 20 });

    expect(tracker.currentRotation).toBe(90);
    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({ handedness: "left" }));
  });

  it("clears reach acquisition and depth calibration after sustained hand loss", () => {
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 250) };
    const { tracker } = setup({ scheduler });
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.lastResultAt = 0;
    tracker.reachState = { ...tracker.reachState, acquired: true };
    tracker.calibration = { palmSpan: 0.2 };

    tracker.emitLostIfDue(250);
    tracker.emitLostIfDue(316);

    expect(tracker.reachState.acquired).toBe(false);
    expect(tracker.calibration).toBeNull();
  });

  it("emits one lost transition while repeated empty inference results continue", () => {
    const scheduler = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 0) };
    const { tracker, callbacks } = setup({ scheduler });
    tracker.active = true;
    tracker.modeEpoch = 1;
    tracker.lastResultAt = 0;

    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 250 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 316 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 382 });
    tracker.handleResult({ result: { landmarks: [] }, capturedAt: 750 });

    expect(callbacks.onFrame.mock.calls.map(([frame]) => frame.capturedAt)).toEqual([316]);
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

  it("remembers worker readiness received while suspended and resumes sampling", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const { tracker, scheduler } = setup({
      workerFactory: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
      OffscreenCanvas: class {},
    });
    await tracker.setTask({ active: true });
    tracker.suspend();

    worker.onmessage({ data: { type: "ready", modeEpoch: tracker.modeEpoch } });
    expect(tracker.workerReadyEpoch).toBe(tracker.modeEpoch);
    tracker.resume();

    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 0);
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

  it("falls back to the latest-only main-thread tracker after a worker inference error", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const detectForVideo = vi.fn(() => handResult());
    const { tracker, scheduler, callbacks } = setup({
      workerFactory: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
      OffscreenCanvas: class {},
      loadModule: vi.fn(async () => ({
        FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
        HandLandmarker: { createFromOptions: vi.fn(async () => ({ detectForVideo, close: vi.fn() })) },
      })),
    });
    await tracker.setTask({ active: true });
    worker.onmessage({ data: { type: "error", modeEpoch: tracker.modeEpoch, reason: "detect" } });

    await vi.waitFor(() => expect(tracker.landmarker).not.toBeNull());
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(callbacks.onFrame).not.toHaveBeenCalledWith(expect.objectContaining({ state: "unavailable" }));
    expect(tracker.active).toBe(true);
    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 0);
  });

  it("selects the physical left candidate even when a right hand scores higher", () => {
    const { tracker, callbacks } = setup();
    tracker.active = true;
    tracker.modeEpoch = 1;
    const result = handResult({ label: "Right" });
    result.landmarks.push(result.landmarks[0]);
    result.worldLandmarks.push(result.worldLandmarks[0]);
    result.handedness.push([{ categoryName: "Left", score: 0.99 }]);
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

  it("prefers the bundled worker when Worker APIs exist", async () => {
    const workerPostMessage = vi.fn();
    const createdWorkers = [];
    class WorkerStub {
      constructor() {
        this.postMessage = workerPostMessage;
        this.terminate = vi.fn();
        createdWorkers.push(this);
      }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const { tracker } = setup({
      OffscreenCanvas: class {},
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() })),
    });

    try {
      await tracker.setTask({ active: true });

      expect(createdWorkers).toHaveLength(1);
      expect(workerPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "init", modeEpoch: 1 }),
        expect.any(Array),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
