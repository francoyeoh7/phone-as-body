import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PresentationDirector } from "../src/desktop/PresentationDirector.js";

function createHarness() {
  const ui = {
    elements: {},
    setPresentation: vi.fn(),
  };
  const phone = { send: vi.fn() };
  const paper = { enabled: false, root: { visible: false } };
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      slides: [
        { src: "/slide-1.png", label: "One" },
        { src: "/slide-2.png", label: "Two" },
        { src: "/slide-3.png", label: "Three" },
      ],
    }),
  }));
  const director = new PresentationDirector({ ui, phone, paper, fetchImpl });
  return { director, ui, phone, paper, fetchImpl };
}

describe("PresentationDirector", () => {
  it("reveals a door paper and opens the ordered slide deck after pickup", async () => {
    const { director, ui, phone, paper, fetchImpl } = createHarness();

    expect(director.showPaper()).toBe(true);
    expect(paper).toMatchObject({ enabled: true, root: { visible: true } });

    await director.open({ source: "door" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(paper).toMatchObject({ enabled: false, root: { visible: false } });
    expect(ui.setPresentation).toHaveBeenLastCalledWith(expect.objectContaining({
      active: true,
      index: 0,
      total: 3,
      src: "/slide-1.png",
    }));
    expect(phone.send).toHaveBeenLastCalledWith({
      type: "presentation-state",
      active: true,
      index: 0,
      total: 3,
      source: "door",
    });
  });

  it("cycles the phone page controls across the first and last slides", async () => {
    const { director, ui, phone } = createHarness();
    await director.open({ source: "settings" });

    expect(director.previous()).toBe(true);
    expect(director.index).toBe(2);
    expect(director.next()).toBe(true);
    expect(director.index).toBe(0);

    expect(director.close()).toBe(true);
    expect(ui.setPresentation).toHaveBeenLastCalledWith({ active: false });
    expect(phone.send).toHaveBeenLastCalledWith({
      type: "presentation-state",
      active: false,
      index: -1,
      total: 3,
      source: null,
    });
  });

  it("uses nearly the full game viewport for the slide image", () => {
    const styles = readFileSync(new URL("../src/desktop/styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.presentation-overlay\s*\{[^}]*padding:\s*clamp\(6px,\s*1vw,\s*14px\)/s);
    expect(styles).toMatch(/\.presentation-stage\s*\{[^}]*width:\s*min\(calc\(100vw - 12px\),\s*1800px\)[^}]*height:\s*calc\(100vh - 12px\)/s);
  });
});
