import { open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readGlbDocument } from "./glb-io.mjs";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const align4 = (value) => (value + 3) & ~3;
const COLOR_SLOTS = new Set(["baseColorTexture", "emissiveTexture"]);
const DATA_SLOTS = new Set([
  "normalTexture",
  "occlusionTexture",
  "metallicRoughnessTexture",
  "specularTexture",
  "sheenColorTexture",
  "sheenRoughnessTexture",
  "anisotropyTexture",
]);

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error(`Truncated GLB buffer at ${position}`);
    offset += bytesRead;
  }
  return buffer;
}

async function writeAll(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (bytesWritten === 0) throw new Error("Unable to write optimized GLB");
    offset += bytesWritten;
  }
}

function imageUsage(json) {
  const usage = (json.images ?? []).map(() => new Set());
  const add = (textureInfo, slot) => {
    const textureIndex = textureInfo?.index;
    const imageIndex = Number.isInteger(textureIndex) ? json.textures?.[textureIndex]?.source : undefined;
    if (Number.isInteger(imageIndex) && usage[imageIndex]) usage[imageIndex].add(slot);
  };
  for (const material of json.materials ?? []) {
    add(material.pbrMetallicRoughness?.baseColorTexture, "baseColorTexture");
    add(material.emissiveTexture, "emissiveTexture");
    add(material.normalTexture, "normalTexture");
    add(material.occlusionTexture, "occlusionTexture");
    add(material.pbrMetallicRoughness?.metallicRoughnessTexture, "metallicRoughnessTexture");
    add(material.extensions?.KHR_materials_specular?.specularTexture, "specularTexture");
    add(material.extensions?.KHR_materials_sheen?.sheenColorTexture, "sheenColorTexture");
    add(material.extensions?.KHR_materials_sheen?.sheenRoughnessTexture, "sheenRoughnessTexture");
    add(material.extensions?.KHR_materials_anisotropy?.anisotropyTexture, "anisotropyTexture");
  }
  return usage;
}

function capForUsage(slots, colorMax, dataMax) {
  return [...slots].some((slot) => DATA_SLOTS.has(slot)) ? dataMax : colorMax;
}

async function encodeWebp(bytes, maxDimension, quality) {
  const source = sharp(bytes, { limitInputPixels: false });
  const metadata = await source.metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const max = Math.max(width, height);
  const pipeline = max > maxDimension
    ? source.resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    : source;
  const encoded = await pipeline.webp({ quality, effort: 4 }).toBuffer();
  const encodedMetadata = await sharp(encoded, { limitInputPixels: false }).metadata();
  return {
    bytes: encoded,
    sourceWidth: width,
    sourceHeight: height,
    width: encodedMetadata.width ?? width,
    height: encodedMetadata.height ?? height,
  };
}

function glbParts(json, bin) {
  const jsonRaw = Buffer.from(JSON.stringify(json), "utf8");
  const jsonLength = align4(jsonRaw.length);
  const jsonBytes = Buffer.concat([jsonRaw, Buffer.alloc(jsonLength - jsonRaw.length, 0x20)]);
  const binLength = align4(bin.length);
  const totalLength = 12 + 8 + jsonLength + 8 + binLength;
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(totalLength, 8);
  header.writeUInt32LE(jsonLength, 12);
  header.writeUInt32LE(JSON_CHUNK, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binLength, 0);
  binHeader.writeUInt32LE(BIN_CHUNK, 4);
  return { header, jsonBytes, binHeader, binBytes: binLength === bin.length ? bin : Buffer.concat([bin, Buffer.alloc(binLength - bin.length)]) };
}

export async function inspectRuntimeTextures(document) {
  const usage = imageUsage(document.json);
  let texels = 0;
  let colorTexels = 0;
  let dataTexels = 0;
  let maxColorDimension = 0;
  let maxDataDimension = 0;
  const mimeTypes = new Set();
  const handle = await open(document.path, "r");
  try {
    for (let index = 0; index < (document.json.images ?? []).length; index += 1) {
      const image = document.json.images[index];
      const view = document.json.bufferViews?.[image.bufferView];
      if (!view || document.binOffset === null) continue;
      const bytes = await readAt(handle, document.binOffset + (view.byteOffset ?? 0), view.byteLength);
      const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
      const width = metadata.width ?? 1;
      const height = metadata.height ?? 1;
      const area = width * height;
      texels += area;
      mimeTypes.add(image.mimeType);
      if ([...usage[index]].some((slot) => DATA_SLOTS.has(slot))) {
        dataTexels += area;
        maxDataDimension = Math.max(maxDataDimension, width, height);
      } else {
        colorTexels += area;
        maxColorDimension = Math.max(maxColorDimension, width, height);
      }
    }
  } finally {
    await handle.close();
  }
  return { images: document.json.images?.length ?? 0, texels, colorTexels, dataTexels, maxColorDimension, maxDataDimension, mimeTypes: [...mimeTypes].sort() };
}

export async function optimizeVillageTextures({ inputPath, outputPath, colorMax = 1024, dataMax = 512, quality = 82 } = {}) {
  const document = await readGlbDocument(inputPath);
  document.path = inputPath;
  const input = await open(inputPath, "r");
  const usage = imageUsage(document.json);
  const imageByView = new Map();
  for (let index = 0; index < (document.json.images ?? []).length; index += 1) {
    const viewIndex = document.json.images[index]?.bufferView;
    if (Number.isInteger(viewIndex)) imageByView.set(viewIndex, index);
  }
  const outputViews = [];
  const outputImages = [];
  let binLength = 0;
  let texels = 0;
  let colorTexels = 0;
  let dataTexels = 0;
  let maxColorDimension = 0;
  let maxDataDimension = 0;
  try {
    for (let viewIndex = 0; viewIndex < (document.json.bufferViews ?? []).length; viewIndex += 1) {
      const alignedOffset = align4(binLength);
      if (alignedOffset > binLength) outputViews.push(Buffer.alloc(alignedOffset - binLength));
      binLength = alignedOffset;
      const view = document.json.bufferViews[viewIndex];
      const sourceBytes = await readAt(input, document.binOffset + (view.byteOffset ?? 0), view.byteLength);
      const imageIndex = imageByView.get(viewIndex);
      let bytes = sourceBytes;
      if (imageIndex !== undefined) {
        const cap = capForUsage(usage[imageIndex], colorMax, dataMax);
        const encoded = await encodeWebp(sourceBytes, cap, quality);
        bytes = encoded.bytes;
        const area = encoded.width * encoded.height;
        texels += area;
        if (cap === dataMax) {
          dataTexels += area;
          maxDataDimension = Math.max(maxDataDimension, encoded.width, encoded.height);
        } else {
          colorTexels += area;
          maxColorDimension = Math.max(maxColorDimension, encoded.width, encoded.height);
        }
        outputImages.push({ imageIndex, width: encoded.width, height: encoded.height });
        document.json.images[imageIndex].mimeType = "image/webp";
      }
      document.json.bufferViews[viewIndex].byteOffset = binLength;
      document.json.bufferViews[viewIndex].byteLength = bytes.length;
      outputViews.push(bytes);
      binLength += bytes.length;
    }
  } finally {
    await input.close();
  }
  document.json.buffers[0].byteLength = align4(binLength);
  const used = new Set(document.json.extensionsUsed ?? []);
  const required = new Set(document.json.extensionsRequired ?? []);
  used.add("EXT_texture_webp");
  required.add("EXT_texture_webp");
  document.json.extensionsUsed = [...used];
  document.json.extensionsRequired = [...required];
  for (const texture of document.json.textures ?? []) {
    const imageIndex = texture.source;
    if (Number.isInteger(imageIndex) && document.json.images[imageIndex]?.mimeType === "image/webp") {
      texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: imageIndex } };
      delete texture.source;
    }
  }
  const bin = Buffer.concat(outputViews);
  const parts = glbParts(document.json, bin);
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await rm(temporaryPath, { force: true });
  const output = await open(temporaryPath, "w");
  try {
    await writeAll(output, parts.header, 0);
    await writeAll(output, parts.jsonBytes, 20);
    await writeAll(output, parts.binHeader, 20 + parts.jsonBytes.length);
    await writeAll(output, parts.binBytes, 28 + parts.jsonBytes.length);
    await output.sync();
  } finally {
    await output.close();
  }
  await rm(outputPath, { force: true });
  await rename(temporaryPath, outputPath);
  const outputStat = await stat(outputPath);
  return {
    path: path.resolve(outputPath),
    bytes: outputStat.size,
    images: outputImages.length,
    texels,
    colorTexels,
    dataTexels,
    maxColorDimension,
    maxDataDimension,
    mimeTypes: ["image/webp"],
  };
}
