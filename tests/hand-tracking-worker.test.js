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
});
