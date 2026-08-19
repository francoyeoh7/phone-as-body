import { describe, expect, it } from "vitest";
import { hearingRadiusForVoice, resolveNpcListener } from "../src/shared/npc-listener-resolver.js";

const base = {
  playerPosition: { x: 0, y: 1.6, z: 0 },
  playerForward: { x: 0, y: 0, z: -1 },
  voiceLevel: 0.5,
};

const npc = (id, aliases, x, z) => ({ id, aliases, position: { x, y: 1.6, z } });

describe("NPC listener resolver", () => {
  it("clamps the hearing radius to the specified range", () => {
    expect(hearingRadiusForVoice(-5)).toBe(3.5);
    expect(hearingRadiusForVoice(0.5)).toBe(8.5);
    expect(hearingRadiusForVoice(5)).toBe(12);
  });

  it("selects the named NPC even when another NPC is closer", () => {
    const result = resolveNpcListener({
      ...base,
      transcript: "Mara, can you help me?",
      npcs: [npc("mara", ["Mara"], 1, -7), npc("bram", ["Bram"], 0, -2)],
    });
    expect(result.listener.id).toBe("mara");
    expect(result.cue.named).toBe(true);
  });

  it("uses facing and distance for a generic greeting", () => {
    const result = resolveNpcListener({
      ...base,
      transcript: "hello there",
      npcs: [npc("behind", ["Bram"], 0, 2), npc("ahead", ["Mara"], 0, -3)],
    });
    expect(result.listener.id).toBe("ahead");
    expect(result.facingFactor).toBe(1);
  });

  it("ignores generic greetings farther than eight metres", () => {
    const result = resolveNpcListener({
      ...base,
      voiceLevel: 1,
      transcript: "hello",
      npcs: [npc("mara", ["Mara"], 0, -9)],
    });
    expect(result.listener).toBeNull();
  });

  it("does not select a weak non-directed phrase", () => {
    const result = resolveNpcListener({
      ...base,
      transcript: "nice weather",
      npcs: [npc("mara", ["Mara"], 0, -2)],
    });
    expect(result.listener).toBeNull();
  });

  it("breaks exact ties by stable NPC id", () => {
    const result = resolveNpcListener({
      ...base,
      transcript: "hello",
      npcs: [npc("mara", ["Mara"], 1, -3), npc("bram", ["Bram"], -1, -3)],
    });
    expect(result.listener.id).toBe("bram");
  });

  it("exposes the specified cue and spatial score components", () => {
    const result = resolveNpcListener({
      ...base,
      transcript: "Mara, please help me",
      npcs: [npc("mara", ["Mara"], 0, -4.25)],
    });
    expect(result.cueScore).toBeCloseTo(0.65 + 0.4 + 0.35);
    expect(result.distanceFactor).toBeCloseTo(0.5);
    expect(result.score).toBeCloseTo(1.4 + 0.5 * 0.35 + 1 * 0.2);
  });
});
