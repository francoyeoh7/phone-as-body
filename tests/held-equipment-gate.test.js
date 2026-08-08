import { describe, expect, it } from "vitest";
import { HeldEquipmentGate } from "../src/desktop/HeldEquipmentGate.js";

function sample(strength, seq, overrides = {}) {
  return {
    state: "tracked",
    fresh: true,
    trackingConfidence: 0.95,
    modeEpoch: 1,
    seq,
    gesturePose: { handedness: "left", grabStrength: strength },
    ...overrides,
  };
}

describe("HeldEquipmentGate", () => {
  it("requires three fresh frames and 160ms to grab, then 120ms to release", () => {
    const gate = new HeldEquipmentGate();
    expect(gate.update(sample(0.9, 0), 0)).toBeNull();
    expect(gate.update(sample(0.9, 1), 80)).toBeNull();
    expect(gate.update(sample(0.9, 2), 159)).toBeNull();
    expect(gate.update(sample(0.9, 3), 160)).toBe("grab");
    expect(gate.update(sample(0.1, 4), 200)).toBeNull();
    expect(gate.update(sample(0.1, 5), 319)).toBeNull();
    expect(gate.update(sample(0.1, 6), 320)).toBe("release");
  });

  it("rejects stale, low-confidence, lost, and repeated frames", () => {
    const gate = new HeldEquipmentGate();
    expect(gate.update(sample(0.9, 0, { fresh: false }), 0)).toBeNull();
    expect(gate.update(sample(0.9, 1, { trackingConfidence: 0.61 }), 80)).toBeNull();
    expect(gate.update(sample(0.9, 2, { state: "lost" }), 160)).toBeNull();
    expect(gate.update(sample(0.9, 3), 200)).toBeNull();
    expect(gate.update(sample(0.9, 3), 400)).toBeNull();
  });

  it("suppresses a carried grab until a complete open-hand release", () => {
    const gate = new HeldEquipmentGate();
    gate.suppressUntilRelease();
    expect(gate.update(sample(0.9, 0), 0)).toBeNull();
    expect(gate.update(sample(0.1, 1), 40)).toBeNull();
    expect(gate.update(sample(0.1, 2), 159)).toBeNull();
    expect(gate.update(sample(0.1, 3), 160)).toBe("release");
    expect(gate.update(sample(0.9, 4), 200)).toBeNull();
    expect(gate.update(sample(0.9, 5), 280)).toBeNull();
    expect(gate.update(sample(0.9, 6), 360)).toBe("grab");
  });
});
