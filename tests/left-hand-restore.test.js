import { describe, expect, it, vi } from "vitest";
import { MediaPipeHandTracker } from "../src/controller/MediaPipeHandTracker.js";
import { ControllerSocket } from "../src/controller/ControllerSocket.js";
import { HandTrackingDirector } from "../src/desktop/HandTrackingDirector.js";
import { EVENTS, isHandFrame } from "../src/shared/protocol.js";
import { openHand } from "./fixtures/hand-landmarks.js";

function trackerSetup(options = {}) {
  const video = {
    readyState: 2,
    videoWidth: 320,
    videoHeight: 240,
    srcObject: { getTracks: () => [{ getSettings: () => ({ facingMode: "environment" }) }] },
  };
  const callbacks = { onFrame: vi.fn(), onState: vi.fn() };
  const tracker = new MediaPipeHandTracker({
    getVideo: () => video,
    scheduler: { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), now: vi.fn(() => 20) },
    ...callbacks,
    ...options,
  });
  tracker.active = true;
  tracker.modeEpoch = 1;
  return { tracker, callbacks };
}

function trackedPose(center) {
  return {
    state: "tracked",
    fresh: true,
    trackingConfidence: 0.95,
    opacity: 1,
    handedness: "left",
    center,
  };
}

describe("rewritten left-hand camera contract", () => {
  it("uses the verified rear-camera label convention by default", () => {
    const { tracker, callbacks } = trackerSetup();
    const sample = openHand({ physicalHandedness: "left", inputMirrored: true });
    const result = {
      landmarks: [sample.landmarks],
      worldLandmarks: [sample.worldLandmarks],
      handedness: [[{ categoryName: sample.handedness, score: 0.96 }]],
    };

    tracker.handleResult({ result, capturedAt: 20 });

    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({
      state: "tracked",
      handedness: "left",
      inputMirrored: true,
    }));
    expect(isHandFrame(callbacks.onFrame.mock.calls[0][0])).toBe(true);
  });

  it("accepts an explicitly configured verified rear-camera stream", () => {
    const { tracker, callbacks } = trackerSetup({ inputMirrored: true });
    const sample = openHand({ physicalHandedness: "left", inputMirrored: true });
    const result = {
      landmarks: [sample.landmarks],
      worldLandmarks: [sample.worldLandmarks],
      handedness: [[{ categoryName: sample.handedness, score: 0.96 }]],
    };

    tracker.handleResult({ result, capturedAt: 20 });

    expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({
      state: "tracked",
      handedness: "left",
      inputMirrored: true,
    }));
  });

  it("rejects the physical right hand before acquisition", () => {
    const { tracker, callbacks } = trackerSetup({ inputMirrored: true });
    const sample = openHand({ physicalHandedness: "right", inputMirrored: true });
    const result = {
      landmarks: [sample.landmarks],
      worldLandmarks: [sample.worldLandmarks],
      handedness: [[{ categoryName: sample.handedness, score: 0.96 }]],
    };

    tracker.handleResult({ result, capturedAt: 20 });

    expect(callbacks.onFrame).not.toHaveBeenCalledWith(expect.objectContaining({
      state: "tracked",
    }));
  });

  it("sends tracked hand state over the RTC hand channel with a socket fallback", () => {
    const { tracker, callbacks } = trackerSetup();
    const sample = openHand({ physicalHandedness: "left", inputMirrored: true });
    tracker.handleResult({
      result: {
        landmarks: [sample.landmarks],
        worldLandmarks: [sample.worldLandmarks],
        handedness: [[{ categoryName: sample.handedness, score: 0.96 }]],
      },
      capturedAt: 20,
    });
    const frame = callbacks.onFrame.mock.calls[0][0];
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    socket.handChannel = { readyState: "open", bufferedAmount: 0, send: vi.fn() };

    expect(socket.sendHandFrame(frame)).toBe(true);
    expect(socket.handChannel.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.handChannel.send.mock.calls[0][0]))
      .toEqual(JSON.parse(JSON.stringify({ type: "hand", payload: frame })));
    expect(socket.socket.emit).not.toHaveBeenCalledWith(EVENTS.controllerHand, frame);

    socket.handChannel = { readyState: "open", bufferedAmount: 32_768, send: vi.fn() };
    expect(socket.sendHandFrame(frame)).toBe(true);
    expect(socket.handChannel.send).not.toHaveBeenCalled();
    expect(socket.socket.emit).toHaveBeenCalledWith(EVENTS.controllerHand, frame);
  });

  it("lets a fresh tracked pose replace a stale cinematic pose", () => {
    const stale = trackedPose([0.1, 0.9, 0]);
    const fresh = trackedPose([0.8, 0.4, 0]);
    const hand = {
      fallback: false,
      setVisible: vi.fn(),
      applyPose: vi.fn(),
      setHolding: vi.fn(),
      destroy: vi.fn(),
    };
    const stream = {
      accept: vi.fn(() => true),
      sample: vi.fn(() => ({ state: "tracked", fresh: true, pose: fresh, gesturePose: fresh, opacity: 1 })),
    };
    const director = new HandTrackingDirector({ hand, stream, now: () => 100 });

    director.setCinematicPose?.(stale);
    director.update(1 / 60);

    expect(hand.applyPose).toHaveBeenCalledWith(expect.objectContaining({ center: [0.8, 0.4, 0] }), 1 / 60);
  });
});
