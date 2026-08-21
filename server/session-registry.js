import { randomBytes } from "node:crypto";
import {
  isControllerAction, isControllerInput, isDeviceToken, isHandFrame, isRoomCode, isVoiceClip,
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

function defaultSecretFactory() {
  return randomBytes(12).toString("base64url");
}

function createControllerState(slot, deviceToken, now) {
  return {
    slot,
    deviceToken,
    joinedAt: now(),
    input: stoppedInput(),
    handSeq: -1,
    handEpoch: 0,
    voiceSeq: -1,
    lastVoiceAcceptedAt: null,
  };
}

function resetControllerState(state) {
  state.input = stoppedInput();
  state.handSeq = -1;
  state.handEpoch = 0;
  state.voiceSeq = -1;
  state.lastVoiceAcceptedAt = null;
}

export function createSessionRegistry({
  randomCode = defaultRandomCode,
  secretFactory = defaultSecretFactory,
  now = () => Date.now(),
  maxControllers = 8,
} = {}) {
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
      secret: secretFactory(),
      desktopId,
      controllers: new Map(),
      createdAt: now(),
    };
    rooms.set(code, room);
    return { code: room.code, secret: room.secret };
  }

  function attachController(code, controllerId, deviceToken = null) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (deviceToken !== null && !isDeviceToken(deviceToken)) {
      return { ok: false, reason: "invalid-device-token" };
    }

    let state = null;
    let replacedId = null;
    if (deviceToken !== null) {
      for (const [id, existing] of room.controllers) {
        if (existing.deviceToken === deviceToken) {
          state = existing;
          if (id !== controllerId) {
            replacedId = id;
            room.controllers.delete(id);
          }
          break;
        }
      }
    }

    if (!state) {
      const used = new Set([...room.controllers.values()].map((entry) => entry.slot));
      if (used.size >= maxControllers) return { ok: false, reason: "room-full" };
      let slot = 0;
      while (used.has(slot)) slot += 1;
      state = createControllerState(slot, deviceToken, now);
    } else if (deviceToken !== null) {
      state.deviceToken = deviceToken;
    }

    resetControllerState(state);
    state.joinedAt = now();
    room.controllers.set(controllerId, state);
    return { ok: true, slot: state.slot, replacedId };
  }

  function controllerStateAt(code, controllerId) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    const state = room.controllers.get(controllerId);
    if (!state) return { ok: false, reason: "not-controller" };
    return { ok: true, room, state };
  }

  function acceptInput(code, controllerId, input) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    const { room, state } = found;
    if (!isControllerInput(input)) return { ok: false, reason: "invalid-input" };
    if (input.seq <= state.input.seq) return { ok: false, reason: "stale-input" };

    state.input = {
      seq: input.seq,
      sentAt: input.sentAt,
      move: { x: input.move.x, y: input.move.y },
      viewDelta: { yaw: input.viewDelta.yaw, pitch: input.viewDelta.pitch },
      clutch: input.clutch,
      crouch: input.crouch === true,
    };
    return {
      ok: true,
      room,
      slot: state.slot,
      input: { ...state.input, move: { ...state.input.move }, viewDelta: { ...state.input.viewDelta } },
    };
  }

  function acceptAction(code, controllerId, action) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    if (!isControllerAction(action)) return { ok: false, reason: "invalid-action" };
    return { ok: true, room: found.room, slot: found.state.slot };
  }

  function acceptVoiceClip(code, controllerId, clip) {
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    const { room, state } = found;
    if (!isVoiceClip(clip)) return { ok: false, reason: "invalid-voice" };
    if (clip.seq <= state.voiceSeq) return { ok: false, reason: "stale-voice" };
    const acceptedAt = now();
    if (state.lastVoiceAcceptedAt !== null && acceptedAt - state.lastVoiceAcceptedAt < 1_000) {
      return { ok: false, reason: "voice-rate-limited" };
    }

    state.voiceSeq = clip.seq;
    state.lastVoiceAcceptedAt = acceptedAt;
    return {
      ok: true,
      room,
      slot: state.slot,
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
    const found = controllerStateAt(code, controllerId);
    if (!found.ok) return found;
    const { room, state } = found;
    if (!isHandFrame(frame)) return { ok: false, reason: "invalid-hand" };
    if (frame.modeEpoch < state.handEpoch
      || (frame.modeEpoch === state.handEpoch && frame.seq <= state.handSeq)) {
      return { ok: false, reason: "stale-hand" };
    }
    state.handEpoch = frame.modeEpoch;
    state.handSeq = frame.seq;
    return { ok: true, room, slot: state.slot };
  }

  function controllerIdAt(code, slot) {
    const room = rooms.get(code);
    if (!room) return null;
    for (const [id, state] of room.controllers) {
      if (state.slot === slot) return id;
    }
    return null;
  }

  function disconnect(socketId) {
    for (const [code, room] of rooms) {
      if (room.desktopId === socketId) {
        rooms.delete(code);
        return { role: "desktop", roomCode: code, controllerIds: [...room.controllers.keys()] };
      }
      if (room.controllers.has(socketId)) {
        const state = room.controllers.get(socketId);
        room.controllers.delete(socketId);
        return { role: "controller", roomCode: code, slot: state.slot };
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
    controllerIdAt,
    disconnect,
    get: (code) => rooms.get(code) ?? null,
  };
}
