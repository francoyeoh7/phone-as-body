import { describe, expect, it, vi } from "vitest";
import {
  adaptiveScoringOptions,
  CameraMotionDetector,
  measureFrameMotion,
  shouldTriggerMotion,
} from "../src/controller/CameraMotionDetector.js";

function frame(values) {
  return Uint8Array.from(values);
}

function rgbaFrame(grayscale) {
  const pixels = new Uint8ClampedArray(grayscale.length * 4);
  grayscale.forEach((value, index) => {
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  });
  return pixels;
}

function lowContrastRectangle(width, height, offsetX, offsetY) {
  const pixels = new Uint8Array(width * height).fill(112);
  for (let y = offsetY; y < offsetY + 12; y += 1) {
    for (let x = offsetX; x < offsetX + 12; x += 1) pixels[y * width + x] = 132;
  }
  return pixels;
}

function noisyQuietFrame(width, height, phase = 0) {
  return Uint8Array.from(
    { length: width * height },
    (_, index) => {
      let hash = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(phase + 1, 0x27d4eb2d);
      hash ^= hash >>> 16;
      return 112 + (((hash >>> 0) % 5) - 2);
    },
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function streamWithTrack(track = {}) {
  return {
    getTracks: () => [{
      getSettings: () => ({ facingMode: "environment" }),
      stop: vi.fn(),
      ...track,
    }],
  };
}

describe("camera motion scoring", () => {
  it("accepts a localized change that can represent an object entering the camera", () => {
    const metrics = measureFrameMotion(
      frame([0, 0, 0, 0, 0, 0, 0, 0]),
      frame([0, 0, 0, 255, 0, 0, 0, 255]),
      4,
      2,
    );

    expect(metrics.meanDifference).toBeCloseTo(0.25, 5);
    expect(metrics.activeRatio).toBeCloseTo(0.25, 5);
    expect(shouldTriggerMotion(metrics)).toBe(true);
  });

  it("accepts a small low-contrast object crossing the camera view", () => {
    const previous = new Uint8Array(32 * 24).fill(112);
    const current = previous.slice();
    for (let y = 9; y < 15; y += 1) {
      for (let x = 13; x < 19; x += 1) {
        current[y * 32 + x] = 140;
      }
    }

    const metrics = measureFrameMotion(previous, current, 32, 24);

    expect(metrics.activeRatio).toBeCloseTo(36 / (32 * 24), 5);
    expect(metrics.meanDifference).toBeGreaterThan(0.004);
    expect(shouldTriggerMotion(metrics)).toBe(true);
  });

  it("rejects a global change that is more likely to be camera movement", () => {
    const metrics = measureFrameMotion(
      frame([0, 0, 0, 0, 0, 0, 0, 0]),
      frame([255, 255, 255, 255, 255, 255, 255, 255]),
      4,
      2,
    );

    expect(metrics.activeRatio).toBe(1);
    expect(shouldTriggerMotion(metrics)).toBe(false);
  });

  it("rejects small sensor and compression noise", () => {
    const metrics = measureFrameMotion(
      frame([100, 100, 100, 100]),
      frame([103, 98, 102, 101]),
      2,
      2,
    );

    expect(shouldTriggerMotion(metrics)).toBe(false);
  });

  it("rejects scattered pixel changes that do not form a passing object", () => {
    const previous = new Uint8Array(32 * 24).fill(112);
    const current = previous.slice();
    for (let index = 0; index < current.length; index += 10) current[index] = 140;

    const metrics = measureFrameMotion(previous, current, 32, 24);

    expect(metrics.meanDifference).toBeGreaterThan(0.004);
    expect(metrics.activeRatio).toBeGreaterThan(0.02);
    expect(metrics.largestActiveRatio).toBeLessThan(0.004);
    expect(shouldTriggerMotion(metrics)).toBe(false);
  });
});

describe("camera motion detector", () => {
  it("uses a 96 by 72 production sample by default", async () => {
    const createCaptureElements = vi.fn(() => null);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack()) },
      createCaptureElements,
    });

    await detector.start();

    expect(createCaptureElements).toHaveBeenCalledExactlyOnceWith(96, 72);
    expect(detector.sampleWidth).toBe(96);
    expect(detector.sampleHeight).toBe(72);
  });

  it("prefers the rear camera and falls back to any camera", async () => {
    const stream = { getTracks: () => [{ getSettings: () => ({ facingMode: "user" }) }] };
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new Error("rear unavailable"))
      .mockResolvedValueOnce(stream);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia },
      createCaptureElements: () => null,
    });

    await expect(detector.start()).resolves.toMatchObject({ cameraGranted: true, facingMode: "user" });
    expect(getUserMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({
      video: expect.objectContaining({ facingMode: { ideal: "environment" } }),
    }));
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: true });
  });

  it("uses a 150 ms history reference and rearms at exactly 500 ms", async () => {
    const onPulse = vi.fn();
    const detector = new CameraMotionDetector({
      onPulse,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const changeA = lowContrastRectangle(96, 72, 10, 18);
    const changeB = lowContrastRectangle(96, 72, 38, 18);
    const changeC = lowContrastRectangle(96, 72, 66, 18);

    await detector.start();
    detector.setFocused(true);

    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(changeA, 96, 72, 200);
    detector.ingestFrame(changeB, 96, 72, 699);
    detector.ingestFrame(changeC, 96, 72, 700);

    expect(onPulse).toHaveBeenCalledTimes(2);
    expect(onPulse.mock.calls[0][0].timestamp).toBe(200);
    expect(onPulse.mock.calls[0][0].referenceTimestamp).toBe(50);
    expect(onPulse.mock.calls[1][0].timestamp).toBe(700);
    expect(onPulse.mock.calls[1][0].referenceTimestamp).toBe(200);
  });

  it("does not learn qualifying cooldown motion as camera noise", async () => {
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const changeA = lowContrastRectangle(96, 72, 10, 18);
    const changeB = lowContrastRectangle(96, 72, 38, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(changeA, 96, 72, 200);
    detector.ingestFrame(changeB, 96, 72, 250);

    expect(detector.noiseMean).toBe(0);
  });

  it("applies explicit scoring overrides without replacing adaptive defaults", async () => {
    async function detect(change) {
      const onPulse = vi.fn();
      const detector = new CameraMotionDetector({
        onPulse,
        scoringOptions: { maxActiveRatio: 0.03 },
        mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
        createCaptureElements: () => null,
      });
      const quiet = new Uint8Array(96 * 72).fill(112);

      await detector.start();
      detector.setFocused(true);
      detector.ingestFrame(quiet, 96, 72, 0);
      detector.ingestFrame(quiet, 96, 72, 50);
      detector.ingestFrame(quiet, 96, 72, 100);
      detector.ingestFrame(quiet, 96, 72, 150);
      detector.ingestFrame(change, 96, 72, 200);
      return onPulse;
    }

    const broadChange = new Uint8Array(96 * 72).fill(112);
    for (let y = 18; y < 34; y += 1) {
      for (let x = 30; x < 46; x += 1) broadChange[y * 96 + x] = 132;
    }

    expect(await detect(broadChange)).not.toHaveBeenCalled();
    expect(await detect(lowContrastRectangle(96, 72, 30, 18))).toHaveBeenCalledOnce();
  });

  it("honors an explicit maximum mean difference", async () => {
    const onPulse = vi.fn();
    const detector = new CameraMotionDetector({
      onPulse,
      scoringOptions: { maxMeanDifference: 0.001 },
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(lowContrastRectangle(96, 72, 30, 18), 96, 72, 200);

    expect(onPulse).not.toHaveBeenCalled();
  });

  it("calibrates a fresh presence baseline and emits only transitions", async () => {
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "fresh" });
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(quiet, 96, 72, 200);
    detector.ingestFrame(quiet, 96, 72, 250);
    detector.ingestFrame(hand, 96, 72, 300);
    detector.ingestFrame(hand, 96, 72, 350);
    detector.ingestFrame(quiet, 96, 72, 400);

    expect(onPresence).toHaveBeenCalledTimes(2);
    expect(onPresence).toHaveBeenNthCalledWith(1, expect.objectContaining({ ready: true, active: true, context: "door-defense" }));
    expect(onPresence).toHaveBeenNthCalledWith(2, expect.objectContaining({ ready: true, active: false, context: "door-defense" }));
  });

  it("calibrates fresh presence through ordinary low-level camera noise", async () => {
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "fresh" });
    for (let index = 0; index < 8; index += 1) {
      detector.ingestFrame(noisyQuietFrame(96, 72, index), 96, 72, index * 50);
    }
    detector.ingestFrame(hand, 96, 72, 400);

    expect(onPresence).toHaveBeenCalledWith(expect.objectContaining({
      ready: true,
      active: true,
      context: "door-defense",
      timestamp: 400,
    }));
  });

  it("waits for three stable history comparisons before freezing a fresh baseline", async () => {
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const movingFrames = [
      lowContrastRectangle(96, 72, 4, 18),
      lowContrastRectangle(96, 72, 20, 18),
      lowContrastRectangle(96, 72, 36, 18),
      lowContrastRectangle(96, 72, 52, 18),
      lowContrastRectangle(96, 72, 68, 18),
      lowContrastRectangle(96, 72, 80, 18),
    ];
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "fresh" });
    movingFrames.forEach((movingFrame, index) => {
      detector.ingestFrame(movingFrame, 96, 72, index * 50);
    });
    detector.ingestFrame(quiet, 96, 72, 300);
    detector.ingestFrame(quiet, 96, 72, 350);
    detector.ingestFrame(quiet, 96, 72, 400);
    detector.ingestFrame(quiet, 96, 72, 450);
    detector.ingestFrame(quiet, 96, 72, 500);
    detector.ingestFrame(quiet, 96, 72, 550);

    expect(onPresence).not.toHaveBeenCalled();

    detector.ingestFrame(hand, 96, 72, 600);

    expect(onPresence).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ready: true,
      active: true,
      context: "door-defense",
      timestamp: 600,
    }));
  });

  it("uses a retained baseline for the first presence sample after a pulse", async () => {
    const onPulse = vi.fn();
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPulse,
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(hand, 96, 72, 200);
    detector.setMode({ mode: "presence", context: "found-phone", baseline: "retained" });
    detector.ingestFrame(hand, 96, 72, 250);

    expect(onPulse).toHaveBeenCalledTimes(1);
    expect(onPresence).toHaveBeenCalledWith(expect.objectContaining({
      ready: true,
      active: true,
      context: "found-phone",
    }));
  });

  it("keeps sampling retained presence after pulse focus is released", async () => {
    const onPulse = vi.fn();
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPulse,
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack()) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(hand, 96, 72, 200);
    detector.setFocused(false);
    detector.setMode({ mode: "presence", context: "found-phone", baseline: "retained" });
    detector.ingestFrame(hand, 96, 72, 250);
    detector.ingestFrame(quiet, 96, 72, 300);

    expect(onPulse).toHaveBeenCalledOnce();
    expect(onPresence.mock.calls.map(([event]) => ({ active: event.active, context: event.context }))).toEqual([
      { active: true, context: "found-phone" },
      { active: false, context: "found-phone" },
    ]);
  });

  it("repeats unchanged presence every 250 ms so a lost state cannot lock a scene", async () => {
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack()) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "retained" });
    detector.ingestFrame(hand, 96, 72, 200);
    detector.ingestFrame(hand, 96, 72, 400);
    detector.ingestFrame(hand, 96, 72, 450);

    expect(onPresence.mock.calls.map(([event]) => ({
      active: event.active,
      context: event.context,
      timestamp: event.timestamp,
    }))).toEqual([
      { active: true, context: "door-defense", timestamp: 200 },
      { active: true, context: "door-defense", timestamp: 450 },
    ]);
  });

  it("preserves the exact 500 ms pulse cooldown across focus changes", async () => {
    const onPulse = vi.fn();
    const detector = new CameraMotionDetector({
      onPulse,
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack()) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const changeA = lowContrastRectangle(96, 72, 10, 18);
    const changeB = lowContrastRectangle(96, 72, 38, 18);
    const changeC = lowContrastRectangle(96, 72, 66, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.ingestFrame(quiet, 96, 72, 50);
    detector.ingestFrame(quiet, 96, 72, 100);
    detector.ingestFrame(quiet, 96, 72, 150);
    detector.ingestFrame(changeA, 96, 72, 200);
    detector.setFocused(false);
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 250);
    detector.ingestFrame(quiet, 96, 72, 300);
    detector.ingestFrame(quiet, 96, 72, 350);
    detector.ingestFrame(quiet, 96, 72, 400);
    detector.ingestFrame(quiet, 96, 72, 450);
    detector.ingestFrame(quiet, 96, 72, 500);
    detector.ingestFrame(quiet, 96, 72, 550);
    detector.ingestFrame(changeB, 96, 72, 699);
    detector.ingestFrame(changeC, 96, 72, 700);

    expect(onPulse.mock.calls.map(([event]) => event.timestamp)).toEqual([200, 700]);
  });

  it.each([
    ["preferred camera request", false],
    ["fallback camera request", true],
  ])("disposes a stream that resolves after destroy during the %s", async (_label, useFallback) => {
    const pending = deferred();
    const track = { stop: vi.fn() };
    const stream = streamWithTrack(track);
    const getUserMedia = useFallback
      ? vi.fn().mockRejectedValueOnce(new Error("rear unavailable")).mockReturnValueOnce(pending.promise)
      : vi.fn().mockReturnValueOnce(pending.promise);
    const createCaptureElements = vi.fn(() => null);
    const requestFrame = vi.fn(() => 1);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia },
      createCaptureElements,
      requestFrame,
    });

    const startResult = detector.start();
    if (useFallback) await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    detector.destroy();
    pending.resolve(stream);

    await expect(startResult).resolves.toEqual({ cameraGranted: false });
    expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(createCaptureElements).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(detector.stream).toBeNull();
    expect(detector.capture).toBeNull();
    expect(detector.started).toBe(false);
    expect(detector.cameraGranted).toBe(false);
  });

  it("forces active presence false exactly once when suspended", async () => {
    const onPresence = vi.fn();
    const detector = new CameraMotionDetector({
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack()) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "retained" });
    detector.ingestFrame(hand, 96, 72, 200);
    detector.suspend();
    detector.suspend();

    expect(onPresence.mock.calls.map(([event]) => ({ active: event.active, context: event.context }))).toEqual([
      { active: true, context: "door-defense" },
      { active: false, context: "door-defense" },
    ]);
  });

  it("forces active presence false when the camera track ends", async () => {
    const onPresence = vi.fn();
    let endedListener = null;
    const removeEventListener = vi.fn();
    const track = {
      addEventListener: vi.fn((name, listener) => {
        if (name === "ended") endedListener = listener;
      }),
      removeEventListener,
    };
    const detector = new CameraMotionDetector({
      onPresence,
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack(track)) },
      createCaptureElements: () => null,
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "retained" });
    detector.ingestFrame(hand, 96, 72, 200);
    expect(endedListener).toBeTypeOf("function");
    endedListener();

    expect(onPresence).toHaveBeenLastCalledWith(expect.objectContaining({
      active: false,
      context: "door-defense",
    }));
    expect(removeEventListener).toHaveBeenCalledWith("ended", endedListener);
  });

  it.each(["draw", "read"])("forces active presence false after a capture %s exception", async (failurePoint) => {
    const onPresence = vi.fn();
    const context = {
      drawImage: vi.fn(() => {
        if (failurePoint === "draw") throw new Error("draw failed");
      }),
      getImageData: vi.fn(() => {
        if (failurePoint === "read") throw new Error("read failed");
        return { data: rgbaFrame(new Uint8Array(96 * 72).fill(112)) };
      }),
    };
    const capture = {
      video: { readyState: 2, play: vi.fn(), pause: vi.fn(), remove: vi.fn() },
      context,
    };
    const detector = new CameraMotionDetector({
      onPresence,
      now: () => 250,
      mediaDevices: { getUserMedia: vi.fn(async () => streamWithTrack()) },
      createCaptureElements: () => capture,
      requestFrame: vi.fn(() => 1),
    });
    const quiet = new Uint8Array(96 * 72).fill(112);
    const hand = lowContrastRectangle(96, 72, 30, 18);

    await detector.start();
    detector.setFocused(true);
    detector.ingestFrame(quiet, 96, 72, 0);
    detector.setMode({ mode: "presence", context: "door-defense", baseline: "retained" });
    detector.ingestFrame(hand, 96, 72, 200);

    expect(() => detector.captureFrame()).not.toThrow();
    detector.captureFrame();

    expect(onPresence.mock.calls.map(([event]) => event.active)).toEqual([true, false]);
  });

  it("shares one in-flight camera startup across concurrent callers", async () => {
    const pending = deferred();
    const stream = streamWithTrack();
    const getUserMedia = vi.fn(() => pending.promise);
    const createCaptureElements = vi.fn(() => null);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia },
      createCaptureElements,
    });

    const first = detector.start();
    const second = detector.start();
    pending.resolve(stream);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { cameraGranted: true, facingMode: "environment" },
      { cameraGranted: true, facingMode: "environment" },
    ]);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(createCaptureElements).toHaveBeenCalledOnce();
  });

  it("fully releases the camera after capture failure", async () => {
    const track = { stop: vi.fn() };
    const stream = streamWithTrack(track);
    const capture = {
      video: { readyState: 2, play: vi.fn(), pause: vi.fn(), remove: vi.fn() },
      context: {
        drawImage: vi.fn(() => { throw new Error("capture failed"); }),
        getImageData: vi.fn(),
      },
    };
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
      createCaptureElements: () => capture,
      requestFrame: vi.fn(() => 4),
    });

    await detector.start();
    detector.captureFrame();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(capture.video.pause).toHaveBeenCalledOnce();
    expect(capture.video.remove).toHaveBeenCalledOnce();
    expect(detector.stream).toBeNull();
    expect(detector.capture).toBeNull();
    expect(detector.started).toBe(false);
    expect(detector.cameraGranted).toBe(false);
  });

  it("rejects startup and releases the stream when video playback cannot start", async () => {
    const track = { stop: vi.fn() };
    const stream = streamWithTrack(track);
    const capture = {
      video: {
        play: vi.fn(async () => { throw new Error("playback blocked"); }),
        pause: vi.fn(),
        remove: vi.fn(),
      },
      context: {},
    };
    const requestFrame = vi.fn(() => 3);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
      createCaptureElements: () => capture,
      requestFrame,
    });

    await expect(detector.start()).resolves.toEqual({ cameraGranted: false });

    expect(track.stop).toHaveBeenCalledOnce();
    expect(capture.video.remove).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(detector.stream).toBeNull();
    expect(detector.capture).toBeNull();
  });

  it("resumes sampling with a fresh capture after a camera track ends", async () => {
    let endedListener = null;
    const firstTrack = {
      addEventListener: vi.fn((_type, listener) => { endedListener = listener; }),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const secondTrack = { stop: vi.fn() };
    const streams = [streamWithTrack(firstTrack), streamWithTrack(secondTrack)];
    const captures = [
      { video: { play: vi.fn(), pause: vi.fn(), remove: vi.fn() }, context: {} },
      { video: { play: vi.fn(), pause: vi.fn(), remove: vi.fn() }, context: {} },
    ];
    const requestFrame = vi.fn()
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValueOnce(streams[0]).mockResolvedValueOnce(streams[1]) },
      createCaptureElements: vi.fn().mockReturnValueOnce(captures[0]).mockReturnValueOnce(captures[1]),
      requestFrame,
      cancelFrame: vi.fn(),
    });

    await detector.start();
    endedListener();
    await detector.start();

    expect(captures[0].video.remove).toHaveBeenCalledOnce();
    expect(detector.capture).toBe(captures[1]);
    expect(detector.suspended).toBe(false);
    expect(detector.started).toBe(true);
    expect(detector.cameraGranted).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect ready state when a track ends during pending playback", async () => {
    const playback = deferred();
    let endedListener = null;
    const track = {
      addEventListener: vi.fn((_type, listener) => { endedListener = listener; }),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const stream = streamWithTrack(track);
    const capture = {
      video: { play: vi.fn(() => playback.promise), pause: vi.fn(), remove: vi.fn() },
      context: {},
    };
    const onState = vi.fn();
    const requestFrame = vi.fn(() => 1);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
      createCaptureElements: () => capture,
      onState,
      requestFrame,
    });

    const starting = detector.start();
    await vi.waitFor(() => expect(endedListener).toBeTypeOf("function"));
    endedListener();
    playback.resolve();

    await expect(starting).resolves.toEqual({ cameraGranted: false });
    expect(onState.mock.calls.map(([state]) => state)).toEqual(["ended"]);
    expect(detector.stream).toBeNull();
    expect(detector.capture).toBeNull();
    expect(detector.started).toBe(false);
    expect(detector.cameraGranted).toBe(false);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("keeps a late camera acquisition suspended until explicitly resumed", async () => {
    const pending = deferred();
    const stream = streamWithTrack();
    const capture = { video: { play: vi.fn(), pause: vi.fn(), remove: vi.fn() }, context: {} };
    const requestFrame = vi.fn(() => 7);
    const detector = new CameraMotionDetector({
      mediaDevices: { getUserMedia: vi.fn(() => pending.promise) },
      createCaptureElements: () => capture,
      requestFrame,
    });

    const starting = detector.start();
    detector.suspend();
    pending.resolve(stream);
    await expect(starting).resolves.toEqual({ cameraGranted: true, facingMode: "environment" });

    expect(detector.suspended).toBe(true);
    expect(requestFrame).not.toHaveBeenCalled();

    expect(detector.resume()).toBe(true);
    expect(detector.suspended).toBe(false);
    expect(requestFrame).toHaveBeenCalledOnce();
  });
});
