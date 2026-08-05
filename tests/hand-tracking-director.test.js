import { describe, expect, it, vi } from "vitest";
import { HandTrackingDirector } from "../src/desktop/HandTrackingDirector.js";
import { PhoneSession } from "../src/desktop/PhoneSession.js";

function frame(overrides = {}) {
  return {
    modeEpoch: 1,
    seq: 0,
    state: "tracked",
    trackingConfidence: 0.95,
    handConfidence: 0.95,
    handedness: "right",
    openness: 0.9,
    palmFacing: 0.9,
    grabStrength: 0.9,
    velocity: 0,
    ...overrides,
  };
}

describe("HandTrackingDirector", () => {
  it("owns one context and emits exactly-once task lifecycle events", () => {
    let now = 0;
    const hand = { fallback: false, load: vi.fn(async () => true), setContext: vi.fn(), setVisible: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const send = vi.fn();
    const director = new HandTrackingDirector({ hand, now: () => now, sendControllerEvent: send });
    expect(director.beginTask({ context: "found-phone", requiredAction: "grab" })).toBe(true);
    expect(director.beginTask({ context: "door-defense", requiredAction: "brace" })).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: "hand-task", active: true, context: "found-phone" });
    director.acceptFrame(frame({ receivedAt: 10 }));
    now = 1000;
    director.update(1);
    expect(director.snapshot("found-phone")).toEqual(expect.objectContaining({ context: "found-phone" }));
    expect(director.endTask("found-phone")).toBe(true);
    expect(director.endTask("found-phone")).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: "hand-task", active: false, context: "found-phone" });
  });

  it("enters fallback after 1.5 seconds without accepted frames", () => {
    let now = 0;
    const director = new HandTrackingDirector({ hand: { fallback: false, setContext() {}, setVisible() {}, applyPose() {}, destroy() {} }, now: () => now, sendControllerEvent: vi.fn() });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    now = 1499;
    director.update(1.499);
    expect(director.usesFallback("door-defense")).toBe(false);
    now = 1500;
    director.update(0.001);
    expect(director.usesFallback("door-defense")).toBe(true);
  });

  it("enters fallback after the stream goes silent following an accepted frame", () => {
    let now = 0;
    const director = new HandTrackingDirector({
      hand: { fallback: false, setContext() {}, setVisible() {}, applyPose() {}, destroy() {} },
      now: () => now,
      sendControllerEvent: vi.fn(),
    });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    expect(director.acceptFrame(frame({ receivedAt: 0 }))).toBe(true);

    now = 1499;
    director.update(1.499);
    expect(director.usesFallback("door-defense")).toBe(false);

    now = 1500;
    director.update(0.001);
    expect(director.usesFallback("door-defense")).toBe(true);
  });

  it("exposes whether the latest sampled held observation is fresh", () => {
    let now = 0;
    const director = new HandTrackingDirector({
      hand: { fallback: false, setContext() {}, setVisible() {}, applyPose() {}, destroy() {} },
      now: () => now,
      sendControllerEvent: vi.fn(),
    });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    expect(director.acceptFrame(frame({ seq: 0, receivedAt: 0 }))).toBe(true);
    director.update(0);
    expect(director.snapshot("door-defense").fresh).toBe(true);

    now = 1;
    expect(director.acceptFrame(frame({ seq: 1, receivedAt: 1, trackingConfidence: 0.4 }))).toBe(true);
    director.update(0);
    expect(director.snapshot("door-defense").fresh).toBe(false);
  });

  it("accepts sequence zero when the handset starts a newer mode epoch", () => {
    const session = new PhoneSession();
    const hand = vi.fn();
    session.addEventListener("hand", ({ detail }) => hand(detail));
    const status = (modeEpoch, seq) => ({ version: 1, modeEpoch, seq, capturedAt: 1, state: "lost" });
    expect(session.acceptHandFrame(status(1, 4))).toBe(true);
    expect(session.acceptHandFrame(status(2, 0))).toBe(true);
    expect(hand).toHaveBeenCalledTimes(2);
  });
});
