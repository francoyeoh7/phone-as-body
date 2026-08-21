import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { EVENTS } from "../src/shared/protocol.js";
import { shouldServeSpaShell } from "../server/spa-fallback.js";
import { createRoomRegistry } from "./rooms.js";

const MAX_VOICE_CLIP_BYTES = 1024 * 1024;
const JOIN_ACK_TIMEOUT_MS = 5_000;
const MAX_RTC_SIGNAL_JSON = 32_768;

const PHONE_TO_DESKTOP_EVENTS = [
  EVENTS.controllerInput,
  EVENTS.controllerHand,
  EVENTS.controllerVoiceClip,
  EVENTS.controllerAction,
  EVENTS.rtcSignal,
];

const DESKTOP_TO_PHONE_EVENTS = [
  EVENTS.desktopEvent,
  EVENTS.peerStatus,
  EVENTS.controllerReplaced,
  EVENTS.sessionEnded,
  EVENTS.rtcSignal,
];

function rtcSignalSizeOk(payload) {
  try {
    return JSON.stringify(payload).length <= MAX_RTC_SIGNAL_JSON;
  } catch {
    return false;
  }
}

export function createRelayServer({
  registry = createRoomRegistry(),
  distDir,
  tls = null,
  maxHttpBufferSize = MAX_VOICE_CLIP_BYTES + 64 * 1024,
  sweepIntervalMs = 15_000,
} = {}) {
  const app = express();
  app.use(express.static(distDir));
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.use((request, response, next) => {
    if (!shouldServeSpaShell(request)) return next();
    response.sendFile(path.join(distDir, "index.html"));
  });

  const io = new SocketIOServer({ serveClient: false, maxHttpBufferSize });

  io.on("connection", (socket) => {
    socket.on("relayRegister", (payload, acknowledge) => {
      const code = payload?.code;
      const secret = payload?.secret;
      const ok = registry.register(code, secret, socket.id);
      if (ok) {
        socket.data.roomCode = code;
        socket.data.role = "desktop";
      }
      if (typeof acknowledge === "function") acknowledge({ ok });
    });

    socket.on("relayUnregister", (payload) => {
      if (socket.data.role !== "desktop" || payload?.code !== socket.data.roomCode) return;
      registry.markOrphan(socket.data.roomCode);
    });

    socket.on("relay:d2c", (message) => {
      if (socket.data.role !== "desktop") return;
      const room = registry.get(socket.data.roomCode);
      if (!room || room.desktopSocketId !== socket.id) return;
      if (!DESKTOP_TO_PHONE_EVENTS.includes(message?.event)) return;
      const phoneSocketId = room.controllers.get(message?.cid);
      if (phoneSocketId) io.to(phoneSocketId).emit(message.event, message.payload);
    });

    socket.on(EVENTS.controllerJoin, async (payload, acknowledge) => {
      const code = payload?.room;
      const key = payload?.k;
      const room = registry.validate(code, key);
      if (!room) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-not-found" });
        return;
      }
      const attached = registry.attach(code, socket.id);
      if (!attached.ok) {
        if (typeof acknowledge === "function") acknowledge(attached);
        return;
      }
      socket.data.roomCode = code;
      socket.data.role = "controller";
      socket.data.cid = attached.cid;

      const desktopAck = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, reason: "desktop-timeout" }), JOIN_ACK_TIMEOUT_MS);
        io.to(room.desktopSocketId).timeout(JOIN_ACK_TIMEOUT_MS).emit(
          "relay:c2d",
          {
            code,
            cid: attached.cid,
            event: EVENTS.controllerJoin,
            payload: { room: code, deviceToken: payload?.deviceToken ?? null },
          },
          (error, responses) => {
            clearTimeout(timer);
            if (error) resolve({ ok: false, reason: "desktop-timeout" });
            else resolve(responses?.[0] ?? { ok: false, reason: "desktop-no-ack" });
          },
        );
      });
      if (!desktopAck.ok) registry.detach(socket.id);
      if (typeof acknowledge === "function") acknowledge(desktopAck);
    });

    for (const event of PHONE_TO_DESKTOP_EVENTS) {
      socket.on(event, (payload, acknowledge) => {
        if (socket.data.role !== "controller") return;
        const room = registry.get(socket.data.roomCode);
        if (!room) return;
        if (event === EVENTS.rtcSignal && !rtcSignalSizeOk(payload)) return;
        const message = { code: socket.data.roomCode, cid: socket.data.cid, event, payload };
        if (typeof acknowledge === "function") {
          io.to(room.desktopSocketId).timeout(JOIN_ACK_TIMEOUT_MS).emit("relay:c2d", message, (error, responses) => {
            if (!error && Array.isArray(responses) && responses.length > 0) acknowledge(responses[0]);
          });
        } else {
          io.to(room.desktopSocketId).emit("relay:c2d", message);
        }
      });
    }

    socket.on("disconnect", () => {
      if (socket.data.role === "desktop") {
        const code = socket.data.roomCode;
        registry.markOrphan(code);
        const room = registry.get(code);
        if (room) {
          for (const phoneSocketId of room.controllers.keys()) {
            io.to(phoneSocketId).emit(EVENTS.sessionEnded);
          }
        }
      } else if (socket.data.role === "controller") {
        registry.detach(socket.id);
      }
    });
  });

  const sweepTimer = setInterval(() => registry.sweep(), sweepIntervalMs);

  return {
    app,
    io,
    attachIo(httpServer) {
      io.attach(httpServer);
    },
    close() {
      clearInterval(sweepTimer);
      io.close();
    },
    listen(port, host) {
      if (!tls) return null;
      const server = createHttpsServer({ cert: tls.cert, key: tls.key }, app);
      io.attach(server);
      server.listen(port, host);
      return server;
    },
  };
}
