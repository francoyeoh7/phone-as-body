import { describe, expect, it, vi } from "vitest";
import { InventoryState } from "../src/desktop/InventoryState.js";
import { VillageDirector } from "../src/desktop/VillageDirector.js";

function createHarness() {
  const ui = {
    setObjective: vi.fn(),
    setPrompt: vi.fn(),
    setSubtitle: vi.fn(),
  };
  const audio = { cue: vi.fn() };
  const inventory = new InventoryState([{ id: "spare-fuse", enabled: true }]);
  const experience = {
    objects: {
      fuse: { enabled: true, root: { visible: true } },
      washbasin: { label: "洗手池", toggle: vi.fn(() => true) },
    },
  };
  return { director: new VillageDirector({ experience, ui, audio, inventory }), ui, audio, inventory, experience };
}

describe("VillageDirector", () => {
  it("collects the fuse into inventory and returns to a neutral village objective", () => {
    const { director, ui, audio, inventory, experience } = createHarness();

    expect(director.handleInteraction("fuse")).toBe(true);

    expect(inventory.snapshot().items).toEqual([{ id: "spare-fuse", enabled: true }]);
    expect(experience.objects.fuse).toMatchObject({ enabled: false, root: { visible: false } });
    expect(audio.cue).toHaveBeenCalledWith("pickup");
    expect(ui.setObjective).toHaveBeenLastCalledWith(expect.not.stringMatching(/panel|corridor|配电箱|走廊/i));
    expect(director.handleInteraction("panel")).toBe(false);
  });

  it("keeps the washbasin repeatable without advancing any story state", () => {
    const { director, audio, experience } = createHarness();

    expect(director.handleInteraction("washbasin")).toBe(true);
    expect(director.handleInteraction("washbasin")).toBe(true);

    expect(experience.objects.washbasin.toggle).toHaveBeenCalledTimes(2);
    expect(audio.cue).toHaveBeenNthCalledWith(1, "water-on");
    expect(audio.cue).toHaveBeenNthCalledWith(2, "water-on");
  });
});
