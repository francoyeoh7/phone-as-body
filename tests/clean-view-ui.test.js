import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression pin for 2026-08-23: the clean-view rule used to hide every shell
// child except four, which made the option menu, trade overlay and pause
// overlay display:none during gameplay — interactions fired but nothing showed.
const css = readFileSync(path.resolve(__dirname, "../src/desktop/styles.css"), "utf8");
const cleanViewRule = css.match(/\.desktop-shell\[data-clean-view="true"\][^{]+\{/)?.[0] ?? "";

describe("clean-view keeps gameplay UI reachable", () => {
  it.each([
    ".option-menu",
    ".trade-overlay",
    ".pause-overlay",
    ".interaction-prompt",
    ".subtitle",
    ".game-status",
  ])("whitelists %s", (selector) => {
    expect(cleanViewRule).toContain(`:not(${selector})`);
  });

  it("styles the three overlays as fixed layers above the canvas", () => {
    for (const selector of [".option-menu", ".trade-overlay", ".pause-overlay"]) {
      const block = css.match(new RegExp(`${selector.replace(".", "\\.")}[^}]*\\{([^}]*)\\}`, "s"));
      expect(block, selector).toBeTruthy();
    }
    expect(css).toMatch(/\.option-menu,\s*\n\.trade-overlay,\s*\n\.pause-overlay\s*\{[^}]*position:\s*fixed/s);
  });
});
