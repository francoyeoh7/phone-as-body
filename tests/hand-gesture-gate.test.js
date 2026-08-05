import { describe, expect, it } from "vitest";
import { HandGestureGate } from "../src/desktop/HandGestureGate.js";

const sample = (grabStrength, seq, overrides = {}) => ({
  state: "tracked",
  fresh: true,
  modeEpoch: 1,
  seq,
  trackingConfidence: 0.9,
  pose: { grabStrength, trackingConfidence: 0.9, modeEpoch: 1, seq },
  ...overrides,
});

describe("HandGestureGate", () => {
  it("emits one grab only after a stable candidate and rearms after release", () => {
    const gate = new HandGestureGate();

    expect(gate.update(sample(0.8, 0), 0)).toBe(false);
    expect(gate.update(sample(0.8, 1), 219)).toBe(false);
    expect(gate.update(sample(0.8, 2), 220)).toBe(true);
    expect(gate.update(sample(0.9, 3), 300)).toBe(false);

    expect(gate.update(sample(0.2, 4), 320)).toBe(false);
    expect(gate.update(sample(0.2, 5), 499)).toBe(false);
    expect(gate.update(sample(0.2, 6), 500)).toBe(false);
    expect(gate.update(sample(0.8, 7), 510)).toBe(false);
    expect(gate.update(sample(0.8, 8), 729)).toBe(false);
    expect(gate.update(sample(0.8, 9), 730)).toBe(true);
  });

  it("never turns one repeated frame into a sustained grab", () => {
    const gate = new HandGestureGate();
    const frozen = sample(0.95, 4);

    expect(gate.update(frozen, 0)).toBe(false);
    expect(gate.update(frozen, 100)).toBe(false);
    expect(gate.update(frozen, 221)).toBe(false);
    expect(gate.update(sample(0.95, 5), 230)).toBe(false);
    expect(gate.update(sample(0.95, 6), 300)).toBe(true);
  });

  it("does not trigger from stale, lost, or low-confidence observations", () => {
    const gate = new HandGestureGate();

    expect(gate.update(sample(0.9, 0, { fresh: false }), 0)).toBe(false);
    expect(gate.update(sample(0.9, 1, { trackingConfidence: 0.4 }), 500)).toBe(false);
    expect(gate.update({ state: "lost", fresh: false, pose: null }, 1000)).toBe(false);
    expect(gate.update(sample(0.9, 2), 1100)).toBe(false);
    expect(gate.update(sample(0.9, 3), 1210)).toBe(false);
    expect(gate.update(sample(0.9, 4), 1320)).toBe(true);
  });

  it("can require a release before accepting another task-bound hand", () => {
    const gate = new HandGestureGate();
    gate.reset({ requireRelease: true });

    expect(gate.update(sample(0.9, 0), 0)).toBe(false);
    expect(gate.update(sample(0.9, 1), 500)).toBe(false);
    expect(gate.update(sample(0.2, 2), 510)).toBe(false);
    expect(gate.update(sample(0.2, 3), 690)).toBe(false);
    expect(gate.update(sample(0.9, 4), 700)).toBe(false);
    expect(gate.update(sample(0.9, 5), 810)).toBe(false);
    expect(gate.update(sample(0.9, 6), 920)).toBe(true);
  });
});
