import { describe, expect, it, vi } from "vitest";
import { LobbyClient, LOBBY_EVENTS } from "../src/desktop/LobbyClient.js";

const { socketIoMock } = vi.hoisted(() => ({ socketIoMock: vi.fn() }));

vi.mock("socket.io-client", () => ({ io: socketIoMock }));

function fakeSocket() {
  const listeners = new Map();
  const socket = {
    id: "socket-1",
    connected: false,
    on: vi.fn((name, listener) => listeners.set(name, listener)),
    once: vi.fn((name, listener) => listeners.set(name, listener)),
    emit: vi.fn(),
    disconnect: vi.fn(),
    fire(name, payload) {
      listeners.get(name)?.(payload);
    },
  };
  socket.timeout = vi.fn(() => socket);
  socket.connectNow = () => {
    socket.connected = true;
    listeners.get("connect")?.();
  };
  return socket;
}

function configFetch(controllerOrigin) {
  return vi.fn(async () => ({ json: async () => ({ controllerOrigin }) }));
}

function mockIo(socket) {
  socketIoMock.mockImplementation(() => {
    setTimeout(() => socket.connectNow(), 0);
    return socket;
  });
}

describe("lobby client", () => {
  it("reports cloud-unavailable when no controller origin is configured", async () => {
    const client = new LobbyClient({ fetchImpl: configFetch(null), ioImpl: socketIoMock });
    const result = await client.create("主机");
    expect(result).toEqual({ ok: false, reason: "cloud-unavailable" });
    expect(socketIoMock).not.toHaveBeenCalled();
  });

  it("connects to the cloud origin and creates a lobby", async () => {
    const socket = fakeSocket();
    mockIo(socket);
    socket.emit = vi.fn((event, payload, acknowledge) => {
      if (event === LOBBY_EVENTS.create && typeof acknowledge === "function") {
        socket.fire(LOBBY_EVENTS.state, {
          code: "424242",
          state: "lobby",
          players: [{ socketId: "socket-1", name: "主机", isHost: true }],
        });
        acknowledge(null, [{ ok: true, code: "424242" }]);
      }
    });
    const client = new LobbyClient({ fetchImpl: configFetch("https://play.tokenxapp.com:8443"), ioImpl: socketIoMock });
    const states = [];
    client.addEventListener("state", (event) => states.push(event.detail));

    const created = await client.create("主机");
    expect(created).toEqual({ ok: true, code: "424242" });
    expect(socketIoMock).toHaveBeenCalledWith("https://play.tokenxapp.com:8443", { transports: ["websocket"] });
    expect(client.code).toBe("424242");
    expect(states).toHaveLength(1);
  });

  it("forwards started and ended events and clears the lobby code", async () => {
    const socket = fakeSocket();
    mockIo(socket);
    socket.emit = vi.fn((event, payload, acknowledge) => {
      if (event === LOBBY_EVENTS.create && typeof acknowledge === "function") {
        acknowledge(null, [{ ok: true, code: "424242" }]);
      }
    });
    const client = new LobbyClient({ fetchImpl: configFetch("https://cloud"), ioImpl: socketIoMock });
    await client.create("主机");

    const started = [];
    const ended = [];
    client.addEventListener("started", (event) => started.push(event.detail));
    client.addEventListener("ended", (event) => ended.push(event.detail));

    socket.fire(LOBBY_EVENTS.state, { code: "424242", state: "lobby", players: [] });
    expect(client.code).toBe("424242");
    socket.fire(LOBBY_EVENTS.started, { code: "424242" });
    expect(started).toEqual([{ code: "424242" }]);
    socket.fire(LOBBY_EVENTS.ended, { code: "424242", reason: "host-left" });
    expect(ended).toEqual([{ code: "424242", reason: "host-left" }]);
    expect(client.code).toBe(null);
    client.destroy();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it("joins by code and surfaces the server rejection", async () => {
    const socket = fakeSocket();
    mockIo(socket);
    socket.emit = vi.fn((event, payload, acknowledge) => {
      if (typeof acknowledge === "function") {
        acknowledge(null, [{ ok: false, reason: "lobby-not-found" }]);
      }
    });
    const client = new LobbyClient({ fetchImpl: configFetch("https://cloud"), ioImpl: socketIoMock });
    const result = await client.join("999999", "玩家");
    expect(result).toEqual({ ok: false, reason: "lobby-not-found" });
  });
});
