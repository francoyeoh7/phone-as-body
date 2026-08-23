import { describe, expect, it } from "vitest";
import {
  createEliminationState,
  awardCoins,
  alivePlayers,
  roundRankings,
  settleRound,
  advanceRound,
  isLocalEliminated,
  rollLoot,
  LOOT_TABLE,
  ELIMINATION_RULES,
} from "../src/desktop/game/elimination-state.js";

function makeState() {
  return createEliminationState({ playerNames: ["你", "A", "B", "C", "D"], seed: 42 });
}

describe("elimination state machine", () => {
  it("creates five players with the local player first", () => {
    const state = makeState();
    expect(state.players).toHaveLength(5);
    expect(state.players[0]).toMatchObject({ id: "local", isLocal: true, alive: true, coins: 0 });
    expect(state.round).toBe(1);
    expect(state.phase).toBe("playing");
  });

  it("awards coins only to alive players and rounds to integers", () => {
    const state = makeState();
    expect(awardCoins(state, "local", 33.7)).toBe(true);
    expect(state.players[0].coins).toBe(34);
    state.players[1].alive = false;
    expect(awardCoins(state, "bot-1", 50)).toBe(false);
    expect(awardCoins(state, "local", -5)).toBe(false);
  });

  it("settles a round by eliminating the lowest-coin alive player", () => {
    const state = makeState();
    awardCoins(state, "local", 100);
    awardCoins(state, "bot-1", 80);
    awardCoins(state, "bot-2", 60);
    awardCoins(state, "bot-3", 40);
    // bot-4 stays at 0 -> eliminated
    const summary = settleRound(state);
    expect(summary.eliminated.id).toBe("bot-4");
    expect(summary.finished).toBe(false);
    expect(alivePlayers(state)).toHaveLength(4);
    expect(state.phase).toBe("round-end");
    expect(summary.rankings[0].id).toBe("local");
  });

  it("rejects double settlement without advancing", () => {
    const state = makeState();
    settleRound(state);
    expect(settleRound(state)).toBeNull();
    expect(advanceRound(state)).toBe(true);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("playing");
    expect(advanceRound(state)).toBe(false);
  });

  it("finishes after round 3 with two survivors and reports local outcome", () => {
    const state = makeState();
    awardCoins(state, "local", 500);
    for (let round = 1; round <= 3; round += 1) {
      // local always richest; eliminate a bot each round.
      const summary = settleRound(state);
      expect(summary.eliminated.isLocal).toBe(false);
      if (!summary.finished) advanceRound(state);
    }
    expect(state.phase).toBe("finished");
    expect(state.winnerIds).toHaveLength(2);
    expect(state.winnerIds).toContain("local");
    expect(isLocalEliminated(state)).toBe(false);
  });

  it("eliminates the local player when they finish last", () => {
    const state = makeState();
    awardCoins(state, "bot-1", 50);
    awardCoins(state, "bot-2", 50);
    awardCoins(state, "bot-3", 50);
    awardCoins(state, "bot-4", 50);
    const summary = settleRound(state);
    expect(summary.eliminated.id).toBe("local");
    expect(summary.localWon).toBe(false);
    expect(isLocalEliminated(state)).toBe(true);
  });

  it("produces deterministic loot from the seeded rng", () => {
    const a = createEliminationState({ seed: 7 });
    const b = createEliminationState({ seed: 7 });
    const rollsA = [rollLoot(a), rollLoot(a), rollLoot(a)];
    const rollsB = [rollLoot(b), rollLoot(b), rollLoot(b)];
    expect(rollsA).toEqual(rollsB);
    for (const roll of rollsA) {
      expect(LOOT_TABLE.some((entry) => entry.id === roll.id)).toBe(true);
      expect(roll.coins).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps loot coins inside the table ranges", () => {
    const state = createEliminationState({ seed: 99 });
    for (let index = 0; index < 200; index += 1) {
      const loot = rollLoot(state);
      const entry = LOOT_TABLE.find((candidate) => candidate.id === loot.id);
      expect(loot.coins).toBeGreaterThanOrEqual(entry.coins[0]);
      expect(loot.coins).toBeLessThanOrEqual(entry.coins[1]);
    }
  });

  it("pins the 5-4-3-2 elimination rules", () => {
    expect(ELIMINATION_RULES.playerCount).toBe(5);
    expect(ELIMINATION_RULES.rounds).toBe(3);
    expect(ELIMINATION_RULES.survivorsPerRound).toEqual([4, 3, 2]);
  });
});
