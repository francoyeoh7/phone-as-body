import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { validateEnvironmentManifest } from "../src/desktop/environment/manifest.js";
import { buildSubsetDocument, selectSpatialNodes } from "./build-elderboom-village.mjs";
import {
  ELDERBOOM_V1_CONFIG,
  villageGatesForQuality,
  villageQualityProfile,
} from "./environment/elderboom-v1.config.mjs";
import { assertClosedDocument, collectDocumentReferences } from "./environment/glb-graph.mjs";
import { readGlbDocument } from "./environment/glb-io.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPY_BUFFER_BYTES = 1024 * 1024;
const BASE_REQUIRED_EXTENSIONS = Object.freeze([
  "KHR_materials_specular",
  "KHR_materials_sheen",
  "KHR_materials_anisotropy",
  "KHR_texture_transform",
  "EXT_mesh_gpu_instancing",
]);

export function requiredExtensionsForQuality(quality) {
  const profile = villageQualityProfile(quality);
  return profile.encoding === "webp"
    ? [...BASE_REQUIRED_EXTENSIONS, "EXT_texture_webp"]
    : [...BASE_REQUIRED_EXTENSIONS];
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Village verification failed: ${message}`);
}

function sameNumber(actual, expected, label) {
  invariant(actual === expected, `${label} mismatch: expected ${expected}, received ${actual}`);
}

function sameArray(actual, expected, label, epsilon = 1e-6) {
  invariant(Array.isArray(actual) && actual.length === expected.length, `${label} has the wrong shape`);
  for (let index = 0; index < expected.length; index += 1) {
    invariant(
      Number.isFinite(actual[index]) && Math.abs(actual[index] - expected[index]) <= epsilon,
      `${label}[${index}] mismatch: expected ${expected[index]}, received ${actual[index]}`,
    );
  }
}

function primitiveTriangles(json, meshIndex) {
  return (json.meshes?.[meshIndex]?.primitives ?? []).reduce((sum, primitive) => {
    const accessorIndex = Number.isInteger(primitive.indices)
      ? primitive.indices
      : primitive.attributes?.POSITION;
    const count = json.accessors?.[accessorIndex]?.count ?? 0;
    const mode = primitive.mode ?? 4;
    if (mode === 4) return sum + Math.floor(count / 3);
    if (mode === 5 || mode === 6) return sum + Math.max(0, count - 2);
    return sum;
  }, 0);
}

function instanceCount(json, node, label) {
  const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attributes) return 1;
  const accessorIndices = Object.values(attributes);
  invariant(accessorIndices.length > 0, `${label} has no instance attributes`);
  const counts = accessorIndices.map((index) => json.accessors?.[index]?.count);
  invariant(counts.every((count) => Number.isSafeInteger(count) && count > 0), `${label} has an invalid instance count`);
  invariant(counts.every((count) => count === counts[0]), `${label} instance attribute counts differ`);
  return counts[0];
}

export function deriveArtifactMetrics(json) {
  const renderNodes = (json.nodes ?? []).filter((node) => Number.isInteger(node?.mesh));
  let drawCalls = 0;
  let expandedTriangles = 0;
  let instances = 0;
  let instancingGroups = 0;
  for (const [index, node] of renderNodes.entries()) {
    const mesh = json.meshes?.[node.mesh];
    invariant(mesh, `render node ${index} references a missing mesh`);
    const count = instanceCount(json, node, `render node ${index}`);
    drawCalls += mesh.primitives?.length ?? 0;
    expandedTriangles += primitiveTriangles(json, node.mesh) * count;
    if (node.extensions?.EXT_mesh_gpu_instancing) {
      instancingGroups += 1;
      instances += count;
    }
  }
  return {
    renderNodes: renderNodes.length,
    drawCalls,
    expandedTriangles,
    images: json.images?.length ?? 0,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    instances,
    instancingGroups,
  };
}

export function assertPerformanceGates(
  metrics,
  artifactBytes,
  gates = villageGatesForQuality(ELDERBOOM_V1_CONFIG.defaultQuality),
) {
  const failures = [];
  if (metrics.renderNodes >= gates.maxRenderNodesExclusive) failures.push(`render nodes ${metrics.renderNodes} >= ${gates.maxRenderNodesExclusive}`);
  if (metrics.drawCalls >= gates.maxDrawCallsExclusive) failures.push(`draw calls ${metrics.drawCalls} >= ${gates.maxDrawCallsExclusive}`);
  if (metrics.expandedTriangles >= gates.maxExpandedTrianglesExclusive) {
    failures.push(`expanded triangles ${metrics.expandedTriangles} >= ${gates.maxExpandedTrianglesExclusive}`);
  }
  if (metrics.images > gates.maxImages) failures.push(`images ${metrics.images} > ${gates.maxImages}`);
  if (metrics.texels > gates.maxTextureTexels) failures.push(`texture texels ${metrics.texels} > ${gates.maxTextureTexels}`);
  if (metrics.maxColorDimension > gates.maxColorDimension) failures.push(`color texture dimension ${metrics.maxColorDimension} > ${gates.maxColorDimension}`);
  if (metrics.maxDataDimension > gates.maxDataDimension) failures.push(`data texture dimension ${metrics.maxDataDimension} > ${gates.maxDataDimension}`);
  if (artifactBytes < gates.minArtifactBytes || artifactBytes > gates.maxArtifactBytes) {
    failures.push(`artifact bytes ${artifactBytes} outside ${gates.minArtifactBytes}..${gates.maxArtifactBytes}`);
  }
  invariant(failures.length === 0, `performance gates: ${failures.join(", ")}`);
  return true;
}

export function assertRequiredExtensions(json, required = requiredExtensionsForQuality(ELDERBOOM_V1_CONFIG.defaultQuality)) {
  const used = new Set(json.extensionsUsed ?? []);
  for (const extension of required) invariant(used.has(extension), `missing required extension ${extension}`);
  invariant(
    (json.nodes ?? []).some((node) => node.extensions?.EXT_mesh_gpu_instancing),
    "EXT_mesh_gpu_instancing is declared but unused",
  );
  return true;
}

export function assertDeterministicDocument(actual, expected) {
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    "artifact JSON structure differs from the deterministic source selection",
  );
  return true;
}

function assertGpuInstancing(json) {
  let groups = 0;
  for (const [nodeIndex, node] of (json.nodes ?? []).entries()) {
    const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (!attributes) continue;
    groups += 1;
    const expected = { TRANSLATION: "VEC3", ROTATION: "VEC4", SCALE: "VEC3" };
    for (const [semantic, type] of Object.entries(expected)) {
      const accessor = json.accessors?.[attributes[semantic]];
      invariant(accessor, `instance node ${nodeIndex} is missing ${semantic}`);
      invariant(accessor.componentType === 5126, `instance node ${nodeIndex} ${semantic} is not FLOAT`);
      invariant(accessor.type === type, `instance node ${nodeIndex} ${semantic} is not ${type}`);
    }
    instanceCount(json, node, `instance node ${nodeIndex}`);
  }
  invariant(groups > 0, "artifact has no GPU instancing groups");
}

function assertBufferLayout(document, label) {
  const { json, binLength } = document;
  invariant(Array.isArray(json.buffers) && json.buffers.length === 1, `${label} must have one embedded buffer`);
  const buffer = json.buffers[0];
  invariant(buffer.uri === undefined, `${label} contains an external buffer URI`);
  invariant(Number.isSafeInteger(buffer.byteLength) && buffer.byteLength >= 0, `${label} buffer length is invalid`);
  invariant(binLength >= buffer.byteLength && binLength - buffer.byteLength <= 3, `${label} BIN padding/length is invalid`);
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    const offset = view.byteOffset ?? 0;
    invariant(view.buffer === 0, `${label} bufferView ${index} does not reference buffer 0`);
    invariant(Number.isSafeInteger(offset) && offset >= 0, `${label} bufferView ${index} offset is invalid`);
    invariant(Number.isSafeInteger(view.byteLength) && view.byteLength >= 0, `${label} bufferView ${index} length is invalid`);
    invariant(offset + view.byteLength <= buffer.byteLength, `${label} bufferView ${index} exceeds the BIN buffer`);
  }
}

async function readExact(handle, length, position, label) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    invariant(bytesRead > 0, `${label} is truncated`);
    offset += bytesRead;
  }
  return buffer;
}

function pngDimensions(bytes, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  invariant(bytes.length >= 24 && bytes.subarray(0, 8).equals(signature), `${label} is not a PNG`);
  invariant(bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR", `${label} has no PNG IHDR`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  invariant(width > 0 && height > 0, `${label} has invalid PNG dimensions`);
  return { width, height };
}

function imageView(document, image, label) {
  invariant(image?.uri === undefined, `${label} uses an external URI`);
  invariant(image?.mimeType === "image/png", `${label} must retain embedded image/png data`);
  const view = document.json.bufferViews?.[image.bufferView];
  invariant(view, `${label} has no embedded bufferView`);
  return {
    position: document.binOffset + (view.byteOffset ?? 0),
    byteLength: view.byteLength,
  };
}

async function equalFileSegments(sourceHandle, sourcePosition, artifactHandle, artifactPosition, byteLength) {
  const sourceBuffer = Buffer.alloc(Math.min(COPY_BUFFER_BYTES, byteLength));
  const artifactBuffer = Buffer.alloc(sourceBuffer.length);
  let compared = 0;
  while (compared < byteLength) {
    const length = Math.min(sourceBuffer.length, byteLength - compared);
    const sourceRead = await sourceHandle.read(sourceBuffer, 0, length, sourcePosition + compared);
    const artifactRead = await artifactHandle.read(artifactBuffer, 0, length, artifactPosition + compared);
    if (sourceRead.bytesRead !== length || artifactRead.bytesRead !== length) return false;
    if (!sourceBuffer.subarray(0, length).equals(artifactBuffer.subarray(0, length))) return false;
    compared += length;
  }
  return true;
}

function imageMetadata(image) {
  const metadata = { ...image };
  delete metadata.bufferView;
  return metadata;
}

export async function compareRetainedImages({
  sourcePath,
  sourceDocument,
  artifactPath,
  artifactDocument,
  sourceImageIndices,
}) {
  const artifactImages = artifactDocument.json.images ?? [];
  invariant(artifactImages.length === sourceImageIndices.length, `retained image count ${artifactImages.length} does not match selected source count ${sourceImageIndices.length}`);
  const sourceHandle = await open(sourcePath, "r");
  const artifactHandle = await open(artifactPath, "r");
  let embeddedBytes = 0;
  const dimensions = [];
  try {
    for (let outputIndex = 0; outputIndex < artifactImages.length; outputIndex += 1) {
      const sourceIndex = sourceImageIndices[outputIndex];
      const sourceImage = sourceDocument.json.images?.[sourceIndex];
      const artifactImage = artifactImages[outputIndex];
      invariant(sourceImage, `selected source image ${sourceIndex} is missing`);
      invariant(
        isDeepStrictEqual(imageMetadata(artifactImage), imageMetadata(sourceImage)),
        `retained image ${outputIndex} metadata differs from source image ${sourceIndex}`,
      );
      const sourceView = imageView(sourceDocument, sourceImage, `source image ${sourceIndex}`);
      const artifactView = imageView(artifactDocument, artifactImage, `retained image ${outputIndex}`);
      sameNumber(artifactView.byteLength, sourceView.byteLength, `retained image ${outputIndex} byte length`);
      invariant(sourceView.byteLength >= 24, `source image ${sourceIndex} is too short for a PNG header`);
      const sourceHeader = await readExact(sourceHandle, 24, sourceView.position, `source image ${sourceIndex}`);
      const artifactHeader = await readExact(artifactHandle, 24, artifactView.position, `retained image ${outputIndex}`);
      const sourceDimensions = pngDimensions(sourceHeader, `source image ${sourceIndex}`);
      const artifactDimensions = pngDimensions(artifactHeader, `retained image ${outputIndex}`);
      invariant(
        isDeepStrictEqual(artifactDimensions, sourceDimensions),
        `retained image ${outputIndex} dimensions differ from source image ${sourceIndex}`,
      );
      invariant(
        await equalFileSegments(sourceHandle, sourceView.position, artifactHandle, artifactView.position, sourceView.byteLength),
        `retained image ${outputIndex} bytes differ from source image ${sourceIndex}`,
      );
      embeddedBytes += sourceView.byteLength;
      dimensions.push(sourceDimensions);
    }
  } finally {
    await Promise.all([sourceHandle.close(), artifactHandle.close()]);
  }
  return { images: artifactImages.length, embeddedBytes, dimensions };
}

async function hashFile(filePath, forbiddenNeedles = []) {
  const hash = createHash("sha256");
  const needles = forbiddenNeedles.map((value) => Buffer.from(value, "utf8")).filter((value) => value.length > 0);
  const overlap = Math.max(0, ...needles.map((value) => value.length - 1));
  let tail = Buffer.alloc(0);
  let bytes = 0;
  let leaked = null;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
    if (!leaked && needles.length > 0) {
      const searchable = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
      leaked = needles.find((needle) => searchable.indexOf(needle) >= 0) ?? null;
      tail = overlap > 0 ? searchable.subarray(Math.max(0, searchable.length - overlap)) : Buffer.alloc(0);
    }
  }
  return { bytes, sha256: hash.digest("hex").toUpperCase(), leaked: leaked?.toString("utf8") ?? null };
}

function transformedBounds(bounds, transform) {
  const matrix = new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion(...transform.rotation).normalize(),
    new Vector3(...transform.scale),
  );
  const result = new Box3();
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) result.expandByPoint(new Vector3(x, y, z).applyMatrix4(matrix));
    }
  }
  return { min: result.min.toArray(), max: result.max.toArray() };
}

function assertManifestBounds(manifest, config) {
  sameArray(manifest.rootTransform.position, config.rootTransform.position, "manifest root position");
  sameArray(manifest.rootTransform.rotation, config.rootTransform.rotation, "manifest root rotation");
  sameArray(manifest.rootTransform.scale, config.rootTransform.scale, "manifest root scale");
  const expected = transformedBounds(config.selection.bounds, config.rootTransform);
  for (const chunk of manifest.chunks) {
    sameArray(chunk.bounds.min, expected.min, `manifest chunk ${chunk.id} minimum bounds`);
    sameArray(chunk.bounds.max, expected.max, `manifest chunk ${chunk.id} maximum bounds`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    invariant(manifest.playableBounds.min[axis] >= expected.min[axis], `playable minimum axis ${axis} exceeds the selected chunk`);
    invariant(manifest.playableBounds.max[axis] <= expected.max[axis], `playable maximum axis ${axis} exceeds the selected chunk`);
  }
}

function assertInspectionReport(report, { sourceIdentity, sourceDocument, selection, references }) {
  invariant(report?.version === 2, "build report version must be 2");
  sameNumber(report.inspection?.source?.bytes, sourceIdentity.bytes, "report source bytes");
  invariant(String(report.inspection?.source?.sha256).toUpperCase() === sourceIdentity.sha256, "report source SHA-256 mismatch");
  const sourceJson = sourceDocument.json;
  const expectedTotals = {
    nodes: sourceJson.nodes?.length ?? 0,
    meshes: sourceJson.meshes?.length ?? 0,
    primitives: (sourceJson.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives?.length ?? 0), 0),
    materials: sourceJson.materials?.length ?? 0,
    textures: sourceJson.textures?.length ?? 0,
    images: sourceJson.images?.length ?? 0,
  };
  for (const [key, value] of Object.entries(expectedTotals)) sameNumber(report.inspection?.totals?.[key], value, `report source ${key}`);
  const expectedScene = sourceJson.scenes?.[sourceJson.scene ?? 0]?.name ?? null;
  invariant(report.inspection?.scene === expectedScene, `report source scene mismatch: expected ${expectedScene}`);
  sameArray(report.inspection?.selection?.bounds?.min, ELDERBOOM_V1_CONFIG.selection.bounds.min, "report selection minimum");
  sameArray(report.inspection?.selection?.bounds?.max, ELDERBOOM_V1_CONFIG.selection.bounds.max, "report selection maximum");
  const expectedSelection = {
    meshNodes: selection.selectedNodes.size,
    referencedNodes: references.nodes.size,
    meshes: references.meshes.size,
    expandedPrimitives: [...selection.selectedNodes].reduce(
      (sum, index) => sum + (sourceJson.meshes?.[sourceJson.nodes?.[index]?.mesh]?.primitives?.length ?? 0),
      0,
    ),
    materials: references.materials.size,
    textures: references.textures.size,
    images: references.images.size,
    denseFoliageCandidates: selection.metrics.denseFoliageCandidates,
    denseFoliageRetained: selection.metrics.denseFoliageRetained,
  };
  for (const [key, value] of Object.entries(expectedSelection)) sameNumber(report.inspection?.selection?.[key], value, `report selection ${key}`);
}

function assertChunkReport(chunkReport, { chunk, artifactIdentity, artifactDocument, sourceDocument, selection, actualMetrics }) {
  invariant(chunkReport, `build report is missing chunk ${chunk.id}`);
  invariant(chunkReport.id === chunk.id, `build report chunk id mismatch: expected ${chunk.id}`);
  invariant(chunkReport.quality === chunk.quality, `build report chunk ${chunk.id} quality mismatch`);
  sameNumber(chunkReport.artifact?.bytes, artifactIdentity.bytes, `report chunk ${chunk.id} bytes`);
  invariant(String(chunkReport.artifact?.sha256).toUpperCase() === artifactIdentity.sha256, `report chunk ${chunk.id} SHA-256 mismatch`);
  const sourceJson = sourceDocument.json;
  const sourceSelectedDrawCalls = [...selection.selectedNodes].reduce(
    (sum, index) => sum + (sourceJson.meshes?.[sourceJson.nodes?.[index]?.mesh]?.primitives?.length ?? 0),
    0,
  );
  const expectedMetrics = {
    meshCandidates: selection.metrics.meshCandidates,
    denseFoliageCandidates: selection.metrics.denseFoliageCandidates,
    denseFoliageRetained: selection.metrics.denseFoliageRetained,
    selectedMeshNodes: selection.selectedNodes.size,
    retainedNodes: artifactDocument.json.nodes?.length ?? 0,
    sourceSelectedDrawCalls,
    ...actualMetrics,
  };
  for (const [key, value] of Object.entries(expectedMetrics)) sameNumber(chunkReport.metrics?.[key], value, `report chunk ${chunk.id} metric ${key}`);
}

function artifactPathFromChunk(chunk) {
  invariant(chunk.url.startsWith("/assets/"), `chunk ${chunk.id} has a non-local URL`);
  const relative = chunk.url.slice(1).replaceAll("/", path.sep);
  const resolved = path.resolve(REPO_ROOT, "public", relative);
  const assetsRoot = path.resolve(REPO_ROOT, "public", "assets");
  invariant(resolved.startsWith(`${assetsRoot}${path.sep}`), `chunk ${chunk.id} resolves outside public/assets`);
  return resolved;
}

export async function verifyVillageAssets({ sourcePath = ELDERBOOM_V1_CONFIG.source.defaultPath } = {}) {
  const manifestPath = path.resolve(REPO_ROOT, ELDERBOOM_V1_CONFIG.outputs.manifest);
  const reportPath = path.resolve(REPO_ROOT, ELDERBOOM_V1_CONFIG.outputs.report);
  const manifest = validateEnvironmentManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const configuredChunks = ELDERBOOM_V1_CONFIG.chunks;
  invariant(manifest.chunks.length === configuredChunks.length, "manifest must contain every configured quality chunk");
  const configuredById = new Map(configuredChunks.map((entry) => [entry.id, entry]));
  for (const chunk of manifest.chunks) {
    const configured = configuredById.get(chunk.id);
    invariant(configured, `manifest chunk ${chunk.id} is not a configured quality chunk`);
    invariant(chunk.quality === configured.quality, `manifest chunk ${chunk.id} quality does not match configuration`);
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const [sourceStat] = await Promise.all([stat(sourcePath)]);
  sameNumber(sourceStat.size, ELDERBOOM_V1_CONFIG.source.bytes, "source byte length");
  const forbiddenPaths = [sourcePath, sourcePath.replaceAll("\\", "/")];
  const sourceIdentity = await hashFile(sourcePath);
  invariant(sourceIdentity.sha256 === ELDERBOOM_V1_CONFIG.source.sha256, `source SHA-256 mismatch: received ${sourceIdentity.sha256}`);

  const sourceDocument = await readGlbDocument(sourcePath);
  assertBufferLayout(sourceDocument, "source GLB");
  assertManifestBounds(manifest, ELDERBOOM_V1_CONFIG);
  const selection = selectSpatialNodes(sourceDocument.json, ELDERBOOM_V1_CONFIG);
  const references = collectDocumentReferences(sourceDocument.json, selection.selectedNodes);
  const expectedSubset = buildSubsetDocument(sourceDocument, selection, ELDERBOOM_V1_CONFIG);
  assertInspectionReport(report, { sourceIdentity, sourceDocument, selection, references });

  const chunkResults = [];
  for (const chunk of manifest.chunks) {
    const artifactPath = artifactPathFromChunk(chunk);
    const artifactStat = await stat(artifactPath);
    const artifactIdentity = await hashFile(artifactPath, forbiddenPaths);
    sameNumber(artifactStat.size, chunk.artifact.bytes, `chunk ${chunk.id} manifest artifact byte length`);
    sameNumber(artifactIdentity.bytes, chunk.artifact.bytes, `chunk ${chunk.id} hashed artifact byte length`);
    invariant(artifactIdentity.sha256 === chunk.artifact.sha256, `chunk ${chunk.id} manifest artifact SHA-256 mismatch: received ${artifactIdentity.sha256}`);
    invariant(!artifactIdentity.leaked, `chunk ${chunk.id} leaks source path ${artifactIdentity.leaked}`);
    invariant(path.resolve(sourcePath) !== path.resolve(artifactPath), "source and artifact paths are identical");
    invariant(artifactIdentity.bytes < sourceIdentity.bytes, `chunk ${chunk.id} is not smaller than the complete source GLB`);
    invariant(artifactIdentity.sha256 !== sourceIdentity.sha256, `chunk ${chunk.id} is a complete source copy`);

    const artifactDocument = await readGlbDocument(artifactPath);
    assertBufferLayout(artifactDocument, `chunk ${chunk.id} GLB`);
    assertClosedDocument(artifactDocument.json);
    assertRequiredExtensions(artifactDocument.json, requiredExtensionsForQuality(chunk.quality));
    assertGpuInstancing(artifactDocument.json);
    const artifactJsonText = JSON.stringify(artifactDocument.json);
    invariant(!/[A-Za-z]:[\\/]/u.test(artifactJsonText) && !/file:\/\//iu.test(artifactJsonText), `chunk ${chunk.id} JSON contains an absolute source path`);

    const profile = villageQualityProfile(chunk.quality);
    const optimizedImages = (artifactDocument.json.images ?? []).every((image) => image.mimeType === "image/webp");
    invariant(optimizedImages === (profile.encoding === "webp"), `chunk ${chunk.id} texture encoding does not match its quality profile`);
    if (!optimizedImages) assertDeterministicDocument(artifactDocument.json, expectedSubset.json);
    sameNumber(artifactDocument.json.meshes?.length ?? 0, references.meshes.size, `chunk ${chunk.id} retained mesh count`);
    sameNumber(artifactDocument.json.materials?.length ?? 0, references.materials.size, `chunk ${chunk.id} retained material count`);
    sameNumber(artifactDocument.json.textures?.length ?? 0, references.textures.size, `chunk ${chunk.id} retained texture count`);
    sameNumber(artifactDocument.json.images?.length ?? 0, references.images.size, `chunk ${chunk.id} retained image count`);
    const imageComparison = optimizedImages
      ? { images: artifactDocument.json.images?.length ?? 0, embeddedBytes: 0, dimensions: [] }
      : await compareRetainedImages({
        sourcePath,
        sourceDocument,
        artifactPath,
        artifactDocument,
        sourceImageIndices: [...references.images].sort((a, b) => a - b),
      });
    const actualMetrics = deriveArtifactMetrics(artifactDocument.json);
    const chunkReport = (report.chunks ?? []).find((entry) => entry.id === chunk.id);
    const textureMetrics = {
      texels: chunkReport?.metrics?.texels ?? 0,
      maxColorDimension: chunkReport?.metrics?.maxColorDimension ?? 0,
      maxDataDimension: chunkReport?.metrics?.maxDataDimension ?? 0,
    };
    assertPerformanceGates({ ...actualMetrics, ...textureMetrics }, artifactIdentity.bytes, villageGatesForQuality(chunk.quality));
    assertChunkReport(chunkReport, {
      chunk,
      artifactIdentity,
      artifactDocument,
      sourceDocument,
      selection,
      actualMetrics: { ...actualMetrics, ...textureMetrics },
    });
    chunkResults.push({
      id: chunk.id,
      quality: chunk.quality,
      artifact: { path: artifactPath, ...artifactIdentity, leaked: undefined },
      retainedImages: imageComparison.images,
      retainedImageBytes: imageComparison.embeddedBytes,
      extensions: requiredExtensionsForQuality(chunk.quality),
      metrics: { ...actualMetrics, ...textureMetrics },
    });
  }

  return {
    status: "PASS",
    source: sourceIdentity,
    selection: {
      bounds: ELDERBOOM_V1_CONFIG.selection.bounds,
      selectedMeshNodes: selection.selectedNodes.size,
    },
    chunks: chunkResults,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf("--source");
  const sourcePath = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
  invariant(sourceIndex < 0 || sourcePath, "--source requires a file path");
  process.stdout.write(`${JSON.stringify(await verifyVillageAssets({ sourcePath }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
