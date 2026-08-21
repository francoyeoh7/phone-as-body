import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn("npx", ["electron", "."], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env,
});
child.on("exit", (code) => process.exit(code ?? 0));
