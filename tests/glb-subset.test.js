import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSubsetDocument,
  selectSpatialNodes,
  writeGlbStream,
} from "../scripts/build-elderboom-village.mjs";
import { assertClosedDocument } from "../scripts/environment/glb-graph.mjs";
import { readGlbDocument } from "../scripts/environment/glb-io.mjs";
import { syntheticDocument, withSyntheticGlb } from "./fixtures/synthetic-glb.js";

function fixtureConfig(overrides = {}) {
  return {
    selection: { bounds: { min: [3.5, -2, -2], max: [9, 2, 2] } },
    excludeNamePatterns: [],
    foliage: {
      seed: "fixture-seed",
      denseNamePatterns: [/^Foliage:/],
      cellSize: 4,
      maxInstancesPerMeshPerCell: 2,
    },
    ...overrides,
  };
}

function repeatedDocument() {
  const json = syntheticDocument();
  json.nodes.push(
    { name: "Foliage:a", translation: [0.1, 0, 0], mesh: 1 },
    { name: "Foliage:b", translation: [0.2, 0, 0], mesh: 1 },
    { name: "Foliage:c", translation: [0.3, 0, 0], mesh: 1 },
  );
  json.nodes[0].children.push(4, 5, 6);
  return json;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readAccessorFloats(glb, accessorIndex) {
  const accessor = glb.json.accessors[accessorIndex];
  const view = glb.json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const start = glb.binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from(new Float32Array(
    glb.bytes.buffer,
    glb.bytes.byteOffset + start,
    accessor.count * components,
  ));
}

describe("deterministic GLB subset", () => {
  it("selects transformed mesh bounds and deterministically thins only dense foliage", () => {
    const json = repeatedDocument();
    json.nodes[1].translation = [20, 0, 0];
    json.accessors[0].min = [-12, -1, -1];
    json.accessors[0].max = [1, 1, 1];
    const config = fixtureConfig();

    const first = selectSpatialNodes(json, config);
    const second = selectSpatialNodes(json, config);

    expect(first.selectedNodes).toEqual(second.selectedNodes);
    expect(first.selectedNodes.has(1)).toBe(true);
    expect([...first.selectedNodes].filter((index) => json.nodes[index].name.startsWith("Foliage:"))).toHaveLength(2);
    expect(first.metrics.denseFoliageCandidates).toBe(3);
    expect(first.metrics.denseFoliageRetained).toBe(2);
  });

  it("writes a closed, aligned, deterministic subset with exact images and GPU instances", async () => {
    const json = repeatedDocument();
    await withSyntheticGlb(async ({ directory, file }) => {
      const source = await readGlbDocument(file);
      source.json = json;
      const selection = selectSpatialNodes(json, fixtureConfig());
      const firstSubset = buildSubsetDocument(source, selection);
      const secondSubset = buildSubsetDocument(source, selection);
      const firstPath = path.join(directory, "first.glb");
      const secondPath = path.join(directory, "second.glb");

      await writeGlbStream(file, firstPath, firstSubset);
      await writeGlbStream(file, secondPath, secondSubset);
      const firstBytes = await readFile(firstPath);
      const secondBytes = await readFile(secondPath);
      const output = await readGlbDocument(firstPath);
      output.bytes = firstBytes;

      expect(digest(firstBytes)).toBe(digest(secondBytes));
      expect(() => assertClosedDocument(output.json)).not.toThrow();
      expect(output.json.extensionsUsed).toContain("EXT_mesh_gpu_instancing");
      expect(output.json.bufferViews.every((view) => (view.byteOffset ?? 0) % 4 === 0)).toBe(true);
      expect(firstSubset.metrics.drawCalls).toBeLessThan(firstSubset.metrics.sourceSelectedDrawCalls);

      const instanceNode = output.json.nodes.find((node) => node.extensions?.EXT_mesh_gpu_instancing);
      expect(instanceNode).toBeDefined();
      const translationAccessor = instanceNode.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION;
      const translations = readAccessorFloats(output, translationAccessor);
      const group = firstSubset.instancingGroups.find((entry) => entry.generatedNodeName === instanceNode.name);
      const expectedTranslations = group.sourceNodes.flatMap((index) => json.nodes[index].translation);
      expect(translations).toHaveLength(expectedTranslations.length);
      translations.forEach((value, index) => expect(value).toBeCloseTo(expectedTranslations[index], 6));

      const sourceView = json.bufferViews[json.images[0].bufferView];
      const outputView = output.json.bufferViews[output.json.images[0].bufferView];
      const sourceBytes = await readFile(file);
      const sourceImage = sourceBytes.subarray(source.binOffset + sourceView.byteOffset, source.binOffset + sourceView.byteOffset + sourceView.byteLength);
      const outputImage = firstBytes.subarray(output.binOffset + outputView.byteOffset, output.binOffset + outputView.byteOffset + outputView.byteLength);
      expect(outputImage).toEqual(sourceImage);

      const sparseAccessor = output.json.accessors.find((accessor) => accessor.sparse);
      expect(sparseAccessor.sparse.indices.bufferView).toBeTypeOf("number");
      expect(sparseAccessor.sparse.values.bufferView).toBeTypeOf("number");
    }, { json });
  });
});
