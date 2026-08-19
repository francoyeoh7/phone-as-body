import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playerFacingFiles = [
  "index.html",
  "src/desktop/ui.js",
  "src/controller/ControllerApp.js",
  "src/ue-bridge/UeBridgeApp.js",
];

describe("player-visible product name", () => {
  it.each(playerFacingFiles)("uses 手机即身体 in %s", (file) => {
    const content = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

    expect(content).toContain("手机即身体");
    expect(content).not.toContain("杨弈的demo");
    expect(content).not.toMatch(/corridor 617/i);
  });
});
