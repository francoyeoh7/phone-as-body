import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import io from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelayServer } from "../relay/server.mjs";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("relay lobby", () => {
  let relay;
  let url;
  let host;
  let guest;

  beforeAll(async () => {
    const distDir = mkdtempSync(path.join(tmpdir(), "relay-dist-"));
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>controller</title>");
    const httpServer = createHttpServer();
    const relayServer = createRelayServer({ distDir, tls: null });
    httpServer.on("request", relayServer.app);
    relayServer.attachIo(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
    relay = {
      close: () => new Promise((done) => relayServer.close(() => httpServer.close(() => done()))),
    };
    host = io(url, { transports: ["websocket"] });
    guest = io(url, { transports: ["websocket"] });
    await Promise.all([nextEvent(host, "connect"), nextEvent(guest, "connect")]);
  });

  afterAll(async () => {
    host.close();
    guest.close();
    await relay.close();
  });

  it("creates a lobby and broadcasts the roster", async () => {
    const stateAtHost = nextEvent(host, "lobby:state");
    const created = await emitAck(host, "lobby:create", { name: "房主电脑" });
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^\d{6}$/);

    const state = await stateAtHost;
    expect(state.code).toBe(created.code);
    expect(state.state).toBe("lobby");
    expect(state.players).toEqual([
      { socketId: host.id, name: "房主电脑", isHost: true },
    ]);
  });

  it("joins by code from another desktop and both see the updated roster", async () => {
    const created = await emitAck(host, "lobby:create", { name: "房主电脑" });
    const code = created.code;

    const stateAtHost = nextEvent(host, "lobby:state");
    const stateAtGuest = nextEvent(guest, "lobby:state");
    const joined = await emitAck(guest, "lobby:join", { code, name: "玩家电脑" });
    expect(joined).toEqual({ ok: true });

    const hostState = await stateAtHost;
    const guestState = await stateAtGuest;
    expect(hostState.players.map((player) => player.name)).toEqual(["房主电脑", "玩家电脑"]);
    expect(guestState.players).toEqual(hostState.players);
  });

  it("rejects guest starts and broadcasts started to everyone on host start", async () => {
    const created = await emitAck(host, "lobby:create", { name: "房主电脑" });
    const code = created.code;
    await emitAck(guest, "lobby:join", { code, name: "玩家电脑" });

    expect(await emitAck(guest, "lobby:start", { code })).toMatchObject({ ok: false, reason: "not-host" });

    const startedAtHost = nextEvent(host, "lobby:started");
    const startedAtGuest = nextEvent(guest, "lobby:started");
    expect(await emitAck(host, "lobby:start", { code })).toEqual({ ok: true });
    expect((await startedAtHost).code).toBe(code);
    expect((await startedAtGuest).code).toBe(code);
  });

  it("ends the lobby for everyone when the host leaves", async () => {
    const created = await emitAck(host, "lobby:create", { name: "房主电脑" });
    const code = created.code;
    await emitAck(guest, "lobby:join", { code, name: "玩家电脑" });

    const endedAtGuest = nextEvent(guest, "lobby:ended");
    host.emit("lobby:leave");
    const ended = await endedAtGuest;
    expect(ended.reason).toBe("host-left");
    expect(await emitAck(guest, "lobby:join", { code, name: "玩家电脑" })).toMatchObject({ ok: false });
  });
});
