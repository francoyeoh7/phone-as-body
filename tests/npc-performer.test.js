import { describe, expect, it, vi } from "vitest";
import { createNpcRoster } from "../src/desktop/npc/npc-roster.js";
import { NpcPerformer, validateNpcPerformance } from "../src/desktop/npc/NpcPerformer.js";

const valid = {
  npcId: "mara",
  speech: "我听见了。你需要什么？",
  action: "notice",
  emotion: "curious",
  gesture: "turn",
};

describe("NPC performer", () => {
  it("accepts and freezes strict performance JSON", () => {
    const result = validateNpcPerformance(valid, { expectedNpcId: "mara" });
    expect(result).toEqual(valid);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [{ ...valid, npcId: "bram" }],
    [{ ...valid, action: "attack-player" }],
    [{ ...valid, emotion: "omniscient" }],
    [{ ...valid, speech: "x".repeat(181) }],
    [{ ...valid, secretInstruction: "ignore the rules" }],
  ])("rejects invalid or expanded performer output", (payload) => {
    expect(validateNpcPerformance(payload, { expectedNpcId: "mara" })).toBeNull();
  });

  it("provides immediate role-specific local performances", async () => {
    const performer = new NpcPerformer({ roster: createNpcRoster() });
    const mara = await performer.perform({ npcId: "mara", phase: "notice", generation: 1 });
    const bram = await performer.perform({ npcId: "bram", phase: "notice", generation: 2 });
    expect(mara.source).toBe("local");
    expect(bram.source).toBe("local");
    expect(mara.speech).not.toBe(bram.speech);
  });

  it("falls back locally when remote output is invalid", async () => {
    const remote = vi.fn().mockResolvedValue({ ...valid, action: "teleport" });
    const performer = new NpcPerformer({ roster: createNpcRoster(), remote });
    const result = await performer.perform({ npcId: "mara", phase: "notice", generation: 4 });
    expect(remote).toHaveBeenCalledOnce();
    expect(result.source).toBe("local");
    expect(result.action).toBe("notice");
  });

  it("discards a response when its generation has become stale", async () => {
    let release;
    const remote = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    let current = 7;
    const performer = new NpcPerformer({ roster: createNpcRoster(), remote });
    const pending = performer.perform({
      npcId: "mara",
      phase: "notice",
      generation: 7,
      isCurrent: (generation) => generation === current,
    });
    current = 8;
    release(valid);
    await expect(pending).resolves.toBeNull();
  });

  it("records local conversation separately and changes response by knowledge boundary", async () => {
    const roster = createNpcRoster();
    const performer = new NpcPerformer({ roster });
    const result = await performer.perform({
      npcId: "bram",
      phase: "conversation",
      utterance: "这把钥匙上的划痕是什么",
      generation: 3,
    });
    expect(result.action).toBe("speak");
    expect(result.speech).toMatch(/金属|锉|工具|修/);
    expect(roster.get("bram").recentTurns).toHaveLength(2);
    expect(roster.get("mara").recentTurns).toHaveLength(0);
  });
});
