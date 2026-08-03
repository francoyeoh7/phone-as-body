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
});
