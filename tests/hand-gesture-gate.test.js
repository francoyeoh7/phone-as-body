import { describe, expect, it } from "vitest";
import { HandGestureGate } from "../src/desktop/HandGestureGate.js";

const sample = (grabStrength, overrides = {}) => ({
  state: "tracked",
  fresh: true,
  trackingConfidence: 0.9,
  pose: { grabStrength, trackingConfidence: 0.9 },
  ...overrides,
});

describe("HandGestureGate", () => {
  it("emits one grab only after a stable candidate and rearms after release", () => {
    const gate = new HandGestureGate();

    expect(gate.update(sample(0.8), 0)).toBe(false);
    expect(gate.update(sample(0.8), 219)).toBe(false);
    expect(gate.update(sample(0.8), 220)).toBe(true);
    expect(gate.update(sample(0.9), 300)).toBe(false);

    expect(gate.update(sample(0.2), 320)).toBe(false);
    expect(gate.update(sample(0.2), 499)).toBe(false);
    expect(gate.update(sample(0.2), 500)).toBe(false);
    expect(gate.update(sample(0.8), 510)).toBe(false);
    expect(gate.update(sample(0.8), 729)).toBe(false);
    expect(gate.update(sample(0.8), 730)).toBe(true);
  });

  it("does not trigger from stale, lost, or low-confidence observations", () => {
    const gate = new HandGestureGate();

    expect(gate.update(sample(0.9, { fresh: false }), 0)).toBe(false);
    expect(gate.update(sample(0.9, { trackingConfidence: 0.4 }), 500)).toBe(false);
    expect(gate.update({ state: "lost", fresh: false, pose: null }, 1000)).toBe(false);
    expect(gate.update(sample(0.9), 1100)).toBe(false);
    expect(gate.update(sample(0.9), 1320)).toBe(true);
  });

  it("can require a release before accepting another task-bound hand", () => {
    const gate = new HandGestureGate();
    gate.reset({ requireRelease: true });

    expect(gate.update(sample(0.9), 0)).toBe(false);
    expect(gate.update(sample(0.9), 500)).toBe(false);
    expect(gate.update(sample(0.2), 510)).toBe(false);
    expect(gate.update(sample(0.2), 690)).toBe(false);
    expect(gate.update(sample(0.9), 700)).toBe(false);
    expect(gate.update(sample(0.9), 920)).toBe(true);
  });
});
