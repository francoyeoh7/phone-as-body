import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const build = spawnSync("npx", ["vite", "build"], { cwd: root, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = spawnSync("npx", ["electron-builder", "--win", "nsis"], { cwd: root, stdio: "inherit", shell: true });
process.exit(dist.status ?? 1);
