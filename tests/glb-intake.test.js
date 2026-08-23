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
  VILLAGE_QUALITY_PROFILES,
} from "../scripts/environment/elderboom-v1.config.mjs";
import { repairVillageMaterials } from "../scripts/build-elderboom-village.mjs";
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
  it("pins the exact source identity, full-map region, and immutable transform", () => {
    const config = ELDERBOOM_V1_CONFIG;

    expect(config.source.defaultPath).toBe("D:\\3d资产\\ElderBoomHollow\\source\\elderbloom_hollow.glb");
    expect(config.source.bytes).toBe(936_886_692);
    expect(config.source.sha256).toBe("0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB");
    expect(config.selection.bounds).toEqual({ min: [-51, -1, -51], max: [102, 30, 102] });
    expect(config.rootTransform.position).toEqual([-7.5, -1, -30]);
    expect(Object.isFrozen(config.selection.bounds.min)).toBe(true);
    expect(() => { config.selection.bounds.min[0] = 0; }).toThrow(TypeError);
    expect(() => assertExpectedSourceHash("BAD", config)).toThrow(/source hash/i);
    expect(assertExpectedSourceHash(config.source.sha256.toLowerCase(), config)).toBe(true);
  });

  it("retains every dense foliage instance without thinning", () => {
    expect(ELDERBOOM_V1_CONFIG.foliage).toMatchObject({
      cellSize: 5,
      maxInstancesPerMeshPerCell: Number.MAX_SAFE_INTEGER,
      maxInstancesPerMesh: Number.MAX_SAFE_INTEGER,
      highPolyTriangleThreshold: 100_000,
      maxHighPolyInstancesPerMesh: Number.MAX_SAFE_INTEGER,
    });
  });

  it("defines one build chunk per runtime quality tier with balanced as default", () => {
    expect(ELDERBOOM_V1_CONFIG.defaultQuality).toBe("balanced");
    expect(ELDERBOOM_V1_CONFIG.chunks).toHaveLength(4);
    expect(ELDERBOOM_V1_CONFIG.chunks.map((chunk) => chunk.quality)).toEqual([
      "low", "balanced", "high", "ultra",
    ]);
    for (const chunk of ELDERBOOM_V1_CONFIG.chunks) {
      expect(chunk.id).toBe(`full-village-${chunk.quality}`);
    }
    expect(VILLAGE_QUALITY_PROFILES.balanced).toMatchObject({
      encoding: "webp",
      colorMax: 1536,
      dataMax: 768,
    });
    expect(VILLAGE_QUALITY_PROFILES.ultra).toMatchObject({ encoding: "original", webpQuality: null });
    expect(VILLAGE_QUALITY_PROFILES.ultra.colorMax).toBeGreaterThanOrEqual(8192);
  });

  it("repairs Unreal placeholder landscape, grass, and water materials", () => {
    const grassTemplate = {
      name: "MI_Grass_Clumps_rbojr_2K_S_Grass_Clumps_rbojr_Var1_lod1",
      pbrMetallicRoughness: {
        baseColorTexture: { index: 7, texCoord: 1 },
        metallicRoughnessTexture: { index: 8, texCoord: 1 },
      },
      normalTexture: { index: 9, texCoord: 1 },
      alphaMode: "MASK",
      alphaCutoff: 0.3333,
      doubleSided: true,
    };
    const alderTileableTemplate = {
      name: "MI_BlackAlder_Tileable_SM_BlackAlder_Field_04",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 96 } },
      alphaMode: "MASK",
      doubleSided: true,
    };
    const alderTwoSidedTemplate = {
      name: "MI_BlackAlder_TwoSided_SM_BlackAlder_Field_04",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 101 } },
      alphaMode: "MASK",
      doubleSided: true,
    };
    const materials = [
      { name: "LAndscapepaint", pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1] } },
      grassTemplate,
      {
        name: "MI_Grass_Clumps_rbojr_2K_S_Grass_Clumps_rbojr_Var1_lod9",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1] },
        alphaMode: "MASK",
      },
      {
        name: "M_Water_Ocean_Wall_400x244",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1], roughnessFactor: 0.1 },
      },
      { name: "untouched", pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } },
      alderTileableTemplate,
      alderTwoSidedTemplate,
      {
        name: "MI_BlackAlder_Tileable_SM_BlackAlder_Field_56",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1] },
        emissiveFactor: [1, 0, 1],
        alphaMode: "MASK",
      },
      {
        name: "MI_BlackAlder_TwoSided_SM_BlackAlder_Field_66",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1] },
        emissiveFactor: [1, 0, 1],
        alphaMode: "MASK",
      },
    ];

    expect(repairVillageMaterials(materials)).toEqual({ landscape: 1, grass: 1, water: 1, alder: 2 });
    expect(materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([0.18, 0.24, 0.12, 1]);
    expect(materials[2].pbrMetallicRoughness).toEqual(grassTemplate.pbrMetallicRoughness);
    expect(materials[2].normalTexture).toEqual(grassTemplate.normalTexture);
    expect(materials[2].pbrMetallicRoughness).not.toBe(grassTemplate.pbrMetallicRoughness);
    expect(materials[3]).toMatchObject({
      alphaMode: "BLEND",
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [0.08, 0.24, 0.32, 0.72],
        metallicFactor: 0,
        roughnessFactor: 0.18,
      },
    });
    expect(materials[4].pbrMetallicRoughness.baseColorFactor).toEqual([0.5, 0.5, 0.5, 1]);
    expect(materials[7]).toMatchObject({
      name: "MI_BlackAlder_Tileable_SM_BlackAlder_Field_56",
      alphaMode: "MASK",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 96 } },
    });
    expect(materials[7].emissiveFactor).toBeUndefined();
    expect(materials[8].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 101 });
    expect(materials[8].emissiveFactor).toBeUndefined();
  });

  it("falls back to a dark leaf color when no textured alder template survives", () => {
    const materials = [
      {
        name: "MI_BlackAlder_Tileable_SM_BlackAlder_Field_56",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1] },
        emissiveFactor: [1, 0, 1],
        alphaMode: "MASK",
      },
    ];

    expect(repairVillageMaterials(materials)).toEqual({ landscape: 0, grass: 0, water: 0, alder: 1 });
    expect(materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([0.16, 0.3, 0.14, 1]);
    expect(materials[0].emissiveFactor).toEqual([0, 0, 0]);
    expect(materials[0].alphaMode).toBe("MASK");
  });
});
