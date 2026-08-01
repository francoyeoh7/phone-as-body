import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";

function sampleInput(overrides = {}) {
  return {
    seq: 1,
    sentAt: 100,
    move: { x: 0, y: 1 },
    viewDelta: { yaw: 42, pitch: -18 },
    ...overrides,
  };
}

describe("session registry", () => {
  it("copies one-shot view deltas and clears them when a controller disconnects", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");
    const input = sampleInput();

    expect(registry.acceptInput("617042", "phone", input).ok).toBe(true);
    input.viewDelta.yaw = 1;
    expect(registry.get("617042").input.viewDelta).toEqual({ yaw: 42, pitch: -18 });

    registry.disconnect("phone");
    expect(registry.get("617042").input.viewDelta).toEqual({ yaw: 0, pitch: 0 });
  });

  it("rejects stale and out-of-range delta snapshots", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");

    expect(registry.acceptInput("617042", "phone", sampleInput()).ok).toBe(true);
    expect(registry.acceptInput("617042", "phone", sampleInput()).reason).toBe("stale-input");
    expect(registry.acceptInput("617042", "phone", sampleInput({ seq: 2, viewDelta: { yaw: 999, pitch: 0 } })).reason)
      .toBe("invalid-input");
  });
});
