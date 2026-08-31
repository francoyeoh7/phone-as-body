import { isRoomCode } from "../src/shared/protocol.js";

function defaultRandomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createCastleRegistry({ randomCode = defaultRandomCode } = {}) {
  const rooms = new Map();

  function createHost(hostId) {
    let code = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = String(randomCode());
      if (isRoomCode(candidate) && !rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Unable to allocate a unique castle room");
    const room = { code, hostId, playerKey: null, playerSocketId: null, playerName: null };
    rooms.set(code, room);
    return { code };
  }

  function join(code, { key, name, socketId }) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };
    if (room.playerKey && room.playerKey !== key && room.playerSocketId) {
      return { ok: false, reason: "room-full" };
    }
    room.playerKey = key;
    room.playerSocketId = socketId;
    room.playerName = name;
    return { ok: true, name: room.playerName };
  }

  function isPlayer(code, socketId) {
    return rooms.get(code)?.playerSocketId === socketId;
  }

  function disconnect(socketId) {
    for (const [code, room] of rooms) {
      if (room.hostId === socketId) {
        rooms.delete(code);
        return { role: "host", code };
      }
      if (room.playerSocketId === socketId) {
        room.playerSocketId = null;
        return { role: "player", code };
      }
    }
    return null;
  }

  return {
    createHost,
    join,
    isPlayer,
    disconnect,
    get: (code) => rooms.get(code) ?? null,
  };
}
