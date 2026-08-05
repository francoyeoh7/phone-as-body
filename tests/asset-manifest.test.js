import { describe, expect, it } from "vitest";
import { access, readFile, stat } from "node:fs/promises";

const required = [
  "public/assets/mediapipe/hand_landmarker.task",
  "public/assets/mediapipe/wasm/vision_wasm_internal.js",
  "public/assets/mediapipe/wasm/vision_wasm_internal.wasm",
  "public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "public/assets/hands/left.glb",
  "public/assets/hands/right.glb",
  "public/assets/hands/LICENSE.md",
  "public/assets/hands/SOURCE.md",
];

describe("tracked hand assets", () => {
  it("ships all local runtime and licensed model files", async () => {
    await Promise.all(required.map((path) => access(path)));
    const model = await stat(required[0]);
    const left = await stat(required[5]);
    const right = await stat(required[6]);
    expect(model.size).toBeGreaterThan(1_000_000);
    expect(left.size).toBeGreaterThan(10_000);
    expect(right.size).toBeGreaterThan(10_000);
    expect(await readFile(required[7], "utf8")).toContain("MIT License");
  });
});
