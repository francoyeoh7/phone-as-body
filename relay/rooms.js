import { timingSafeEqual } from "node:crypto";
import { isRoomCode } from "../src/shared/protocol.js";

function keysMatch(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function createRoomRegistry({ maxControllers = 8, orphanTtlMs = 60_000, now = () => Date.now() } = {}) {
  const rooms = new Map();

  function register(code, secret, desktopSocketId) {
    if (!isRoomCode(code) || typeof secret !== "string" || secret.length < 12) return false;
    const existing = rooms.get(code);
    if (existing && !keysMatch(existing.secret, secret)) return false;
    rooms.set(code, {
      code,
      secret,
      desktopSocketId,
      controllers: new Map(),
      orphanedAt: null,
    });
    return true;
  }

  function validate(code, key) {
    const room = rooms.get(code);
    if (!room || !keysMatch(room.secret, key)) return null;
    return room;
  }

  function attach(code, phoneSocketId) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.controllers.size >= maxControllers) return { ok: false, reason: "room-full" };
    room.controllers.set(phoneSocketId, phoneSocketId);
    return { ok: true, cid: phoneSocketId };
  }

  function detach(phoneSocketId) {
    for (const room of rooms.values()) {
      if (room.controllers.delete(phoneSocketId)) return { ok: true, code: room.code };
    }
    return { ok: false };
  }

  function markOrphan(code) {
    const room = rooms.get(code);
    if (room) room.orphanedAt = now();
  }

  function sweep() {
    const dead = [];
    for (const room of rooms.values()) {
      if (room.orphanedAt !== null && now() - room.orphanedAt >= orphanTtlMs) {
        rooms.delete(room.code);
        dead.push(room.code);
      }
    }
    return dead;
  }

  return { register, validate, get: (code) => rooms.get(code) ?? null, attach, detach, markOrphan, sweep };
}
