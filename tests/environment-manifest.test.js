import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateEnvironmentManifest } from "../src/desktop/environment/manifest.js";

const manifestPath = new URL("../public/assets/environment/elderboom-v1/manifest.json", import.meta.url);

async function trackedManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

describe("ElderBoom environment manifest", () => {
  it("validates and deeply freezes the tracked gameplay boundary", async () => {
    const manifest = validateEnvironmentManifest(await trackedManifest());

    expect(manifest.id).toBe("elderboom-v1");
    expect(manifest.chunks).toHaveLength(4);
    expect(manifest.chunks.map((chunk) => chunk.quality)).toEqual(["low", "balanced", "high", "ultra"]);
    for (const chunk of manifest.chunks) {
      expect(chunk.url).toBe(`/assets/environment/elderboom-v1/chunks/${chunk.id}.glb`);
      expect(Number.isSafeInteger(chunk.artifact.bytes)).toBe(true);
      expect(chunk.artifact.bytes).toBeGreaterThan(0);
      expect(chunk.artifact.sha256).toMatch(/^[A-F0-9]{64}$/);
    }
    expect(Object.keys(manifest.tasks).sort()).toEqual([
      "exit-door", "found-phone", "fuse", "panel", "shadow-window", "washbasin",
    ]);
    expect(Object.isFrozen(manifest.tasks.panel.position)).toBe(true);
    expect(() => { manifest.spawn.position[0] = 99; }).toThrow(TypeError);
    expect(() => { manifest.chunks[0].quality = "extreme"; }).toThrow(TypeError);
  });

  it("accepts a legacy single chunk without a quality level", async () => {
    const value = await trackedManifest();
    const legacy = structuredClone(value.chunks[0]);
    delete legacy.quality;
    value.chunks = [legacy];

    const manifest = validateEnvironmentManifest(value);
    expect(manifest.chunks).toHaveLength(1);
    expect(manifest.chunks[0].quality).toBeUndefined();
  });

  it.each([
    ["unknown top-level keys", (value) => { value.surprise = true; }],
    ["unknown nested keys", (value) => { value.chunks[0].surprise = true; }],
    ["path traversal", (value) => { value.chunks[0].url = "/assets/environment/elderboom-v1/chunks/../source.glb"; }],
    ["non-HTTPS remote chunks", (value) => { value.chunks[0].url = "http://example.com/village.glb"; }],
    ["unknown quality levels", (value) => { value.chunks[0].quality = "extreme"; }],
    ["duplicate quality levels", (value) => { value.chunks[1].quality = value.chunks[0].quality; }],
    ["more than four chunks", (value) => {
      const extra = structuredClone(value.chunks[0]);
      extra.id = "extra-chunk";
      delete extra.quality;
      value.chunks.push(extra);
    }],
    ["non-finite transforms", (value) => { value.rootTransform.position[0] = Number.POSITIVE_INFINITY; }],
    ["non-positive collider extents", (value) => { value.colliders[0].halfExtents[0] = 0; }],
    ["duplicate IDs", (value) => { value.colliders[1].id = value.colliders[0].id; }],
    ["missing task IDs", (value) => { delete value.tasks.panel; }],
    ["invalid normals", (value) => { value.tasks.panel.contactNormal = [4, 0, 0]; }],
    ["task anchors outside playable bounds", (value) => { value.tasks.fuse.position = [99, 0, 0]; }],
  ])("rejects %s", async (_label, mutate) => {
    const value = await trackedManifest();
    mutate(value);
    expect(() => validateEnvironmentManifest(value)).toThrow();
  });
});
