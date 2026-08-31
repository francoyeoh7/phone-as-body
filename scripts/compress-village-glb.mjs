import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, draco } from "@gltf-transform/functions";
import draco3d from "draco3d";

const [inPath, outPath] = process.argv.slice(2);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });
const doc = await io.read(inPath);

await doc.transform(dedup(), prune(), draco({ method: "edgebreaker" }));
await io.write(outPath, doc);
console.log("written", outPath);
