import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createSessionRegistry } from "./session-registry.js";
import { createSocketRouter } from "./socket-router.js";
import { createRelayBridge } from "./relay-bridge.js";
import { createUeBridge } from "./ue-bridge.js";
import { shouldServeSpaShell } from "./spa-fallback.js";
import { MAX_VOICE_CLIP_BYTES } from "../src/shared/protocol.js";
import { createNpcAi } from "./npc-ai.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile?.(path.join(root, ".env.local"));
} catch {
  try {
    const localEnv = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const line of localEnv.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* optional local config */ }
}
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, { serveClient: false, maxHttpBufferSize: MAX_VOICE_CLIP_BYTES + 64 * 1024 });
const sessions = createSessionRegistry();
const port = Number(process.env.PORT) || 4174;
const publicControllerOrigin = process.env.PUBLIC_CONTROLLER_ORIGIN || null;
const publicControllerHost = publicControllerOrigin ? new URL(publicControllerOrigin).hostname : null;
const ueBridge = createUeBridge();
const npcAi = createNpcAi();
const relayUrl = process.env.RELAY_URL || null;
const relayBridge = relayUrl
  ? createRelayBridge({ relayUrl, localServerUrl: `http://127.0.0.1:${port}` })
  : null;
let latestRuntimeDiagnostic = null;

app.use(express.json({ limit: "64kb" }));

app.get("/api/config", (_request, response) => {
  response.json({ controllerOrigin: publicControllerOrigin, aiConfigured: Boolean(process.env.OPENAI_API_KEY) });
});

app.get("/api/npc/config", npcAi.config);
app.post("/api/npc/transcribe", express.raw({ type: ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav"], limit: MAX_VOICE_CLIP_BYTES }), npcAi.transcribe);
app.post("/api/npc/perform", npcAi.perform);
app.post("/api/npc/realtime", express.text({ type: "application/sdp", limit: "64kb" }), npcAi.realtime);

app.get("/api/ue-bridge/config", (_request, response) => {
  response.json({ target: ueBridge.target });
});

app.post("/api/ue-bridge/input", (request, response) => {
  response.json({ ok: ueBridge.sendInput(request.body) });
});

app.post("/api/ue-bridge/action", (request, response) => {
  response.json({ ok: ueBridge.sendAction(request.body) });
});

app.get("/api/runtime-diagnostic", (_request, response) => {
  response.json(latestRuntimeDiagnostic ?? { ok: true, diagnostic: null });
});

app.post("/api/runtime-diagnostic", (request, response) => {
  const message = typeof request.body?.message === "string" ? request.body.message.slice(0, 500) : "Unknown runtime error";
  const stack = typeof request.body?.stack === "string" ? request.body.stack.slice(0, 4_000) : null;
  latestRuntimeDiagnostic = { ok: false, message, stack, at: Date.now() };
  response.status(204).end();
});

createSocketRouter(io, sessions, relayBridge);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.use((request, response, next) => {
    if (!shouldServeSpaShell(request)) return next();
    response.sendFile(path.join(root, "dist", "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const mediaPipeWasmRoot = path.join(root, "public", "assets", "mediapipe", "wasm");
  const serveMediaPipeRuntime = {
    name: "serve-mediapipe-runtime",
    configureServer(viteServer) {
      viteServer.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        const match = pathname.match(/^\/assets\/mediapipe\/wasm\/([A-Za-z0-9._-]+\.js)$/);
        if (!match) {
          next();
          return;
        }

        const filePath = path.join(mediaPipeWasmRoot, match[1]);
        if (!filePath.startsWith(`${mediaPipeWasmRoot}${path.sep}`)) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        createReadStream(filePath).on("error", next).pipe(response);
      });
    },
  };
  const vite = await createViteServer({
    root,
    plugins: [serveMediaPipeRuntime],
    server: {
      middlewareMode: true,
      allowedHosts: publicControllerHost ? [publicControllerHost] : [],
      hmr: { overlay: false },
    },
  });
  app.use(vite.middlewares);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Phone as Body is running at http://localhost:${port}`);
});
