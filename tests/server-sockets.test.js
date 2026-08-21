import { createServer as createHttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import io from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionRegistry } from "../server/session-registry.js";
import { createSocketRouter } from "../server/socket-router.js";
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

describe("socket router", () => {
  let hub;
  let desktop;
  let phoneA;
  let phoneB;

  beforeAll(async () => {
    const httpServer = createHttpServer();
    const hubIo = new SocketIOServer(httpServer, { serveClient: false });
    createSocketRouter(hubIo, createSessionRegistry());
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${httpServer.address().port}`;
    hub = {
      url,
      close: () => new Promise((done) => hubIo.close(() => httpServer.close(() => done()))),
    };
    desktop = io(hub.url, { transports: ["websocket"] });
    phoneA = io(hub.url, { transports: ["websocket"] });
    phoneB = io(hub.url, { transports: ["websocket"] });
  });

  afterAll(async () => {
    desktop.close();
    phoneA.close();
    phoneB.close();
    await hub.close();
  });

  it("creates a room with a secret and assigns ascending slots", async () => {
    const created = await emitAck(desktop, EVENTS.desktopCreate, undefined);
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const statusA = nextEvent(desktop, EVENTS.peerStatus);
    const joinedA = await emitAck(phoneA, EVENTS.controllerJoin, { room: created.code, deviceToken: "token-aaaa" });
    expect(joinedA).toMatchObject({ ok: true, slot: 0 });
    expect(await statusA).toEqual({ connected: true, slot: 0 });

    const statusB = nextEvent(desktop, EVENTS.peerStatus);
    const joinedB = await emitAck(phoneB, EVENTS.controllerJoin, { room: created.code, deviceToken: "token-bbbb" });
    expect(joinedB).toMatchObject({ ok: true, slot: 1 });
    expect(await statusB).toEqual({ connected: true, slot: 1 });
  });

  it("forwards slot-tagged input envelopes to the desktop", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const envelopeB = nextEvent(desktop, EVENTS.controllerInput);
    phoneB.emit(EVENTS.controllerInput, {
      seq: 5, sentAt: 10, move: { x: 0, y: 1 }, viewDelta: { yaw: 3, pitch: 0 }, clutch: false,
    });
    expect(await envelopeB).toMatchObject({ slot: 1, input: { seq: 5 } });

    const envelopeA = nextEvent(desktop, EVENTS.controllerInput);
    phoneA.emit(EVENTS.controllerInput, {
      seq: 1, sentAt: 10, move: { x: 1, y: 0 }, viewDelta: { yaw: 0, pitch: 0 }, clutch: true,
    });
    expect(await envelopeA).toMatchObject({ slot: 0, input: { seq: 1 } });
  });

  it("routes rtc signals per slot and strips the tag for phones", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const atB = nextEvent(phoneB, EVENTS.rtcSignal);
    desktop.emit(EVENTS.rtcSignal, { slot: 1, candidate: { candidate: "x" } });
    expect(await atB).toEqual({ candidate: { candidate: "x" } });

    const atDesktop = nextEvent(desktop, EVENTS.rtcSignal);
    phoneA.emit(EVENTS.rtcSignal, { description: { type: "offer", sdp: "s" } });
    expect(await atDesktop).toEqual({ slot: 0, description: { type: "offer", sdp: "s" } });
  });

  it("broadcasts desktop events to every controller", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const atA = nextEvent(phoneA, EVENTS.desktopEvent);
    const atB = nextEvent(phoneB, EVENTS.desktopEvent);
    desktop.emit(EVENTS.desktopEvent, { type: "control-feedback", kind: "step" });
    expect(await atA).toEqual({ type: "control-feedback", kind: "step" });
    expect(await atB).toEqual({ type: "control-feedback", kind: "step" });
  });

  it("reclaims the slot for a returning device token and notifies the desktop", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const status = nextEvent(desktop, EVENTS.peerStatus);
    const reclaimer = io(hub.url, { transports: ["websocket"] });
    const rejoined = await emitAck(reclaimer, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    expect(rejoined).toMatchObject({ ok: true, slot: 0 });
    expect(await status).toEqual({ connected: true, slot: 0 });
    reclaimer.close();
  });

  it("reports per-slot disconnects and ends sessions with the desktop", async () => {
    const room = (await emitAck(desktop, EVENTS.desktopCreate, undefined)).code;
    await emitAck(phoneA, EVENTS.controllerJoin, { room, deviceToken: "token-aaaa" });
    await emitAck(phoneB, EVENTS.controllerJoin, { room, deviceToken: "token-bbbb" });

    const status = nextEvent(desktop, EVENTS.peerStatus);
    phoneA.close();
    expect(await status).toEqual({ connected: false, slot: 0 });

    const endedB = nextEvent(phoneB, EVENTS.sessionEnded);
    desktop.close();
    await endedB;
    desktop = io(hub.url, { transports: ["websocket"] });
    await nextEvent(desktop, "connect");
  });
});
