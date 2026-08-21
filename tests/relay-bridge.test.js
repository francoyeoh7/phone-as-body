import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server as SocketIOServer } from "socket.io";
import io from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";
import { createSocketRouter } from "../server/socket-router.js";
import { createRelayBridge } from "../server/relay-bridge.js";
import { createRelayServer } from "../relay/server.mjs";
import { EVENTS } from "../src/shared/protocol.js";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve);
    else socket.emit(event, payload, resolve);
  });
}

describe("relay bridge end to end", () => {
  let local;
  let relay;
  let bridge;
  let desktop;
  let phone;
  let room;
  let secret;

  beforeAll(async () => {
    const localHttp = createHttpServer();
    const localIo = new SocketIOServer(localHttp, { serveClient: false });
    await new Promise((resolve) => localHttp.listen(0, "127.0.0.1", resolve));
    const localUrl = `http://127.0.0.1:${localHttp.address().port}`;

    const distDir = mkdtempSync(path.join(tmpdir(), "relay-dist-"));
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>controller</title>");
    const relayHttp = createHttpServer();
    const relayServer = createRelayServer({ distDir, tls: null });
    relayHttp.on("request", relayServer.app);
    relayServer.attachIo(relayHttp);
    await new Promise((resolve) => relayHttp.listen(0, "127.0.0.1", resolve));
    const relayUrl = `http://127.0.0.1:${relayHttp.address().port}`;

    bridge = createRelayBridge({ relayUrl, localServerUrl: localUrl });
    createSocketRouter(localIo, createSessionRegistry(), bridge);

    desktop = io(localUrl, { transports: ["websocket"] });
    await nextEvent(desktop, "connect");
    const created = await emitAck(desktop, EVENTS.desktopCreate, undefined);
    room = created.code;
    secret = created.secret;
    await new Promise((resolve) => setTimeout(resolve, 100));

    phone = io(relayUrl, { transports: ["websocket"] });
    await nextEvent(phone, "connect");

    local = { url: localUrl, close: () => new Promise((done) => localIo.close(() => localHttp.close(() => done()))) };
    relay = { url: relayUrl, close: () => new Promise((done) => relayServer.close(() => relayHttp.close(() => done()))) };
  });

  afterAll(async () => {
    desktop.close();
    phone.close();
    bridge.close();
    await relay.close();
    await local.close();
  });

  it("joins through the bridge and reports the slot", async () => {
    const status = nextEvent(desktop, EVENTS.peerStatus);
    const joined = await emitAck(phone, EVENTS.controllerJoin, { room, k: secret, deviceToken: "token-aaaa" });
    expect(joined).toEqual({ ok: true, slot: 0 });
    expect(await status).toEqual({ connected: true, slot: 0 });
  });

  it("forwards input envelopes to the desktop with the slot", async () => {
    const envelope = nextEvent(desktop, EVENTS.controllerInput);
    phone.emit(EVENTS.controllerInput, {
      seq: 1, sentAt: 5, move: { x: 0, y: 1 }, viewDelta: { yaw: 2, pitch: 0 }, clutch: false,
    });
    expect(await envelope).toMatchObject({ slot: 0, input: { seq: 1 } });
  });

  it("routes desktop events back to the phone", async () => {
    const atPhone = nextEvent(phone, EVENTS.desktopEvent);
    desktop.emit(EVENTS.desktopEvent, { type: "control-feedback", kind: "step" });
    expect(await atPhone).toEqual({ type: "control-feedback", kind: "step" });
  });

  it("routes rtc signalling both ways", async () => {
    const atPhone = nextEvent(phone, EVENTS.rtcSignal);
    desktop.emit(EVENTS.rtcSignal, { slot: 0, description: { type: "offer", sdp: "s" } });
    expect(await atPhone).toEqual({ description: { type: "offer", sdp: "s" } });

    const atDesktop = nextEvent(desktop, EVENTS.rtcSignal);
    phone.emit(EVENTS.rtcSignal, { candidate: { candidate: "c" } });
    expect(await atDesktop).toEqual({ slot: 0, candidate: { candidate: "c" } });
  });

  it("reclaims the slot when the same device rejoins via a new cloud socket", async () => {
    const phone2 = io(relay.url, { transports: ["websocket"] });
    await nextEvent(phone2, "connect");
    const status = nextEvent(desktop, EVENTS.peerStatus);
    const joined = await emitAck(phone2, EVENTS.controllerJoin, { room, k: secret, deviceToken: "token-aaaa" });
    expect(joined).toEqual({ ok: true, slot: 0 });
    expect(await status).toEqual({ connected: true, slot: 0 });
    phone2.close();
  });
});
