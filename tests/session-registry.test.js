import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";

function sampleInput(overrides = {}) {
  return {
    seq: 1,
    sentAt: 100,
    move: { x: 0, y: 1 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    ...overrides,
  };
}

describe("session registry", () => {
  it("creates a six-digit room and accepts input only from its controller", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    const room = registry.createDesktop("desktop-socket");

    expect(room.code).toBe("617042");
    expect(registry.attachController("617042", "phone-socket")).toEqual({
      ok: true,
      replacedId: null,
    });
    expect(registry.acceptInput("617042", "stranger", sampleInput()).ok).toBe(false);
    expect(registry.acceptInput("617042", "phone-socket", sampleInput()).ok).toBe(true);
  });

  it("rejects stale or malformed controller snapshots", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop-socket");
    registry.attachController("617042", "phone-socket");

    expect(registry.acceptInput("617042", "phone-socket", sampleInput()).ok).toBe(true);
    expect(registry.acceptInput("617042", "phone-socket", sampleInput()).reason).toBe("stale-input");
    expect(
      registry.acceptInput("617042", "phone-socket", sampleInput({ seq: 2, move: { x: 2, y: 0 } })).reason,
    ).toBe("invalid-input");
  });

  it("replaces the prior controller and clears movement on disconnect", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop-socket");
    registry.attachController("617042", "phone-one");
    registry.acceptInput("617042", "phone-one", sampleInput());

    expect(registry.attachController("617042", "phone-two")).toEqual({
      ok: true,
      replacedId: "phone-one",
    });
    expect(registry.acceptInput("617042", "phone-one", sampleInput({ seq: 2 })).reason).toBe("not-controller");

    const disconnected = registry.disconnect("phone-two");
    expect(disconnected).toMatchObject({ role: "controller", roomCode: "617042" });
    expect(registry.get("617042").input.move).toEqual({ x: 0, y: 0 });
  });

  it("removes the room when the desktop disconnects", () => {
    const registry = createSessionRegistry({ randomCode: () => "617042" });
    registry.createDesktop("desktop-socket");
    registry.attachController("617042", "phone-socket");

    expect(registry.disconnect("desktop-socket")).toMatchObject({
      role: "desktop",
      peerId: "phone-socket",
    });
    expect(registry.get("617042")).toBeNull();
  });
});
