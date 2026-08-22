import { isRoomCode } from "../src/shared/protocol.js";

function defaultRandomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createLobbyRegistry({
  randomCode = defaultRandomCode,
  maxDesktops = 8,
} = {}) {
  const lobbies = new Map();

  function create(hostSocketId, name) {
    let code;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = String(randomCode());
      if (isRoomCode(candidate) && !lobbies.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Unable to allocate a unique lobby code");

    lobbies.set(code, {
      code,
      state: "lobby",
      players: [{ socketId: hostSocketId, name: String(name || "主机"), isHost: true }],
    });
    return { code };
  }

  function join(code, socketId, name) {
    const lobby = lobbies.get(code);
    if (!lobby) return { ok: false, reason: "lobby-not-found" };
    if (lobby.state === "playing") return { ok: false, reason: "already-playing" };
    if (lobby.players.some((player) => player.socketId === socketId)) {
      return { ok: false, reason: "already-joined" };
    }
    if (lobby.players.length >= maxDesktops) return { ok: false, reason: "lobby-full" };
    lobby.players.push({ socketId, name: String(name || `电脑${lobby.players.length + 1}`), isHost: false });
    return { ok: true };
  }

  function start(code, socketId) {
    const lobby = lobbies.get(code);
    if (!lobby) return { ok: false, reason: "lobby-not-found" };
    const player = lobby.players.find((entry) => entry.socketId === socketId);
    if (!player?.isHost) return { ok: false, reason: "not-host" };
    lobby.state = "playing";
    return { ok: true };
  }

  function leave(socketId) {
    for (const lobby of lobbies.values()) {
      const index = lobby.players.findIndex((player) => player.socketId === socketId);
      if (index === -1) continue;
      const wasHost = lobby.players[index].isHost;
      lobby.players.splice(index, 1);
      if (wasHost || lobby.players.length === 0) {
        lobbies.delete(lobby.code);
        return { ok: true, code: lobby.code, ended: true };
      }
      return { ok: true, code: lobby.code, ended: false };
    }
    return { ok: false };
  }

  function stateOf(code) {
    const lobby = lobbies.get(code);
    if (!lobby) return null;
    return {
      code: lobby.code,
      state: lobby.state,
      players: lobby.players.map((player) => ({ ...player })),
    };
  }

  return { create, join, start, leave, stateOf };
}
