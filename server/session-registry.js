import {
  isControllerAction, isControllerInput, isHandFrame, isRoomCode, isVoiceClip,
} from "../src/shared/protocol.js";

const stoppedInput = () => ({
  seq: -1,
  sentAt: 0,
  move: { x: 0, y: 0 },
  viewDelta: { yaw: 0, pitch: 0 },
  clutch: false,
  crouch: false,
});

function defaultRandomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createSessionRegistry({ randomCode = defaultRandomCode, now = () => Date.now() } = {}) {
  const rooms = new Map();

  function createDesktop(desktopId) {
    let code;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = String(randomCode());
      if (isRoomCode(candidate) && !rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Unable to allocate a unique room code");

    const room = {
      code,
      desktopId,
      controllerId: null,
      input: stoppedInput(),
      handSeq: -1,
      handEpoch: 0,
      voiceSeq: -1,
      lastVoiceAcceptedAt: null,
    };
    rooms.set(code, room);
    return { code };
  }

  function attachController(code, controllerId) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };

    const replacedId = room.controllerId && room.controllerId !== controllerId ? room.controllerId : null;
    room.controllerId = controllerId;
    room.input = stoppedInput();
    room.handSeq = -1;
    room.handEpoch = 0;
    room.voiceSeq = -1;
    room.lastVoiceAcceptedAt = null;
    return { ok: true, replacedId };
  }

  function acceptInput(code, controllerId, input) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.controllerId !== controllerId) return { ok: false, reason: "not-controller" };
    if (!isControllerInput(input)) return { ok: false, reason: "invalid-input" };
    if (input.seq <= room.input.seq) return { ok: false, reason: "stale-input" };

    room.input = {
      seq: input.seq,
      sentAt: input.sentAt,
      move: { x: input.move.x, y: input.move.y },
      viewDelta: { yaw: input.viewDelta.yaw, pitch: input.viewDelta.pitch },
      clutch: input.clutch,
      crouch: input.crouch === true,
    };
    return { ok: true, room };
  }

  function acceptAction(code, controllerId, action) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.controllerId !== controllerId) return { ok: false, reason: "not-controller" };
    if (!isControllerAction(action)) return { ok: false, reason: "invalid-action" };
    return { ok: true, room };
  }

  function acceptVoiceClip(code, controllerId, clip) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.controllerId !== controllerId) return { ok: false, reason: "not-controller" };
    if (!isVoiceClip(clip)) return { ok: false, reason: "invalid-voice" };
    if (clip.seq <= room.voiceSeq) return { ok: false, reason: "stale-voice" };
    const acceptedAt = now();
    if (room.lastVoiceAcceptedAt !== null && acceptedAt - room.lastVoiceAcceptedAt < 1_000) {
      return { ok: false, reason: "voice-rate-limited" };
    }

    room.voiceSeq = clip.seq;
    room.lastVoiceAcceptedAt = acceptedAt;
    return {
      ok: true,
      room,
      clip: {
        version: clip.version,
        seq: clip.seq,
        durationMs: clip.durationMs,
        mimeType: String(clip.mimeType).split(";")[0].toLowerCase(),
        data: clip.data,
      },
    };
  }

  function acceptHand(code, controllerId, frame) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.controllerId !== controllerId) return { ok: false, reason: "not-controller" };
    if (!isHandFrame(frame)) return { ok: false, reason: "invalid-hand" };
    if (frame.modeEpoch < room.handEpoch
      || (frame.modeEpoch === room.handEpoch && frame.seq <= room.handSeq)) {
      return { ok: false, reason: "stale-hand" };
    }
    room.handEpoch = frame.modeEpoch;
    room.handSeq = frame.seq;
    return { ok: true, room };
  }

  function disconnect(socketId) {
    for (const [code, room] of rooms) {
      if (room.desktopId === socketId) {
        rooms.delete(code);
        return { role: "desktop", roomCode: code, peerId: room.controllerId };
      }
      if (room.controllerId === socketId) {
        room.controllerId = null;
        room.input = stoppedInput();
        room.handSeq = -1;
        room.handEpoch = 0;
        room.voiceSeq = -1;
        room.lastVoiceAcceptedAt = null;
        return { role: "controller", roomCode: code, peerId: room.desktopId };
      }
    }
    return null;
  }

  return {
    createDesktop,
    attachController,
    acceptInput,
    acceptAction,
    acceptVoiceClip,
    acceptHand,
    disconnect,
    get: (code) => rooms.get(code) ?? null,
  };
}
