import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPerformanceGates,
  assertRequiredExtensions,
  compareRetainedImages,
  deriveArtifactMetrics,
  assertDeterministicDocument,
} from "../scripts/verify-elderboom-village.mjs";
import { readGlbDocument } from "../scripts/environment/glb-io.mjs";
import { createGlb, syntheticDocument, withSyntheticGlb } from "./fixtures/synthetic-glb.js";

const REQUIRED_EXTENSIONS = [
  "KHR_materials_specular",
  "KHR_materials_sheen",
  "KHR_materials_anisotropy",
  "KHR_texture_transform",
  "EXT_mesh_gpu_instancing",
];

function documentWithEmbeddedPng() {
  const json = syntheticDocument();
  json.bufferViews[4] = { buffer: 0, byteOffset: 36, byteLength: 28 };
  json.buffers[0].byteLength = 64;
  json.nodes[1].extensions = {
    EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } },
  };
  json.extensionsUsed.push("EXT_mesh_gpu_instancing");
  return json;
}

function embeddedPngBin({ changed = false } = {}) {
  const bin = Buffer.alloc(64, 0x5a);
  const png = Buffer.alloc(28);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(32, 20);
  if (changed) png[27] ^= 0x01;
  png.copy(bin, 36);
  return bin;
}

describe("ElderBoom village asset verifier", () => {
  it("accepts JSON-equivalent deterministic output and rejects changed resources", () => {
    const expected = { nodes: [{ translation: [-0, 1, 2] }] };
    const actual = { nodes: [{ translation: [0, 1, 2] }] };
    expect(() => assertDeterministicDocument(actual, expected)).not.toThrow();
    actual.nodes[0].translation[2] = 3;
    expect(() => assertDeterministicDocument(actual, expected)).toThrow(/JSON structure/i);
  });

  it("requires every retained material extension and GPU instancing", () => {
    const json = documentWithEmbeddedPng();

    expect(() => assertRequiredExtensions(json, REQUIRED_EXTENSIONS)).not.toThrow();
    json.extensionsUsed = json.extensionsUsed.filter((name) => name !== "KHR_materials_sheen");
    expect(() => assertRequiredExtensions(json, REQUIRED_EXTENSIONS)).toThrow(/KHR_materials_sheen/);
  });

  it("derives real draw, triangle, image, and instance metrics before applying gates", () => {
    const json = documentWithEmbeddedPng();
    const metrics = deriveArtifactMetrics(json);

    expect(metrics).toMatchObject({
      renderNodes: 3,
      drawCalls: 3,
      expandedTriangles: 3,
      images: 1,
      materials: 1,
      textures: 8,
      instancingGroups: 1,
      instances: 2,
    });
    expect(() => assertPerformanceGates({ ...metrics, texels: 100, maxColorDimension: 1, maxDataDimension: 1 }, 64 * 1024 * 1024)).not.toThrow();
    expect(() => assertPerformanceGates({ ...metrics, drawCalls: 450, texels: 100, maxColorDimension: 1, maxDataDimension: 1 }, 64 * 1024 * 1024)).toThrow(/draw calls/i);
  });

  it("compares retained embedded image dimensions and bytes against the source", async () => {
    const json = documentWithEmbeddedPng();
    await withSyntheticGlb(async ({ directory, file }) => {
      const matchingPath = path.join(directory, "matching.glb");
      const changedPath = path.join(directory, "changed.glb");
      await writeFile(matchingPath, createGlb(json, embeddedPngBin()));
      await writeFile(changedPath, createGlb(json, embeddedPngBin({ changed: true })));
      const sourceDocument = await readGlbDocument(file);
      const matchingDocument = await readGlbDocument(matchingPath);
      const changedDocument = await readGlbDocument(changedPath);

      await expect(compareRetainedImages({
        sourcePath: file,
        sourceDocument,
        artifactPath: matchingPath,
        artifactDocument: matchingDocument,
        sourceImageIndices: [0],
      })).resolves.toEqual({ images: 1, embeddedBytes: 28, dimensions: [{ width: 64, height: 32 }] });

      await expect(compareRetainedImages({
        sourcePath: file,
        sourceDocument,
        artifactPath: changedPath,
        artifactDocument: changedDocument,
        sourceImageIndices: [0],
      })).rejects.toThrow(/image 0.*bytes/i);
    }, { json, bin: embeddedPngBin() });
  });
});
