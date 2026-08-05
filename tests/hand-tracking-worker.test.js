import { describe, expect, it, vi } from "vitest";
import { createWorkerHandler } from "../src/controller/hand-tracking.worker.js";

describe("hand tracking worker initialization", () => {
  it("retries GPU with CPU using a fresh canvas and emits unavailable once per epoch", async () => {
    const canvases = [];
    class TestCanvas { constructor() { canvases.push(this); } }
    const createFromOptions = vi.fn()
      .mockRejectedValueOnce(new Error("gpu"))
      .mockRejectedValueOnce(new Error("cpu"))
      .mockRejectedValueOnce(new Error("gpu"))
      .mockRejectedValueOnce(new Error("cpu"));
    const messages = [];
    const handler = createWorkerHandler({
      FilesetResolverImpl: { forVisionTasks: vi.fn(async () => ({})) },
      HandLandmarkerImpl: { createFromOptions },
      OffscreenCanvasCtor: TestCanvas,
      postMessage: (message) => messages.push(message),
    });
    const firstCanvas = new TestCanvas();

    await handler({ data: { type: "init", modeEpoch: 4, canvas: firstCanvas } });
    await handler({ data: { type: "init", modeEpoch: 4, canvas: firstCanvas } });

    expect(createFromOptions).toHaveBeenCalledTimes(4);
    expect(createFromOptions.mock.calls[0][1]).toEqual(expect.objectContaining({ baseOptions: expect.objectContaining({ delegate: "GPU" }), canvas: firstCanvas }));
    expect(createFromOptions.mock.calls[1][1]).toEqual(expect.objectContaining({ baseOptions: expect.not.objectContaining({ delegate: "GPU" }), canvas: canvases[1] }));
    expect(messages.filter(({ type }) => type === "unavailable")).toHaveLength(1);
  });

  it("does not let an older async init overwrite a newer epoch", async () => {
    const pending = [];
    const tasks = [];
    const createFromOptions = vi.fn(() => {
      const deferred = {};
      deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
      });
      pending.push(deferred);
      return deferred.promise;
    });
    const messages = [];
    const handler = createWorkerHandler({
      FilesetResolverImpl: { forVisionTasks: vi.fn(async () => ({})) },
      HandLandmarkerImpl: { createFromOptions },
      OffscreenCanvasCtor: class {},
      postMessage: (message) => messages.push(message),
    });

    const firstInit = handler({ data: { type: "init", modeEpoch: 1, canvas: {} } });
    await Promise.resolve();
    const secondInit = handler({ data: { type: "init", modeEpoch: 2, canvas: {} } });
    await Promise.resolve();

    const secondTask = { close: vi.fn(), detectForVideo: vi.fn() };
    tasks.push(secondTask);
    pending[1].resolve(secondTask);
    await secondInit;
    const firstTask = { close: vi.fn(), detectForVideo: vi.fn() };
    tasks.push(firstTask);
    pending[0].resolve(firstTask);
    await firstInit;

    expect(messages.filter(({ type }) => type === "ready").map(({ modeEpoch }) => modeEpoch)).toEqual([2]);
    expect(firstTask.close).toHaveBeenCalledOnce();
    expect(tasks).toHaveLength(2);
  });

  it("closes a transferred bitmap when detection arrives before a landmarker", async () => {
    const bitmap = { close: vi.fn() };
    const postMessage = vi.fn();
    const handler = createWorkerHandler({ postMessage });

    await handler({ data: { type: "detect", modeEpoch: 1, capturedAt: 10, bitmap } });

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
