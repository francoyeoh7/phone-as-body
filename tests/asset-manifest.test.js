import { describe, expect, it } from "vitest";
import { access, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { validateEnvironmentManifest } from "../src/desktop/environment/manifest.js";
import { ELDERBOOM_V1_CONFIG } from "../scripts/environment/elderboom-v1.config.mjs";

const required = [
  "public/assets/mediapipe/hand_landmarker.task",
  "public/assets/mediapipe/wasm/vision_wasm_internal.js",
  "public/assets/mediapipe/wasm/vision_wasm_internal.wasm",
  "public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "public/assets/hands/left.glb",
  "public/assets/hands/right.glb",
  "public/assets/hands/psx-arms.glb",
  "public/assets/hands/LICENSE.md",
  "public/assets/hands/SOURCE.md",
];

describe("tracked hand assets", () => {
  it("ships all local runtime and licensed model files", async () => {
    await Promise.all(required.map((path) => access(path)));
    const model = await stat(required[0]);
    const left = await stat(required[5]);
    const right = await stat(required[6]);
    const psx = await stat(required[7]);
    expect(model.size).toBeGreaterThan(1_000_000);
    expect(left.size).toBeGreaterThan(10_000);
    expect(right.size).toBeGreaterThan(10_000);
    expect(psx.size).toBeGreaterThan(500_000);
    expect(await readFile(required[8], "utf8")).toContain("MIT License");
    expect(await readFile(required[9], "utf8")).toContain("CC0 / Public Domain");
  });
});

describe("village asset contract", () => {
  it("always validates the tracked manifest against the extraction config", async () => {
    const manifestPath = ELDERBOOM_V1_CONFIG.outputs.manifest;
    const manifest = validateEnvironmentManifest(JSON.parse(await readFile(manifestPath, "utf8")));

    expect(manifest.id).toBe(ELDERBOOM_V1_CONFIG.id);
    expect(manifest.rootTransform).toEqual(ELDERBOOM_V1_CONFIG.rootTransform);
    expect(ELDERBOOM_V1_CONFIG.outputs.directory).toBe("public/assets/environment/elderboom-v1/chunks");
    expect(ELDERBOOM_V1_CONFIG.source).toMatchObject({
      bytes: 936_886_692,
      sha256: "0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB",
    });
    expect(manifest.chunks).toHaveLength(4);
    expect(manifest.chunks.map((chunk) => chunk.quality)).toEqual(["low", "balanced", "high", "ultra"]);
  });

  it.runIf(process.env.VILLAGE_ASSETS_REQUIRED === "1")(
    "requires the ignored local village chunk to match manifest bytes and sha256",
    async () => {
      const manifest = validateEnvironmentManifest(JSON.parse(
        await readFile(ELDERBOOM_V1_CONFIG.outputs.manifest, "utf8"),
      ));
      const chunk = manifest.chunks[0];
      const chunkPath = `public${chunk.url}`;
      const hash = createHash("sha256");
      for await (const bytes of createReadStream(chunkPath)) hash.update(bytes);

      expect((await stat(chunkPath)).size).toBe(chunk.artifact.bytes);
      expect(hash.digest("hex").toUpperCase()).toBe(chunk.artifact.sha256);
    },
    30_000,
  );
});
