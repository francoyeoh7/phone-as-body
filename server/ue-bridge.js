import dgram from "node:dgram";
import { isControllerAction, isControllerInput } from "../src/shared/protocol.js";

function finiteSetting(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

function normalizedSettings(settings) {
  if (settings === null || typeof settings !== "object") return null;
  const sensitivity = finiteSetting(Number(settings.sensitivity), 0.6, 1.6);
  const smoothing = finiteSetting(Number(settings.smoothing), 0, 1);
  const result = {};
  if (sensitivity !== null) result.sensitivity = sensitivity;
  if (smoothing !== null) result.smoothing = smoothing;
  return Object.keys(result).length > 0 ? result : null;
}

export function createUeInputPacket(input, receivedAt = performance.now()) {
  if (!isControllerInput(input)) return null;
  return {
    type: "input",
    seq: input.seq,
    sentAt: input.sentAt,
    receivedAt,
    move: { x: input.move.x, y: input.move.y },
    viewDelta: { yaw: input.viewDelta.yaw, pitch: input.viewDelta.pitch },
    clutch: input.clutch,
  };
}

export function createUeActionPacket(action) {
  if (!isControllerAction(action)) return null;
  const packet = {
    type: "action",
    action: action.action,
  };
  if (Number.isFinite(action.sentAt)) packet.sentAt = action.sentAt;
  const settings = normalizedSettings(action.settings);
  if (settings) packet.settings = settings;
  return packet;
}

export function encodeUeBridgePacket(packet) {
  if (packet === null || typeof packet !== "object" || typeof packet.type !== "string") return null;
  return Buffer.from(JSON.stringify(packet), "utf8");
}

export function createUeBridge({
  socket = dgram.createSocket("udp4"),
  host = process.env.UE_BRIDGE_HOST || "127.0.0.1",
  port = Number(process.env.UE_BRIDGE_PORT) || 61717,
  now = () => performance.now(),
} = {}) {
  function send(packet) {
    const buffer = encodeUeBridgePacket(packet);
    if (!buffer || buffer.length > 8_192) return false;
    socket.send(buffer, port, host);
    return true;
  }

  return {
    sendInput(input) {
      return send(createUeInputPacket(input, now()));
    },
    sendAction(action) {
      return send(createUeActionPacket(action));
    },
    close() {
      socket.close?.();
    },
    target: { host, port },
  };
}
