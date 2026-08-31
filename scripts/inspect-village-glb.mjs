import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, dedup, prune, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

const inPath = process.argv[2];
const outPath = process.argv[3];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);

await doc.transform(
  dedup(),
  prune(),
  weld({ tolerance: 0.0001 }),
);

const extensionsUsed = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
const textures = doc.getRoot().listTextures().map((t) => `${t.getMimeType()} ${t.getSize()?.[0]}x${t.getSize()?.[1]}`);
const meshes = doc.getRoot().listMeshes().length;
const prims = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
console.log(JSON.stringify({ extensionsUsed, textures: textures.slice(0, 10), textureCount: textures.length, meshes, prims }, null, 2));

await io.write(outPath, doc);
console.log("written", outPath);
