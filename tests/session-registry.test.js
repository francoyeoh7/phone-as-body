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

function freshRegistry() {
  return createSessionRegistry({ randomCode: () => "617042" });
}

describe("session registry rooms", () => {
  it("creates a room with a url-safe secret", () => {
    const registry = freshRegistry();
    const room = registry.createDesktop("desktop");
    expect(room.code).toBe("617042");
    expect(room.secret).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(registry.get("617042").secret).toBe(room.secret);
  });

  it("keeps single-controller behaviour as slot 0", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    const joined = registry.attachController("617042", "phone");
    expect(joined).toMatchObject({ ok: true, slot: 0, replacedId: null });
    expect(registry.get("617042").controllers.get("phone").slot).toBe(0);
  });

  it("assigns ascending slots and reports each to the desktop", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    expect(registry.attachController("617042", "a").slot).toBe(0);
    expect(registry.attachController("617042", "b").slot).toBe(1);
    expect(registry.attachController("617042", "c").slot).toBe(2);
    expect(registry.controllerIdAt("617042", 1)).toBe("b");
    expect(registry.controllerIdAt("617042", 9)).toBe(null);
  });

  it("rejects joins when the room is full", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042", maxControllers: 2 });
    registry.createDesktop("desktop");
    expect(registry.attachController("617042", "a").ok).toBe(true);
    expect(registry.attachController("617042", "b").ok).toBe(true);
    expect(registry.attachController("617042", "c")).toMatchObject({ ok: false, reason: "room-full" });
  });

  it("rejects malformed device tokens", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    expect(registry.attachController("617042", "a", "bad token!"))
      .toMatchObject({ ok: false, reason: "invalid-device-token" });
  });

  it("reclaims the slot when a known device token rejoins", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a", "token-aaaa");
    registry.attachController("617042", "b");
    expect(registry.controllerIdAt("617042", 0)).toBe("a");

    const rejoined = registry.attachController("617042", "a2", "token-aaaa");
    expect(rejoined).toMatchObject({ ok: true, slot: 0, replacedId: "a" });
    expect(registry.controllerIdAt("617042", 0)).toBe("a2");
    expect(registry.get("617042").controllers.has("a")).toBe(false);
    expect(registry.get("617042").controllers.get("b").slot).toBe(1);
  });

  it("frees the slot for reuse after a controller disconnects", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.disconnect("a")).toMatchObject({ role: "controller", roomCode: "617042", slot: 0 });
    expect(registry.attachController("617042", "c").slot).toBe(0);
  });

  it("removes the room and reports controllers when the desktop leaves", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.disconnect("desktop"))
      .toMatchObject({ role: "desktop", roomCode: "617042", controllerIds: ["a", "b"] });
    expect(registry.get("617042")).toBe(null);
  });
});

describe("session registry per-controller state", () => {
  it("tracks input staleness per slot", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.acceptInput("617042", "a", sampleInput()).slot).toBe(0);
    expect(registry.acceptInput("617042", "a", sampleInput()).reason).toBe("stale-input");
    expect(registry.acceptInput("617042", "b", sampleInput()).slot).toBe(1);
    expect(registry.acceptInput("617042", "intruder", sampleInput()).reason).toBe("not-controller");
  });

  it("returns the accepted input snapshot with the slot", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "b");
    const accepted = registry.acceptInput("617042", "b", sampleInput({ crouch: true }));
    expect(accepted).toMatchObject({ ok: true, slot: 0 });
    expect(accepted.input).toMatchObject({ crouch: true, move: { x: 0, y: 1 } });
  });

  it("clears one-shot view deltas and stops input on controller disconnect", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");
    const input = sampleInput();

    expect(registry.acceptInput("617042", "phone", input).ok).toBe(true);
    input.viewDelta.yaw = 1;
    expect(registry.get("617042").controllers.get("phone").input.viewDelta).toEqual({ yaw: 42, pitch: -18 });

    registry.disconnect("phone");
    expect(registry.get("617042").controllers.size).toBe(0);
  });

  it("accepts only newer room-owned hand frames per slot", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.acceptHand("617042", "a", sampleHand({ seq: 2, modeEpoch: 3 })).ok).toBe(true);
    expect(registry.acceptHand("617042", "a", sampleHand({ seq: 2, modeEpoch: 3 })).reason).toBe("stale-hand");
    expect(registry.acceptHand("617042", "b", sampleHand({ seq: 0, modeEpoch: 0 })).ok).toBe(true);
    expect(registry.get("617042").controllers.get("a")).toMatchObject({ handSeq: 2, handEpoch: 3 });
  });

  it("accepts a sequence reset when a newer mode epoch starts", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "phone");

    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 4, modeEpoch: 7 })).ok).toBe(true);
    expect(registry.acceptHand("617042", "phone", sampleHand({ seq: 0, modeEpoch: 8 })).ok).toBe(true);
    expect(registry.get("617042").controllers.get("phone")).toMatchObject({ handSeq: 0, handEpoch: 8 });
  });

  it("rate-limits voice clips per controller without storing bytes", () => {
    let now = 10_000;
    const registry = createSessionRegistry({ randomCode: () => "617042", now: () => now });
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    registry.attachController("617042", "b");

    expect(registry.acceptVoiceClip("617042", "a", sampleVoiceClip()))
      .toMatchObject({ ok: true, slot: 0, clip: { seq: 0, mimeType: "audio/webm" } });
    expect(registry.acceptVoiceClip("617042", "a", sampleVoiceClip()).reason).toBe("stale-voice");
    now += 500;
    expect(registry.acceptVoiceClip("617042", "a", sampleVoiceClip({ seq: 1 })).reason).toBe("voice-rate-limited");
    expect(registry.acceptVoiceClip("617042", "b", sampleVoiceClip()).slot).toBe(1);
    expect(registry.get("617042").controllers.get("a").voiceClip).toBeUndefined();
  });

  it("validates actions per controller", () => {
    const registry = freshRegistry();
    registry.createDesktop("desktop");
    registry.attachController("617042", "a");
    expect(registry.acceptAction("617042", "a", { action: "interact", sentAt: 1 }))
      .toMatchObject({ ok: true, slot: 0 });
    expect(registry.acceptAction("617042", "a", { action: "nope" }).ok).toBe(false);
  });
});
