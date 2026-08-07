import { describe, expect, it } from "vitest";
import { HandGestureGate } from "../src/desktop/HandGestureGate.js";

const target = (id = "faucet", focusedAt = 0) => ({ id, focused: true, focusedAt });

const sample = (strength, seq, overrides = {}) => {
  const basePose = {
    handedness: "left",
    grabStrength: strength,
    pinchStrength: strength,
    reachEligible: true,
    trackingConfidence: 0.9,
    modeEpoch: 1,
    seq,
  };
  return {
    state: "tracked",
    fresh: true,
    modeEpoch: 1,
    seq,
    trackingConfidence: 0.9,
    ...overrides,
    pose: overrides.pose ?? basePose,
    gesturePose: overrides.gesturePose ?? overrides.pose ?? basePose,
  };
};

describe("HandGestureGate", () => {
  it("requires 100ms of stable target focus and a reach-eligible three-frame grab", () => {
    const gate = new HandGestureGate();
    const focused = target("faucet", 50);

    expect(gate.update(sample(0.8, 0), 100, focused)).toBe(false);
    expect(gate.update(sample(0.8, 1), 150, focused)).toBe(false);
    expect(gate.update(sample(0.8, 2), 230, focused)).toBe(false);
    expect(gate.update(sample(0.8, 3), 310, focused)).toBe(true);
  });

  it("rejects upper-frame reach state and stale or low-confidence observations", () => {
    const focused = target();
    const withoutTarget = new HandGestureGate();
    const withoutReach = new HandGestureGate();

    for (const now of [100, 180, 260, 320]) {
      expect(withoutTarget.update(sample(0.9, now), now, null)).toBe(false);
      expect(withoutReach.update(sample(0.9, now, { pose: { ...sample(0.9, now).pose, reachEligible: false } }), now, focused)).toBe(false);
    }
    expect(withoutReach.update(sample(0.9, 5, { fresh: false }), 400, focused)).toBe(false);
    expect(withoutReach.update(sample(0.9, 6, { trackingConfidence: 0.4 }), 500, focused)).toBe(false);
    expect(withoutReach.update({ state: "lost", fresh: false, pose: null }, 600, focused)).toBe(false);
  });

  it("resets and requires release when a focused target changes", () => {
    const gate = new HandGestureGate();
    const first = target("faucet");
    const second = target("washbasin", 260);

    gate.update(sample(0.8, 0), 100, first);
    gate.update(sample(0.8, 1), 180, first);
    expect(gate.update(sample(0.8, 2), 260, first)).toBe(true);

    expect(gate.update(sample(0.8, 3), 360, second)).toBe(false);
    expect(gate.update(sample(0.2, 4), 400, second)).toBe(false);
    expect(gate.update(sample(0.2, 5), 580, second)).toBe(false);
    expect(gate.update(sample(0.8, 6), 600, second)).toBe(false);
    expect(gate.update(sample(0.8, 7), 680, second)).toBe(false);
    expect(gate.update(sample(0.8, 8), 760, second)).toBe(false);
    expect(gate.update(sample(0.8, 9), 840, second)).toBe(true);
  });

  it("uses pinch strength with grab strength and preserves the 500ms cooldown", () => {
    const gate = new HandGestureGate();
    const focused = target();
    const pinchOnly = (seq) => sample(0.2, seq, { pose: { ...sample(0.2, seq).pose, pinchStrength: 0.8 } });

    expect(gate.update(pinchOnly(0), 100, focused)).toBe(false);
    expect(gate.update(pinchOnly(1), 180, focused)).toBe(false);
    expect(gate.update(pinchOnly(2), 260, focused)).toBe(true);
    gate.update(sample(0.2, 3), 300, focused);
    gate.update(sample(0.2, 4), 480, focused);
    expect(gate.update(pinchOnly(5), 500, focused)).toBe(false);
    expect(gate.update(pinchOnly(6), 580, focused)).toBe(false);
    expect(gate.update(pinchOnly(7), 660, focused)).toBe(false);
    expect(gate.update(pinchOnly(8), 760, focused)).toBe(true);
  });

  it("uses raw gesture pose instead of the smoothed visual pose", () => {
    const gate = new HandGestureGate({ candidateMs: 100, targetStableMs: 0 });
    const focused = target();
    const rawGrab = (seq) => sample(0.1, seq, {
      pose: { ...sample(0.1, seq).pose, grabStrength: 0.1, pinchStrength: 0.1 },
      gesturePose: { ...sample(0.9, seq).gesturePose, grabStrength: 0.9, pinchStrength: 0.9 },
    });

    expect(gate.update(rawGrab(1), 0, focused)).toBe(false);
    expect(gate.update(rawGrab(2), 60, focused)).toBe(false);
    expect(gate.update(rawGrab(3), 120, focused)).toBe(true);
  });

  it("keeps a candidate through one short confidence gap", () => {
    const gate = new HandGestureGate({ candidateMs: 160, targetStableMs: 0, gapMs: 120 });
    const focused = target();

    expect(gate.update(sample(0.9, 1), 0, focused)).toBe(false);
    expect(gate.update(sample(0.9, 2), 70, focused)).toBe(false);
    expect(gate.update(sample(0.9, 3, { fresh: false }), 120, focused)).toBe(false);
    expect(gate.update(sample(0.9, 4), 170, focused)).toBe(true);
  });
});
