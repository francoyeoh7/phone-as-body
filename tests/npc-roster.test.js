import { describe, expect, it } from "vitest";
import { createNpcRoster, NPC_DEFINITIONS } from "../src/desktop/npc/npc-roster.js";

describe("village NPC roster", () => {
  it("defines the innkeeper, blacksmith, and herbalist with independent identities", () => {
    expect(NPC_DEFINITIONS.map((npc) => npc.id)).toEqual(["mara", "bram", "elowen"]);
    expect(new Set(NPC_DEFINITIONS.map((npc) => npc.role)).size).toBe(3);
    for (const npc of NPC_DEFINITIONS) {
      expect(npc.aliases.length).toBeGreaterThan(1);
      expect(npc.knowledgeBoundary.length).toBeGreaterThan(0);
      expect(npc.secretFacts.length).toBeGreaterThan(0);
      expect(npc.fallback.acknowledge).toBeTruthy();
    }
  });

  it("does not share mutable relationship or history state", () => {
    const roster = createNpcRoster();
    roster.updateRelationship("mara", { trust: 2 });
    roster.addTurn("mara", { speaker: "player", text: "昨晚有人住店吗" });
    expect(roster.get("mara").relationshipState.trust).toBe(2);
    expect(roster.get("bram").relationshipState.trust).toBe(0);
    expect(roster.get("bram").recentTurns).toEqual([]);
  });

  it("limits recent conversation history per NPC", () => {
    const roster = createNpcRoster({ recentTurnLimit: 4 });
    for (let index = 0; index < 7; index += 1) {
      roster.addTurn("elowen", { speaker: "player", text: `turn-${index}` });
    }
    expect(roster.get("elowen").recentTurns.map((turn) => turn.text)).toEqual([
      "turn-3", "turn-4", "turn-5", "turn-6",
    ]);
  });

  it("builds a performer context containing only the selected NPC secrets", () => {
    const roster = createNpcRoster();
    const context = roster.contextFor("mara");
    expect(context.npc.id).toBe("mara");
    expect(context.npc.secretFacts).toEqual(NPC_DEFINITIONS[0].secretFacts);
    expect(JSON.stringify(context)).not.toContain(NPC_DEFINITIONS[1].secretFacts[0]);
    expect(JSON.stringify(context)).not.toContain(NPC_DEFINITIONS[2].secretFacts[0]);
  });

  it("rejects unknown NPC ids instead of inventing a role", () => {
    const roster = createNpcRoster();
    expect(() => roster.get("stranger")).toThrow(/Unknown NPC/);
  });
});
