import { EVENTS, isDesktopEvent, isRoomCode } from "../src/shared/protocol.js";

const MAX_RTC_SIGNAL_JSON = 32_768;

function rtcSignalSizeOk(payload) {
  try {
    return JSON.stringify(payload).length <= MAX_RTC_SIGNAL_JSON;
  } catch {
    return false;
  }
}

export function createSocketRouter(io, sessions, relayBridge = null) {
  io.on("connection", (socket) => {
    socket.on(EVENTS.desktopCreate, (acknowledge) => {
      try {
        const room = sessions.createDesktop(socket.id);
        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.role = "desktop";
        relayBridge?.registerRoom?.(room.code, room.secret);
        if (typeof acknowledge === "function") acknowledge({ ok: true, code: room.code, secret: room.secret });
      } catch {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "room-allocation-failed" });
      }
    });

    socket.on(EVENTS.controllerJoin, (payload, acknowledge) => {
      const code = payload?.room;
      const deviceToken = payload?.deviceToken ?? null;
      if (!isRoomCode(code)) {
        if (typeof acknowledge === "function") acknowledge({ ok: false, reason: "invalid-room" });
        return;
      }

      const joined = sessions.attachController(code, socket.id, deviceToken);
      if (!joined.ok) {
        if (typeof acknowledge === "function") acknowledge(joined);
        return;
      }

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.role = "controller";
      socket.data.slot = joined.slot;
      const room = sessions.get(code);
      if (joined.replacedId) io.to(joined.replacedId).emit(EVENTS.controllerReplaced);
      io.to(room.desktopId).emit(EVENTS.peerStatus, { connected: true, slot: joined.slot });
      if (typeof acknowledge === "function") acknowledge({ ok: true, slot: joined.slot });
    });

    socket.on(EVENTS.controllerInput, (payload, acknowledge) => {
      const accepted = sessions.acceptInput(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerInput, { slot: accepted.slot, input: accepted.input });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerAction, (payload, acknowledge) => {
      const accepted = sessions.acceptAction(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerAction, { slot: accepted.slot, action: payload });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerVoiceClip, (payload, acknowledge) => {
      const accepted = sessions.acceptVoiceClip(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerVoiceClip, { slot: accepted.slot, clip: accepted.clip });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.controllerHand, (payload, acknowledge) => {
      const accepted = sessions.acceptHand(socket.data.roomCode, socket.id, payload);
      if (accepted.ok) {
        io.to(accepted.room.desktopId).emit(EVENTS.controllerHand, { slot: accepted.slot, frame: payload });
      }
      if (typeof acknowledge === "function") acknowledge({ ok: accepted.ok, reason: accepted.reason });
    });

    socket.on(EVENTS.rtcSignal, (payload) => {
      const code = socket.data.roomCode;
      const room = sessions.get(code);
      if (!room || payload === null || typeof payload !== "object") return;
      if (!rtcSignalSizeOk(payload)) return;

      if (socket.data.role === "desktop" && room.desktopId === socket.id) {
        const slot = payload.slot;
        const targetId = Number.isInteger(slot) ? sessions.controllerIdAt(code, slot) : null;
        if (targetId) {
          const { slot: _slot, ...signal } = payload;
          io.to(targetId).emit(EVENTS.rtcSignal, signal);
        }
        return;
      }

      if (socket.data.role === "controller") {
        io.to(room.desktopId).emit(EVENTS.rtcSignal, { slot: socket.data.slot, ...payload });
      }
    });

    socket.on(EVENTS.desktopEvent, (payload) => {
      const room = sessions.get(socket.data.roomCode);
      if (room?.desktopId === socket.id && isDesktopEvent(payload)) {
        for (const controllerId of room.controllers.keys()) {
          io.to(controllerId).emit(EVENTS.desktopEvent, payload);
        }
      }
    });

    socket.on("disconnect", () => {
      const result = sessions.disconnect(socket.id);
      if (!result) return;
      if (result.role === "desktop") {
        relayBridge?.unregisterRoom?.(result.roomCode);
        for (const controllerId of result.controllerIds) {
          io.to(controllerId).emit(EVENTS.sessionEnded);
        }
      } else {
        const room = sessions.get(result.roomCode);
        if (room) io.to(room.desktopId).emit(EVENTS.peerStatus, { connected: false, slot: result.slot });
      }
    });
  });
}
