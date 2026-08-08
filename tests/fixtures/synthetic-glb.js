import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function pad(buffer, byte) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, byte)]);
}

export function syntheticDocument() {
  return {
    asset: { version: "2.0", generator: "corridor-617-test" },
    scene: 0,
    scenes: [{ name: "Synthetic Village", nodes: [0, 1] }],
    nodes: [
      { name: "root-a", translation: [5, 0, 0], mesh: 0, children: [2, 3], extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: "root-b", translation: [-2, 0, 0], mesh: 0 },
      { name: "nested", translation: [2, 0, 0], mesh: 1 },
      { name: "unselected-sibling", translation: [20, 0, 0] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, targets: [{ POSITION: 0 }] }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 2, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
        sparse: { count: 1, indices: { bufferView: 2, componentType: 5123 }, values: { bufferView: 3 } },
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 24 },
      { buffer: 0, byteOffset: 24, byteLength: 6 },
      { buffer: 0, byteOffset: 30, byteLength: 2 },
      { buffer: 0, byteOffset: 32, byteLength: 2 },
      { buffer: 0, byteOffset: 36, byteLength: 4 },
    ],
    buffers: [{ byteLength: 40 }],
    materials: [{
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
      normalTexture: { index: 2 },
      occlusionTexture: { index: 3 },
      emissiveTexture: { index: 4 },
      extensions: {
        KHR_materials_specular: { specularTexture: { index: 5 }, specularColorTexture: { index: 6 } },
        KHR_materials_sheen: { sheenColorTexture: { index: 7 }, sheenRoughnessTexture: { index: 7 } },
        KHR_materials_anisotropy: { anisotropyTexture: { index: 6 } },
      },
    }],
    textures: Array.from({ length: 8 }, (_, index) => ({ sampler: 0, source: 0, name: `texture-${index}` })),
    samplers: [{}],
    images: [{ name: "embedded", mimeType: "image/png", bufferView: 4 }],
    extensionsUsed: [
      "KHR_lights_punctual",
      "KHR_materials_specular",
      "KHR_materials_sheen",
      "KHR_materials_anisotropy",
      "KHR_texture_transform",
    ],
    extensions: { KHR_lights_punctual: { lights: [{ type: "point", intensity: 2 }] } },
  };
}

export function createGlb(json = syntheticDocument(), bin = Buffer.alloc(40, 0x5a)) {
  const jsonBytes = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binBytes = pad(Buffer.from(bin), 0);
  const totalLength = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonBytes.length, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  jsonBytes.copy(output, 20);
  const binHeader = 20 + jsonBytes.length;
  output.writeUInt32LE(binBytes.length, binHeader);
  output.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  binBytes.copy(output, binHeader + 8);
  return output;
}

export async function withSyntheticGlb(run, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "corridor-glb-"));
  const file = path.join(directory, "fixture.glb");
  try {
    await writeFile(file, createGlb(options.json, options.bin));
    return await run({ file, json: options.json ?? syntheticDocument() });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
