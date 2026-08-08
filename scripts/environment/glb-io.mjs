import { open } from "node:fs/promises";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

async function readExact(handle, length, position, label) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error(`Invalid GLB: truncated ${label}`);
    offset += bytesRead;
  }
  return buffer;
}

export async function readGlbDocument(filePath) {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size < 20) throw new Error("Invalid GLB length");
    const header = await readExact(handle, 12, 0, "header");
    const magic = header.readUInt32LE(0);
    const version = header.readUInt32LE(4);
    const totalLength = header.readUInt32LE(8);
    if (magic !== GLB_MAGIC) throw new Error("Invalid GLB magic");
    if (version !== GLB_VERSION) throw new Error(`Unsupported GLB version ${version}`);
    if (totalLength !== stat.size || totalLength < 20) throw new Error("Invalid GLB total length");

    const jsonHeader = await readExact(handle, 8, 12, "JSON chunk header");
    const jsonChunkLength = jsonHeader.readUInt32LE(0);
    if (jsonHeader.readUInt32LE(4) !== JSON_CHUNK || jsonChunkLength === 0 || jsonChunkLength % 4 !== 0) {
      throw new Error("Invalid GLB JSON chunk");
    }
    const jsonEnd = 20 + jsonChunkLength;
    if (jsonEnd > totalLength) throw new Error("Invalid GLB JSON chunk length");
    const jsonBytes = await readExact(handle, jsonChunkLength, 20, "JSON chunk");
    let json;
    try {
      json = JSON.parse(jsonBytes.toString("utf8").replace(/[\u0000\u0020]+$/u, ""));
    } catch (error) {
      throw new Error(`Invalid GLB JSON: ${error.message}`);
    }

    let binOffset = null;
    let binLength = 0;
    if (jsonEnd < totalLength) {
      if (jsonEnd + 8 > totalLength) throw new Error("Invalid GLB BIN chunk header length");
      const binHeader = await readExact(handle, 8, jsonEnd, "BIN chunk header");
      binLength = binHeader.readUInt32LE(0);
      if (binHeader.readUInt32LE(4) !== BIN_CHUNK || binLength % 4 !== 0) {
        throw new Error("Invalid GLB BIN chunk");
      }
      binOffset = jsonEnd + 8;
      if (binOffset + binLength !== totalLength) throw new Error("Invalid GLB BIN chunk length");
    }

    return { json, jsonChunkLength, binOffset, binLength, totalLength };
  } finally {
    await handle.close();
  }
}
