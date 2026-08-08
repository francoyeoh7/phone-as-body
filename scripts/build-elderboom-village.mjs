import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ELDERBOOM_V1_CONFIG, assertExpectedSourceHash } from "./environment/elderboom-v1.config.mjs";
import { collectDocumentReferences, nodeWorldBounds, walkNodeWorldTransforms } from "./environment/glb-graph.mjs";
import { readGlbDocument } from "./environment/glb-io.mjs";

const intersects = (bounds, selection) => bounds && [0, 1, 2].every(
  (axis) => bounds.max[axis] >= selection.min[axis] && bounds.min[axis] <= selection.max[axis],
);

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

export async function inspectVillageSource({ sourcePath = ELDERBOOM_V1_CONFIG.source.defaultPath } = {}) {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.size !== ELDERBOOM_V1_CONFIG.source.bytes) {
    throw new Error(`Village source byte length mismatch: expected ${ELDERBOOM_V1_CONFIG.source.bytes}, received ${sourceStat.size}`);
  }
  const sourceSha256 = await sha256File(sourcePath);
  assertExpectedSourceHash(sourceSha256);
  const document = await readGlbDocument(sourcePath);
  const { json } = document;
  const transforms = walkNodeWorldTransforms(json);
  const selected = new Set();
  for (let index = 0; index < (json.nodes?.length ?? 0); index += 1) {
    const node = json.nodes[index];
    if (!Number.isInteger(node?.mesh)) continue;
    if (ELDERBOOM_V1_CONFIG.excludeNamePatterns.some((pattern) => pattern.test(node.name ?? ""))) continue;
    if (intersects(nodeWorldBounds(json, index, transforms.get(index)), ELDERBOOM_V1_CONFIG.selection.bounds)) selected.add(index);
  }
  const references = collectDocumentReferences(json, selected);
  const expandedPrimitives = [...selected].reduce(
    (count, nodeIndex) => count + (json.meshes?.[json.nodes[nodeIndex]?.mesh]?.primitives?.length ?? 0),
    0,
  );
  return {
    source: { path: sourcePath, bytes: sourceStat.size, sha256: sourceSha256 },
    scene: json.scenes?.[json.scene ?? 0]?.name ?? null,
    totals: {
      nodes: json.nodes?.length ?? 0,
      meshes: json.meshes?.length ?? 0,
      primitives: (json.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives?.length ?? 0), 0),
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      images: json.images?.length ?? 0,
    },
    westernCore: {
      bounds: ELDERBOOM_V1_CONFIG.selection.bounds,
      meshNodes: selected.size,
      referencedNodes: references.nodes.size,
      meshes: references.meshes.size,
      expandedPrimitives,
      materials: references.materials.size,
      textures: references.textures.size,
      images: references.images.size,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--inspect")) throw new Error("Only the read-only --inspect command is implemented");
  const sourceIndex = args.indexOf("--source");
  const sourcePath = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
  const report = await inspectVillageSource({ sourcePath });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
