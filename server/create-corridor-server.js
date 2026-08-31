import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import compression from "compression";
import { Server as SocketIOServer } from "socket.io";
import { createSessionRegistry } from "./session-registry.js";
import { createUeBridge } from "./ue-bridge.js";
import { shouldServeSpaShell } from "./spa-fallback.js";
import { EVENTS, MAX_VOICE_CLIP_BYTES, isDesktopEvent, isRoomCode } from "../src/shared/protocol.js";
import {
  EGG_EVENTS, isEggHostEvent, isEggPhase, isEggPlayerAction, isEggPlayerKey, isEggPlayerName, isEggTilt,
} from "../src/shared/egg-protocol.js";
import {
  CASTLE_EVENTS, isCastleAction, isCastleHostEvent, isCastleInput, isCastlePhase,
} from "../src/shared/castle-protocol.js";
import { createNpcAi } from "./npc-ai.js";
import { createEggRaceRegistry } from "./egg-race-registry.js";
import { createCastleRegistry } from "./castle-registry.js";

export function createCorridorServer({ root, mode, controllerOrigin = null, host = "0.0.0.0" } = {}) {
  const app = express();
  const tlsCert = process.env.TLS_CERT || null;
  const tlsKey = process.env.TLS_KEY || null;
  const tls = tlsCert && tlsKey && existsSync(tlsCert) && existsSync(tlsKey)
    ? { cert: readFileSync(tlsCert, "utf8"), key: readFileSync(tlsKey, "utf8") }
    : null;
  const server = tls ? createHttpsServer(tls, app) : createServer(app);
  const io = new SocketIOServer(server, {
    serveClient: false,
    maxHttpBufferSize: MAX_VOICE_CLIP_BYTES + 64 * 1024,
  });
  const sessions = createSessionRegistry();
  const ueBridge = createUeBridge();
  const npcAi = createNpcAi();
  const eggRooms = createEggRaceRegistry();
  const castleRooms = createCastleRegistry();
  let publicControllerOrigin = controllerOrigin;
  let vite = null;
  let latestRuntimeDiagnostic = null;

  app.use(compression({
    filter: (request, response) => {
      const type = String(response.getHeader("Content-Type") || "");
      if (/(model\/gltf|application\/wasm|application\/octet-stream)/i.test(type)) {
        return /\.(glb|wasm|bin)$/i.test(request.path || "");
      }
      return compression.filter(request, response);
    },
    threshold: 8 * 1024,
  }));
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

  io.on("connection", (socket) => {
    socket.on(EVENTS.desktopCreate, (acknowledge) => {
      try {
        const room = sessions.createDesktop(socket.id);
        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.role = "desktop";
        if (typeof acknowledge === "function") acknowledge({ ok: true, ...room });
      } catch {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-allocation-failed" });
      }
    });

    socket.on(EVENTS.controllerJoin, (payload, acknowledge) => {
      const code = payload?.room;
      if (!isRoomCode(code)) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "invalid-room" });
        return;
      }

      const joined = sessions.attachController(code, socket.id);
      if (!joined.ok) {
        if (typeof acknowledge === "function") acknowledge(joined);
        return;
      }

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.role = "controller";
      const room = sessions.get(code);
      if (joined.replacedId) {
        io.to(joined.replacedId).emit(EVENTS.controllerReplaced);
        io.to(room.desktopId).emit(EVENTS.peerStatus, { connected: false });
      }
      io.to(room.desktopId).emit(EVENTS.peerStatus, { connected: true });
      if (typeof acknowledge === "function") acknowledge({ ok: true });
    });

    socket.on(EVENTS.controllerInput, (payload, acknowledge) => {
      const accepted = sessions.acceptInput(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerInput, accepted.room.input);
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerAction, (payload, acknowledge) => {
      const accepted = sessions.acceptAction(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerAction, payload);
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerVoiceClip, (payload, acknowledge) => {
      const accepted = sessions.acceptVoiceClip(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerVoiceClip, accepted.clip);
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerHand, (payload, acknowledge) => {
      const accepted = sessions.acceptHand(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerHand, payload);
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.rtcSignal, (payload) => {
      const room = sessions.get(socket.data.roomCode);
      if (!room || payload === null || typeof payload !== "object") return;
      try {
        if (JSON.stringify(payload).length > 32_768) return;
      } catch {
        return;
      }
      const ownsDesktop = socket.data.role === "desktop" && room.desktopId === socket.id;
      const ownsController = socket.data.role === "controller" && room.controllerId === socket.id;
      if (!ownsDesktop && !ownsController) return;
      const targetId = ownsDesktop ? room.controllerId : room.desktopId;
      if (targetId) io.to(targetId).emit(EVENTS.rtcSignal, payload);
    });

    socket.on(EVENTS.desktopEvent, (payload) => {
      const room = sessions.get(socket.data.roomCode);
      if (room?.desktopId === socket.id && room.controllerId && isDesktopEvent(payload)) {
        io.to(room.controllerId).emit(EVENTS.desktopEvent, payload);
      }
    });

    socket.on(EGG_EVENTS.hostCreate, (acknowledge) => {
      try {
        const room = eggRooms.createHost(socket.id);
        socket.join(room.code);
        socket.data.eggRole = "host";
        socket.data.eggRoom = room.code;
        if (typeof acknowledge === "function") acknowledge({ ok: true, code: room.code });
      } catch {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-allocation-failed" });
      }
    });

    socket.on(EGG_EVENTS.playerJoin, (payload, acknowledge) => {
      const code = payload?.room;
      const key = payload?.key;
      const name = payload?.name;
      if (!isRoomCode(code) || !isEggPlayerKey(key) || !isEggPlayerName(name)) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "invalid-join" });
        return;
      }
      const joined = eggRooms.join(code, { key, name: name.trim(), socketId: socket.id });
      if (!joined.ok) {
        if (typeof acknowledge === "function") acknowledge(joined);
        return;
      }
      socket.join(code);
      socket.data.eggRole = "player";
      socket.data.eggRoom = code;
      socket.data.eggKey = key;
      const room = eggRooms.get(code);
      io.to(room.hostId).emit(EGG_EVENTS.roomUpdate, { players: joined.players });
      if (typeof acknowledge === "function") acknowledge({ ok: true, slot: joined.slot, players: joined.players });
    });

    socket.on(EGG_EVENTS.playerTilt, (payload) => {
      const code = socket.data.eggRoom;
      if (socket.data.eggRole !== "player" || !code) return;
      if (!isEggTilt(payload)) return;
      const room = eggRooms.get(code);
      if (!room) return;
      const slot = eggRooms.slotFor(code, socket.id);
      if (slot === null) return;
      io.to(room.hostId).volatile.emit(EGG_EVENTS.playerTilt, { slot, ...payload });
    });

    socket.on(EGG_EVENTS.playerAction, (payload) => {
      const code = socket.data.eggRoom;
      if (socket.data.eggRole !== "player" || !code) return;
      if (!isEggPlayerAction(payload)) return;
      const room = eggRooms.get(code);
      if (!room) return;
      const slot = eggRooms.slotFor(code, socket.id);
      if (slot === null) return;
      io.to(room.hostId).emit(EGG_EVENTS.playerAction, { slot, action: payload.action });
    });

    socket.on(EGG_EVENTS.hostPhase, (payload) => {
      const code = socket.data.eggRoom;
      if (socket.data.eggRole !== "host" || !code) return;
      if (!isEggPhase(payload)) return;
      socket.to(code).emit(EGG_EVENTS.hostPhase, payload);
    });

    socket.on(EGG_EVENTS.hostEvent, (payload) => {
      const code = socket.data.eggRoom;
      if (socket.data.eggRole !== "host" || !code) return;
      if (!isEggHostEvent(payload)) return;
      socket.to(code).volatile.emit(EGG_EVENTS.hostEvent, payload);
    });

    socket.on(EGG_EVENTS.ping, (payload, acknowledge) => {
      if (typeof acknowledge === "function") {
        acknowledge({ echo: typeof payload?.t === "number" ? payload.t : null, serverAt: Date.now() });
      }
    });

    socket.on(CASTLE_EVENTS.hostCreate, (acknowledge) => {
      try {
        const room = castleRooms.createHost(socket.id);
        socket.join(room.code);
        socket.data.castleRole = "host";
        socket.data.castleRoom = room.code;
        if (typeof acknowledge === "function") acknowledge({ ok: true, code: room.code });
      } catch {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-allocation-failed" });
      }
    });

    socket.on(CASTLE_EVENTS.playerJoin, (payload, acknowledge) => {
      const code = payload?.room;
      const key = payload?.key;
      const name = typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 12) : "探险者";
      if (!isRoomCode(code) || !isEggPlayerKey(key)) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "invalid-join" });
        return;
      }
      const joined = castleRooms.join(code, { key, name, socketId: socket.id });
      if (!joined.ok) {
        if (typeof acknowledge === "function") acknowledge(joined);
        return;
      }
      socket.join(code);
      socket.data.castleRole = "player";
      socket.data.castleRoom = code;
      const room = castleRooms.get(code);
      io.to(room.hostId).emit(CASTLE_EVENTS.roomUpdate, { player: { name: room.playerName, connected: true } });
      if (typeof acknowledge === "function") acknowledge({ ok: true, name: room.playerName });
    });

    socket.on(CASTLE_EVENTS.playerInput, (payload) => {
      const code = socket.data.castleRoom;
      if (socket.data.castleRole !== "player" || !code) return;
      if (!isCastleInput(payload)) return;
      const room = castleRooms.get(code);
      if (!room || room.playerSocketId !== socket.id) return;
      io.to(room.hostId).volatile.emit(CASTLE_EVENTS.playerInput, payload);
    });

    socket.on(CASTLE_EVENTS.playerAction, (payload) => {
      const code = socket.data.castleRoom;
      if (socket.data.castleRole !== "player" || !code) return;
      if (!isCastleAction(payload)) return;
      const room = castleRooms.get(code);
      if (!room || room.playerSocketId !== socket.id) return;
      io.to(room.hostId).emit(CASTLE_EVENTS.playerAction, payload);
    });

    socket.on(CASTLE_EVENTS.hostPhase, (payload) => {
      const code = socket.data.castleRoom;
      if (socket.data.castleRole !== "host" || !code) return;
      if (!isCastlePhase(payload)) return;
      socket.to(code).emit(CASTLE_EVENTS.hostPhase, payload);
    });

    socket.on(CASTLE_EVENTS.hostEvent, (payload) => {
      const code = socket.data.castleRoom;
      if (socket.data.castleRole !== "host" || !code) return;
      if (!isCastleHostEvent(payload)) return;
      socket.to(code).volatile.emit(CASTLE_EVENTS.hostEvent, payload);
    });

    socket.on(CASTLE_EVENTS.ping, (payload, acknowledge) => {
      if (typeof acknowledge === "function") {
        acknowledge({ echo: typeof payload?.t === "number" ? payload.t : null, serverAt: Date.now() });
      }
    });

    socket.on("disconnect", () => {
      const castleResult = castleRooms.disconnect(socket.id);
      if (castleResult?.role === "host") {
        io.to(castleResult.code).emit(CASTLE_EVENTS.ended, { reason: "host-left" });
      } else if (castleResult?.role === "player") {
        const room = castleRooms.get(castleResult.code);
        if (room) io.to(room.hostId).emit(CASTLE_EVENTS.roomUpdate, { player: null });
      }

      const eggResult = eggRooms.disconnect(socket.id);
      if (eggResult?.role === "host") {
        io.to(eggResult.code).emit(EGG_EVENTS.ended, { reason: "host-left" });
      } else if (eggResult?.role === "player") {
        const room = eggRooms.get(eggResult.code);
        if (room) io.to(room.hostId).emit(EGG_EVENTS.roomUpdate, { players: eggResult.players });
      }

      const result = sessions.disconnect(socket.id);
      if (!result?.peerId) return;
      if (result.role === "desktop") io.to(result.peerId).emit(EVENTS.sessionEnded);
      else io.to(result.peerId).emit(EVENTS.peerStatus, { connected: false });
    });
  });

  async function configureMiddleware() {
    if (mode === "production") {
      app.use(express.static(path.join(root, "dist")));
      app.use((request, response, next) => {
        if (!shouldServeSpaShell(request)) return next();
        return response.sendFile(path.join(root, "dist", "index.html"));
      });
      return;
    }

    const { createServer: createViteServer } = await import("vite");
    const mediaPipeWasmRoot = path.join(root, "public", "assets", "mediapipe", "wasm");
    const controllerHost = publicControllerOrigin ? new URL(publicControllerOrigin).hostname : null;
    vite = await createViteServer({
      root,
      plugins: [{
        name: "serve-mediapipe-runtime",
        configureServer(viteServer) {
          viteServer.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || "/", "http://localhost").pathname;
            const match = pathname.match(/^\/assets\/mediapipe\/wasm\/([A-Za-z0-9._-]+\.js)$/);
            if (!match) return next();

            const filePath = path.join(mediaPipeWasmRoot, match[1]);
            if (!filePath.startsWith(`${mediaPipeWasmRoot}${path.sep}`)) return next();

            response.statusCode = 200;
            response.setHeader("Content-Type", "application/javascript; charset=utf-8");
            return createReadStream(filePath).on("error", next).pipe(response);
          });
        },
      }],
      server: {
        middlewareMode: true,
        allowedHosts: controllerHost ? [controllerHost] : [],
        hmr: { overlay: false },
      },
    });
    app.use(vite.middlewares);
  }

  async function listen(port = 0) {
    await configureMiddleware();
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  }

  async function close() {
    await new Promise((resolve) => io.close(resolve));
    if (vite) await vite.close();
  }

  return {
    listen,
    close,
    setControllerOrigin: (origin) => { publicControllerOrigin = origin; },
    getControllerOrigin: () => publicControllerOrigin,
    address: () => server.listening ? server.address() : null,
  };
}
