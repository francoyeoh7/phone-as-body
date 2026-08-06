import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("hand tracking worker production entry", () => {
  it("uses the static Worker URL form required by Vite bundling", async () => {
    const source = await readFile("src/controller/MediaPipeHandTracker.js", "utf8");

    expect(source).toMatch(
      /new Worker\(\s*new URL\("\.\/hand-tracking\.worker\.js", import\.meta\.url\),\s*\{ type: "module" \},?\s*\)/,
    );
    expect(source).not.toContain("new this.Worker(new URL(\"./hand-tracking.worker.js\"");
  });
});
