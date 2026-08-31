import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCorridorServer } from "./create-corridor-server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile?.(path.join(root, ".env.local"));
} catch {
  try {
    const localEnv = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const line of localEnv.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    }
  } catch { /* optional local config */ }
}

const port = Number(process.env.PORT) || 4174;
const runtime = createCorridorServer({
  root,
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  controllerOrigin: process.env.PUBLIC_CONTROLLER_ORIGIN || null,
  host: "0.0.0.0",
});

await runtime.listen(port);
console.log(`Phone as Body is running at http://localhost:${port}`);
