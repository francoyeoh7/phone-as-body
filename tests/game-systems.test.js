import { describe, expect, it } from "vitest";
import { createEliminationState, giveItem, giveMaterial } from "../src/desktop/game/elimination-state.js";
import { pickpocketCoins, pickpocketItem, pickpocketOptions, PICKPOCKET_COIN_AMOUNT } from "../src/desktop/game/pickpocket.js";
import { RECIPES, canCraft, craft } from "../src/desktop/game/crafting.js";
import { createBulletinBoard, postTask, postAutoTask, claimTask, completeTask, postListing, buyListing } from "../src/desktop/game/bulletin-board.js";

function state() {
  return createEliminationState({ playerNames: ["你", "A", "B", "C", "D"], seed: 3 });
}

describe("pickpocket", () => {
  it("steals exactly 50 coins, clamped by the victim's balance", () => {
    const s = state();
    s.players[1].coins = 200;
    const result = pickpocketCoins(s, "local", "bot-1");
    expect(result).toMatchObject({ ok: true, amount: PICKPOCKET_COIN_AMOUNT });
    expect(s.players[0].coins).toBe(50);
    expect(s.players[1].coins).toBe(150);
  });

  it("refuses to steal from a broke victim or yourself", () => {
    const s = state();
    expect(pickpocketCoins(s, "local", "bot-1").ok).toBe(false);
    expect(pickpocketCoins(s, "local", "local").ok).toBe(false);
  });

  it("steals a random item from the victim", () => {
    const s = state();
    giveItem(s, "bot-2", "watch", "旧怀表");
    giveItem(s, "bot-2", "part", "零件");
    const result = pickpocketItem(s, "local", "bot-2");
    expect(result.ok).toBe(true);
    expect(s.players[2].items).toHaveLength(1);
    expect(s.players[0].items).toHaveLength(1);
    expect(pickpocketItem(s, "local", "local").ok).toBe(false);
  });

  it("offers the two digit-mapped steal options", () => {
    expect(pickpocketOptions().map((o) => o.key)).toEqual(["1", "2"]);
  });
});

describe("crafting", () => {
  it("crafts a hammer from 2 stone + 2 wood", () => {
    const s = state();
    giveMaterial(s, "local", "stone", 2);
    giveMaterial(s, "local", "wood", 2);
    expect(canCraft(s, "local", "hammer")).toBe(true);
    const result = craft(s, "local", "hammer");
    expect(result.ok).toBe(true);
    expect(s.players[0].items[0].label).toBe("锤子");
    expect(s.players[0].materials.stone).toBe(0);
  });

  it("refuses when materials are short", () => {
    const s = state();
    giveMaterial(s, "local", "stone", 1);
    expect(canCraft(s, "local", "hammer")).toBe(false);
    expect(craft(s, "local", "hammer").ok).toBe(false);
  });

  it("covers all three recipes", () => {
    expect(RECIPES.map((r) => r.id)).toEqual(["hammer", "stimulant", "trap"]);
  });
});

describe("bulletin board", () => {
  it("claims a task exclusively", () => {
    const board = createBulletinBoard({ seed: 1 });
    const task = postTask(board, { description: "去钟楼敲钟", reward: 80 });
    expect(claimTask(board, task.id, "local").ok).toBe(true);
    expect(claimTask(board, task.id, "bot-1").ok).toBe(false);
  });

  it("completes a claimed task and pays out", () => {
    const board = createBulletinBoard({ seed: 1 });
    const task = postTask(board, { description: "x", reward: 60 });
    claimTask(board, task.id, "local");
    expect(completeTask(board, task.id, "local")).toMatchObject({ ok: true, reward: 60 });
    expect(completeTask(board, task.id, "bot-1").ok).toBe(false);
  });

  it("auto-posts deterministic errands", () => {
    const board = createBulletinBoard({ seed: 5 });
    const task = postAutoTask(board);
    expect(task.description.length).toBeGreaterThan(0);
    expect(task.reward).toBeGreaterThan(0);
  });

  it("sells a listing once and blocks self-buy", () => {
    const board = createBulletinBoard({ seed: 1 });
    const listing = postListing(board, { sellerId: "bot-1", itemId: "watch", label: "旧怀表", price: 100 });
    expect(buyListing(board, listing.id, "bot-1").ok).toBe(false);
    expect(buyListing(board, listing.id, "local").ok).toBe(true);
    expect(buyListing(board, listing.id, "local").ok).toBe(false);
  });
});
