import { describe, expect, it, vi } from "vitest";
import { EliminationDirector } from "../src/desktop/game/EliminationDirector.js";

function makeExperience() {
  return {
    scene: { add: vi.fn() },
    camera: { position: { distanceTo: () => 1 } },
    interactables: [],
    spawn: { position: [6.5, 1.05, -2] },
    RAPIER: null,
    world: null,
    objects: {},
  };
}

function makeUi() {
  return {
    setObjective: vi.fn(),
    setPrompt: vi.fn(),
    setSubtitle: vi.fn(),
    setGameStatus: vi.fn(),
  };
}

function makeBots() {
  return {
    bots: [],
    load: vi.fn(async () => {}),
    update: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("EliminationDirector bot interaction", () => {
  it("routes a bot E-press to the onBotInteract callback with the matching player", async () => {
    const onBotInteract = vi.fn();
    const director = new EliminationDirector({
      experience: makeExperience(),
      ui: makeUi(),
      audio: null,
      inventory: null,
      botFactory: makeBots,
      onBotInteract,
      rng: () => 0.5,
    });
    await director.load();

    const bot = director.state.players.find((player) => player.id === "bot-1");
    expect(bot?.alive).toBe(true);
    expect(director.handleInteraction("bot-1")).toBe(true);
    expect(onBotInteract).toHaveBeenCalledTimes(1);
    expect(onBotInteract.mock.calls[0][0]).toBe(bot);
    expect(onBotInteract.mock.calls[0][0].name).toBe("猎手");
  });

  it("ignores interactions from eliminated bots", async () => {
    const onBotInteract = vi.fn();
    const director = new EliminationDirector({
      experience: makeExperience(),
      ui: makeUi(),
      audio: null,
      inventory: null,
      botFactory: makeBots,
      onBotInteract,
      rng: () => 0.5,
    });
    await director.load();
    const bot = director.state.players.find((player) => player.id === "bot-2");
    bot.alive = false;
    expect(director.handleInteraction("bot-2")).toBe(false);
    expect(onBotInteract).not.toHaveBeenCalled();
  });

  it("ignores interactions when the game is not in the playing phase", async () => {
    const onBotInteract = vi.fn();
    const director = new EliminationDirector({
      experience: makeExperience(),
      ui: makeUi(),
      audio: null,
      inventory: null,
      botFactory: makeBots,
      onBotInteract,
      rng: () => 0.5,
    });
    await director.load();
    director.state.phase = "round-end";
    expect(director.handleInteraction("bot-1")).toBe(false);
  });

  it("registers every bot as an enabled interactable", async () => {
    const experience = makeExperience();
    const bots = makeBots();
    bots.bots = [
      { id: "bot-1", label: "猎手", root: {}, interaction: {} },
      { id: "bot-2", label: "旅人", root: {}, interaction: {} },
    ];
    const director = new EliminationDirector({
      experience,
      ui: makeUi(),
      audio: null,
      inventory: null,
      botFactory: () => bots,
      onBotInteract: vi.fn(),
      rng: () => 0.5,
    });
    await director.load();
    const botEntries = experience.interactables.filter((entry) => /^bot-\d+$/.test(entry.id));
    expect(botEntries).toHaveLength(2);
    expect(botEntries.every((entry) => entry.enabled === true)).toBe(true);
  });
});
