import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import io from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelayServer } from "../relay/server.mjs";
import { createRoomRegistry } from "../relay/rooms.js";
import { EVENTS } from "../src/shared/protocol.js";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function nextC2d(socket) {
  return new Promise((resolve) => socket.once("relay:c2d", (message, acknowledge) => resolve({ message, acknowledge })));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("relay server", () => {
  let relay;
  let url;
  let bridge;
  const secret = "abcdEFGH12345678";

  beforeAll(async () => {
    const distDir = mkdtempSync(path.join(tmpdir(), "relay-dist-"));
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>controller</title>");
    const httpServer = createHttpServer();
    const relayServer = createRelayServer({ registry: createRoomRegistry(), distDir, tls: null });
    httpServer.on("request", relayServer.app);
    relayServer.attachIo(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
    relay = {
      close: () => new Promise((done) => relayServer.close(() => httpServer.close(() => done()))),
    };
    bridge = io(url, { transports: ["websocket"] });
    await nextEvent(bridge, "connect");
    const registered = await emitAck(bridge, "relayRegister", { code: "123456", secret });
    expect(registered.ok).toBe(true);
  });

  afterAll(async () => {
    bridge.close();
    await relay.close();
  });

  it("serves the controller shell from the dist dir", async () => {
    const response = await fetch(`${url}/controller?room=123456`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("controller");
  });

  it("rejects phone joins with a bad room key", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");
    const result = await emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: "wrong-secret-xx" });
    expect(result).toMatchObject({ ok: false, reason: "room-not-found" });
    phone.close();
  });

  it("pairs a phone with the desktop bridge and returns the acked slot", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");

    const joinResult = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const { message, acknowledge } = await nextC2d(bridge);
    expect(message).toMatchObject({ code: "123456", event: EVENTS.controllerJoin });
    expect(message.payload).toEqual({ room: "123456", deviceToken: "token-aaaa" });

    acknowledge({ ok: true, slot: 0 });
    expect(await joinResult).toEqual({ ok: true, slot: 0 });
    phone.close();
  });

  it("forwards controller traffic to the bridge with acks", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");

    const joinResult = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const joinC2d = await nextC2d(bridge);
    joinC2d.acknowledge({ ok: true, slot: 0 });
    expect(await joinResult).toEqual({ ok: true, slot: 0 });

    const inputResult = emitAck(phone, EVENTS.controllerInput, {
      seq: 1, sentAt: 5, move: { x: 0, y: 1 }, viewDelta: { yaw: 0, pitch: 0 }, clutch: false,
    });
    const inputC2d = await nextC2d(bridge);
    expect(inputC2d.message.event).toBe(EVENTS.controllerInput);
    expect(inputC2d.message.payload).toMatchObject({ seq: 1 });
    inputC2d.acknowledge({ ok: true, reason: undefined });
    expect(await inputResult).toEqual({ ok: true, reason: undefined });
    phone.close();
  });

  it("routes desktop traffic back to the right phone", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");
    const joinResult = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const joinC2d = await nextC2d(bridge);
    joinC2d.acknowledge({ ok: true, slot: 0 });
    expect(await joinResult).toEqual({ ok: true, slot: 0 });
    const cid = joinC2d.message.cid;

    const atPhone = nextEvent(phone, EVENTS.desktopEvent);
    bridge.emit("relay:d2c", { code: "123456", cid, event: EVENTS.desktopEvent, payload: { type: "ping" } });
    expect(await atPhone).toEqual({ type: "ping" });

    const rtcAtPhone = nextEvent(phone, EVENTS.rtcSignal);
    bridge.emit("relay:d2c", { code: "123456", cid, event: EVENTS.rtcSignal, payload: { candidate: { c: 1 } } });
    expect(await rtcAtPhone).toEqual({ candidate: { c: 1 } });
    phone.close();
  });

  it("notifies phones and keeps the room warm when the bridge drops", async () => {
    const phone = io(url, { transports: ["websocket"] });
    await nextEvent(phone, "connect");
    const joinResult = emitAck(phone, EVENTS.controllerJoin, { room: "123456", k: secret, deviceToken: "token-aaaa" });
    const joinC2d = await nextC2d(bridge);
    joinC2d.acknowledge({ ok: true, slot: 0 });
    expect(await joinResult).toEqual({ ok: true, slot: 0 });

    const ended = nextEvent(phone, EVENTS.sessionEnded);
    bridge.close();
    await ended;

    const bridge2 = io(url, { transports: ["websocket"] });
    await nextEvent(bridge2, "connect");
    const registered = await emitAck(bridge2, "relayRegister", { code: "123456", secret });
    expect(registered.ok).toBe(true);
    bridge2.close();
    phone.close();
    bridge = io(url, { transports: ["websocket"] });
    await nextEvent(bridge, "connect");
    await emitAck(bridge, "relayRegister", { code: "123456", secret });
  });
});
