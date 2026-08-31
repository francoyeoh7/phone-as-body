import { isRoomCode } from "../src/shared/protocol.js";
import { EGG_MAX_PLAYERS } from "../src/shared/egg-protocol.js";

function defaultRandomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createEggRaceRegistry({ randomCode = defaultRandomCode } = {}) {
  const rooms = new Map();

  function snapshotPlayers(room) {
    return [...room.players.entries()]
      .map(([key, player]) => ({ key, slot: player.slot, name: player.name, connected: player.socketId !== null }))
      .sort((a, b) => a.slot - b.slot);
  }

  function createHost(hostId) {
    let code = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = String(randomCode());
      if (isRoomCode(candidate) && !rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Unable to allocate a unique egg race room");
    const room = { code, hostId, players: new Map() };
    rooms.set(code, room);
    return { code };
  }

  function join(code, { key, name, socketId }) {
    const room = rooms.get(code);
    if (!room) return { ok: false, reason: "room-not-found" };

    const existing = room.players.get(key);
    if (existing) {
      existing.socketId = socketId;
      if (name) existing.name = name;
      return { ok: true, slot: existing.slot, players: snapshotPlayers(room) };
    }

    // A newcomer reclaims the slot of a player who already left; the same key
    // can still reconnect to its own slot (handled above) until that happens.
    for (const [staleKey, player] of room.players) {
      if (player.socketId === null) {
        room.players.delete(staleKey);
        break;
      }
    }
    let slot = -1;
    const ghosts = [...room.players.entries()]
      .filter(([, player]) => player.socketId === null)
      .sort((a, b) => a[1].slot - b[1].slot);
    if (ghosts.length > 0) {
      const [ghostKey, ghost] = ghosts[0];
      room.players.delete(ghostKey);
      slot = ghost.slot;
    } else if (room.players.size < EGG_MAX_PLAYERS) {
      const usedSlots = new Set([...room.players.values()].map((player) => player.slot));
      for (let candidate = 0; candidate < EGG_MAX_PLAYERS; candidate += 1) {
        if (!usedSlots.has(candidate)) {
          slot = candidate;
          break;
        }
      }
    }
    if (slot < 0) return { ok: false, reason: "room-full" };

    room.players.set(key, { slot, name, socketId });
    return { ok: true, slot, players: snapshotPlayers(room) };
  }

  function socketFor(code, key) {
    return rooms.get(code)?.players.get(key)?.socketId ?? null;
  }

  function slotFor(code, socketId) {
    const room = rooms.get(code);
    if (!room) return null;
    for (const player of room.players.values()) {
      if (player.socketId === socketId) return player.slot;
    }
    return null;
  }

  function disconnect(socketId) {
    for (const [code, room] of rooms) {
      if (room.hostId === socketId) {
        rooms.delete(code);
        return { role: "host", code, players: snapshotPlayers(room) };
      }
      for (const [key, player] of room.players) {
        if (player.socketId === socketId) {
          player.socketId = null;
          return { role: "player", code, key, slot: player.slot, players: snapshotPlayers(room) };
        }
      }
    }
    return null;
  }

  return {
    createHost,
    join,
    socketFor,
    slotFor,
    disconnect,
    get: (code) => rooms.get(code) ?? null,
    snapshotPlayers,
  };
}
