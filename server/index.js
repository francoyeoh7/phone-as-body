import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createSessionRegistry } from "./session-registry.js";
import { createUeBridge } from "./ue-bridge.js";
import { EVENTS, isDesktopEvent, isRoomCode } from "../src/shared/protocol.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, { serveClient: false });
const sessions = createSessionRegistry();
const port = Number(process.env.PORT) || 4174;
const publicControllerOrigin = process.env.PUBLIC_CONTROLLER_ORIGIN || null;
const publicControllerHost = publicControllerOrigin ? new URL(publicControllerOrigin).hostname : null;
const ueBridge = createUeBridge();

app.use(express.json({ limit: "64kb" }));

app.get("/api/config", (_request, response) => {
  response.json({ controllerOrigin: publicControllerOrigin });
});

app.get("/api/ue-bridge/config", (_request, response) => {
  response.json({ target: ueBridge.target });
});

app.post("/api/ue-bridge/input", (request, response) => {
  response.json({ ok: ueBridge.sendInput(request.body) });
});

app.post("/api/ue-bridge/action", (request, response) => {
  response.json({ ok: ueBridge.sendAction(request.body) });
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
    const code = socket.data.roomCode;
    const accepted = sessions.acceptInput(code, socket.id, payload);
    if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerInput, payload);
    if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
  });

  socket.on(EVENTS.controllerAction, (payload, acknowledge) => {
    const accepted = sessions.acceptAction(socket.data.roomCode, socket.id, payload);
    if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerAction, payload);
    if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
  });

  socket.on(EVENTS.controllerHand, (payload, acknowledge) => {
    const accepted = sessions.acceptHand(socket.data.roomCode, socket.id, payload);
    if (accepted.ok) io.to(accepted.room.desktopId).emit(EVENTS.controllerHand, payload);
    if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
  });

  socket.on(EVENTS.rtcSignal, (payload) => {
    const code = socket.data.roomCode;
    const room = sessions.get(code);
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

  socket.on("disconnect", () => {
    const result = sessions.disconnect(socket.id);
    if (!result?.peerId) return;
    if (result.role === "desktop") io.to(result.peerId).emit(EVENTS.sessionEnded);
    else io.to(result.peerId).emit(EVENTS.peerStatus, { connected: false });
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(root, "dist", "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    server: {
      middlewareMode: true,
      allowedHosts: publicControllerHost ? [publicControllerHost] : [],
    },
  });
  app.use(vite.middlewares);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Corridor 617 is running at http://localhost:${port}`);
});
