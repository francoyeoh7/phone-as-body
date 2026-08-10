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
    expect(manifest.chunks[0].artifact).toEqual({
      bytes: 67_236_796,
      sha256: "B2EEC61841721CCA59B42391D2994F523A7AF41E0C5DAADC65CC3323F45F3DA4",
    });
    expect(Object.keys(manifest.tasks).sort()).toEqual([
      "exit-door", "found-phone", "fuse", "panel", "shadow-window", "washbasin",
    ]);
    expect(Object.isFrozen(manifest.tasks.panel.position)).toBe(true);
    expect(() => { manifest.spawn.position[0] = 99; }).toThrow(TypeError);
  });

  it.each([
    ["unknown top-level keys", (value) => { value.surprise = true; }],
    ["unknown nested keys", (value) => { value.chunks[0].surprise = true; }],
    ["path traversal", (value) => { value.chunks[0].url = "/assets/environment/elderboom-v1/chunks/../source.glb"; }],
    ["non-HTTPS remote chunks", (value) => { value.chunks[0].url = "http://example.com/village.glb"; }],
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
