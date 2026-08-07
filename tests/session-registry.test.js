import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";

function sampleInput(overrides = {}) {
  return {
    seq: 1,
    sentAt: 100,
    move: { x: 0, y: 1 },
    viewDelta: { yaw: 42, pitch: -18 },
    clutch: true,
    ...overrides,
  };
}

function sampleHand(overrides = {}) {
  return {
    version: 1, seq: 1, capturedAt: 1, modeEpoch: 0, state: "lost", reason: "test", ...overrides,
  };
}

function sampleVoiceClip(overrides = {}) {
  return {
    version: 1,
    seq: 0,
    durationMs: 800,
    mimeType: "audio/webm",
    data: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

describe("session registry", () => {
  it("accepts only newer room-owned hand frames and stores ordering scalars", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");
    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 2, modeEpoch: 3 })).ok).toBe(true);
    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 2, modeEpoch: 3 })).reason).toBe("stale-hand");
    expect(registry.acceptHand("617042", "other", sampleHand({ seq: 3, modeEpoch: 3 })).reason).toBe("not-controller");
    expect(registry.get("617042")).toMatchObject({ handSeq: 2, handEpoch: 3 });
    expect(registry.get("617042").hand).toBeUndefined();
  });

  it("accepts a sequence reset when a newer mode epoch starts", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");

    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 4, modeEpoch: 7 })).ok).toBe(true);
    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 0, modeEpoch: 8 }))).toMatchObject({ ok: true });
    expect(registry.get("617042")).toMatchObject({ handSeq: 0, handEpoch: 8 });
  });

  it("resets hand ordering on replacement and disconnect", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone-a");
    registry.acceptHand("617042", "phone-a", sampleHand({ seq: 8, modeEpoch: 4 }));
    registry.attachController("617042", "phone-b");
    expect(registry.get("617042")).toMatchObject({ controllerId: "phone-b", handSeq: -1, handEpoch: 0 });
    expect(registry.acceptHand("617042", "phone-b", sampleHand({ seq: 0, modeEpoch: 0 })).ok).toBe(true);
    registry.disconnect("phone-b");
    expect(registry.get("617042")).toMatchObject({ controllerId: null, handSeq: -1, handEpoch: 0 });
  });
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

  it("normalizes optional crouch state and copies accepted input", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");
    const input = sampleInput({ crouch: true });

    expect(registry.acceptInput("617042", "phone", input).room.input.crouch).toBe(true);
    input.move.x = 0.8;
    expect(registry.get("617042").input).toMatchObject({ move: { x: 0, y: 1 }, crouch: true });
    expect(registry.acceptInput("617042", "phone", sampleInput({ seq: 2 })).room.input.crouch).toBe(false);
  });

  it("accepts only controller-owned ordered and rate-limited voice clips without storing bytes", () => {
    let now = 10_000;
    const registry = createSessionRegistry({ randomCode: () => "617042", now: () => now });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");

    expect(registry.acceptVoiceClip("617042", "intruder", sampleVoiceClip()).reason).toBe("not-controller");
    const accepted = registry.acceptVoiceClip("617042", "phone", sampleVoiceClip());
    expect(accepted).toMatchObject({ ok: true, clip: { seq: 0, mimeType: "audio/webm" } });
    expect(registry.get("617042")).toMatchObject({ voiceSeq: 0, lastVoiceAcceptedAt: 10_000 });
    expect(registry.get("617042").voiceClip).toBeUndefined();
    expect(registry.acceptVoiceClip("617042", "phone", sampleVoiceClip()).reason).toBe("stale-voice");
    now += 500;
    expect(registry.acceptVoiceClip("617042", "phone", sampleVoiceClip({ seq: 1 })).reason).toBe("voice-rate-limited");
    now += 500;
    expect(registry.acceptVoiceClip("617042", "phone", sampleVoiceClip({ seq: 1 })).ok).toBe(true);
  });

  it("resets voice ordering and rate state on controller replacement and disconnect", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042", now: () => 10_000 });
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone-a");
    registry.acceptVoiceClip("617042", "phone-a", sampleVoiceClip({ seq: 8 }));

    registry.attachController("617042", "phone-b");
    expect(registry.get("617042")).toMatchObject({ controllerId: "phone-b", voiceSeq: -1, lastVoiceAcceptedAt: null });
    expect(registry.acceptVoiceClip("617042", "phone-b", sampleVoiceClip()).ok).toBe(true);
    registry.disconnect("phone-b");
    expect(registry.get("617042")).toMatchObject({ controllerId: null, voiceSeq: -1, lastVoiceAcceptedAt: null });
  });
});
