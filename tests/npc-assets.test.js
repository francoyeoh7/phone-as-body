import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

const root = path.resolve(import.meta.dirname, "..");

describe("Fab NPC asset intake", () => {
  it("contains three free, AI-compatible, locally stored role assets", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "public/assets/npcs/manifest.json"), "utf8"));
    expect(manifest.version).toBe(2);
    expect(manifest.npcs.map((entry) => entry.id)).toEqual(["mara", "bram", "elowen"]);
    for (const entry of manifest.npcs) {
      expect(entry.source.marketplace).toBe("Fab");
      expect(entry.source.price).toBe("Free");
      expect(entry.source.allowsAi).toBe(true);
      expect(entry.source.generatedWithAi).toBe(false);
      expect(entry.source.license).toBe("CC BY 4.0");
      expect(entry.url).toMatch(/^\/assets\/npcs\/models\/.+\.glb$/);
      expect(entry.position).toHaveLength(3);
      expect(entry.rotation).toHaveLength(3);
      expect(entry.maxDepthRatio).toBeGreaterThan(0);
      expect(entry.maxDepthRatio).toBeLessThanOrEqual(0.82);
    }
    expect(manifest.npcs.find((entry) => entry.id === "bram").forceFallback).toBe(true);
  });

  it("matches every recorded byte count and SHA-256 digest", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "public/assets/npcs/manifest.json"), "utf8"));
    for (const entry of manifest.npcs) {
      const bytes = await readFile(path.join(root, "public", entry.url));
      expect(bytes.byteLength).toBe(entry.artifact.bytes);
      expect(createHash("sha256").update(bytes).digest("hex").toUpperCase()).toBe(entry.artifact.sha256);
    }
  });

  it("parses every GLB and retains rig or animation data", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "public/assets/npcs/manifest.json"), "utf8"));
    const io = new NodeIO();
    for (const entry of manifest.npcs) {
      const document = await io.read(path.join(root, "public", entry.url));
      const gltf = document.getRoot();
      expect(gltf.listMeshes().length).toBeGreaterThan(0);
      expect(gltf.listSkins().length + gltf.listAnimations().length).toBeGreaterThan(0);
    }
  });
});
