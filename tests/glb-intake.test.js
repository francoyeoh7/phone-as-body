import { describe, expect, it } from "vitest";
import {
  assertClosedDocument,
  collectDocumentReferences,
  nodeWorldBounds,
  walkNodeWorldTransforms,
} from "../scripts/environment/glb-graph.mjs";
import { readGlbDocument } from "../scripts/environment/glb-io.mjs";
import {
  assertExpectedSourceHash,
  ELDERBOOM_V1_CONFIG,
} from "../scripts/environment/elderboom-v1.config.mjs";
import { syntheticDocument, withSyntheticGlb } from "./fixtures/synthetic-glb.js";

describe("bounded GLB intake", () => {
  it("reads the header and JSON without retaining BIN bytes", async () => {
    await withSyntheticGlb(async ({ file, json }) => {
      const document = await readGlbDocument(file);

      expect(document.json).toEqual(json);
      expect(document.binLength).toBe(40);
      expect(document.binOffset).toBeGreaterThan(document.jsonChunkLength);
      expect(document.totalLength).toBeGreaterThan(document.binOffset);
      expect(document).not.toHaveProperty("bin");
    });
  });

  it("rejects invalid headers and truncated files", async () => {
    await withSyntheticGlb(async ({ file }) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(file, Buffer.alloc(12));
      await expect(readGlbDocument(file)).rejects.toThrow(/GLB|magic|length/i);
    });
  });
});

describe("GLB graph inspection", () => {
  it("walks nested world transforms and transforms accessor bounds", () => {
    const json = syntheticDocument();
    const transforms = walkNodeWorldTransforms(json);

    expect(transforms.get(2).elements[12]).toBeCloseTo(7);
    expect(nodeWorldBounds(json, 2, transforms.get(2))).toEqual({ min: [6, -1, -1], max: [8, 1, 1] });
  });

  it("collects complete mesh, sparse, texture-extension, image, and light references", () => {
    const json = syntheticDocument();
    const references = collectDocumentReferences(json, new Set([2]));

    expect(references.nodes).toEqual(new Set([0, 2]));
    expect(references.meshes).toEqual(new Set([0, 1]));
    expect(references.accessors).toEqual(new Set([0, 1]));
    expect(references.bufferViews).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(references.textures).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(references.images).toEqual(new Set([0]));
    expect(references.samplers).toEqual(new Set([0]));
    expect(references.lights).toEqual(new Set([0]));
  });

  it("accepts closed documents and rejects out-of-range references", () => {
    const json = syntheticDocument();
    expect(() => assertClosedDocument(json)).not.toThrow();

    const broken = structuredClone(json);
    broken.textures[0].source = 99;
    expect(() => assertClosedDocument(broken)).toThrow(/texture|image|source|range/i);
  });
});

describe("ElderBoom v1 intake contract", () => {
  it("pins the exact source identity, western-core region, and immutable transform", () => {
    const config = ELDERBOOM_V1_CONFIG;

    expect(config.source.defaultPath).toBe("D:\\3d资产\\ElderBoomHollow\\source\\elderbloom_hollow.glb");
    expect(config.source.bytes).toBe(936_886_692);
    expect(config.source.sha256).toBe("0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB");
    expect(config.selection.bounds).toEqual({ min: [-10, -2, 12], max: [25, 30, 48] });
    expect(config.rootTransform.position).toEqual([-7.5, -1, -30]);
    expect(Object.isFrozen(config.selection.bounds.min)).toBe(true);
    expect(() => { config.selection.bounds.min[0] = 0; }).toThrow(TypeError);
    expect(() => assertExpectedSourceHash("BAD", config)).toThrow(/source hash/i);
    expect(assertExpectedSourceHash(config.source.sha256.toLowerCase(), config)).toBe(true);
  });
});
