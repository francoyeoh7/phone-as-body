#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRelayServer } from "./server.mjs";

const relayDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8443;
const distDir = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : path.resolve(relayDir, "..", "dist");
const certPath = process.env.TLS_CERT || null;
const keyPath = process.env.TLS_KEY || null;
const tls = certPath && keyPath && existsSync(certPath) && existsSync(keyPath)
  ? { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") }
  : null;

const relay = createRelayServer({ distDir, tls });
const server = relay.listen(port, "0.0.0.0");
if (!server) {
  console.error("relay: missing TLS_CERT/TLS_KEY, refusing to serve plaintext on a public port");
  process.exit(1);
}
server.on("listening", () => {
  console.log(`relay listening on https://0.0.0.0:${port} serving ${distDir}`);
});
