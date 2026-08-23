import { describe, expect, it, vi } from "vitest";
import { EliminationDirector } from "../src/desktop/game/EliminationDirector.js";
import { GamePanels, botOptionMenu } from "../src/desktop/game/GamePanels.js";

if (!globalThis.document) {
  globalThis.document = {
    exitPointerLock: vi.fn(),
    createElement: () => ({ style: {}, classList: { add: vi.fn() }, addEventListener: vi.fn() }),
  };
}

function makeUiElements() {
  const mk = () => ({ hidden: true, textContent: "", value: "", innerHTML: "", addEventListener: vi.fn(), classList: { add: vi.fn() }, dataset: {} });
  const buttons = [];
  const card = {
    querySelector: vi.fn((sel) => (sel === ".option-cancel" ? mk() : null)),
    querySelectorAll: vi.fn(() => []),
    insertBefore: vi.fn(),
  };
  return {
    optionMenu: mk(),
    optionTarget: mk(),
    optionCard: card,
    optionPriceRow: mk(),
    optionPrice: mk(),
    optionCancel: mk(),
    __buttons: buttons,
  };
}

describe("E on a bot opens the option menu", () => {
  it("standing opens trade/contest; crouched opens pickpocket with digit choices", async () => {
    const elements = makeUiElements();
    const ui = { elements, setObjective: vi.fn(), setPrompt: vi.fn(), setSubtitle: vi.fn(), setGameStatus: vi.fn() };
    const panels = new GamePanels({ ui });
    panels.bind();

    const bots = { bots: [], load: vi.fn(async () => {}), update: vi.fn(), dispose: vi.fn() };
    const director = new EliminationDirector({
      experience: {
        scene: { add: vi.fn() },
        camera: { position: { distanceTo: () => 1 } },
        interactables: [],
        spawn: { position: [6.5, 1.05, -2] },
        RAPIER: null,
        world: null,
        objects: {},
      },
      ui,
      audio: null,
      inventory: null,
      botFactory: () => bots,
      onBotInteract: (bot, details) => {
        const menu = botOptionMenu({ crouched: details?.crouched === true });
        panels.open({ title: bot.name, options: menu.options, onSelect: vi.fn() });
      },
      rng: () => 0.5,
    });
    await director.load();

    // standing -> trade/contest options
    director.handleInteraction("bot-1", { crouched: false });
    expect(elements.optionMenu.hidden).toBe(false);
    expect(elements.optionTarget.textContent).toBe("猎手");

    // crouched -> pickpocket options with digit keys
    const crouchMenu = botOptionMenu({ crouched: true });
    expect(crouchMenu.options.map((o) => o.digit)).toEqual(["1", "2", undefined]);
    expect(crouchMenu.options[0].id).toBe("pickpocket-coins");
  });
});
