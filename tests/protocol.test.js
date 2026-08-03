import { describe, expect, it, vi } from "vitest";
import { ControllerSocket } from "../src/controller/ControllerSocket.js";
import { PhoneSession } from "../src/desktop/PhoneSession.js";
import * as protocol from "../src/shared/protocol.js";

const controllerInput = (overrides = {}) => ({
  seq: 1,
  sentAt: 100,
  move: { x: 0, y: 1 },
  viewDelta: { yaw: 42, pitch: -18 },
  clutch: true,
  ...overrides,
});

describe("view delta protocol", () => {
  it("accepts finite bounded view deltas in degrees", () => {
    expect(protocol.isViewDelta({ yaw: 42, pitch: -18 })).toBe(true);
    expect(protocol.isControllerInput(controllerInput())).toBe(true);
  });

  it("requires an explicit clutch state on every controller packet", () => {
    expect(protocol.isControllerInput(controllerInput({ clutch: false }))).toBe(true);
    expect(protocol.isControllerInput(controllerInput({ clutch: undefined }))).toBe(false);
  });

  it.each([
    null,
    { yaw: 181, pitch: 0 },
    { yaw: 0, pitch: -181 },
    { yaw: Number.NaN, pitch: 0 },
    { yaw: 0, pitch: Number.POSITIVE_INFINITY },
  ])("rejects invalid view deltas", (value) => {
    expect(protocol.isViewDelta(value)).toBe(false);
  });
});

describe("sustained gesture actions", () => {
  it("accepts a complete gesture-presence action", () => {
    expect(protocol.isControllerAction({
      action: "gesture-presence",
      ready: true,
      active: false,
      context: "door-defense",
    })).toBe(true);
  });

  it("rejects gesture-presence actions with an unknown context", () => {
    expect(protocol.isControllerAction({
      action: "gesture-presence",
      ready: true,
      active: true,
      context: "wrong",
    })).toBe(false);
  });

  it("requires boolean presence fields", () => {
    expect(protocol.isControllerAction({
      action: "gesture-presence",
      ready: "yes",
      active: true,
      context: "found-phone",
    })).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects non-finite sentAt values", (sentAt) => {
    expect(protocol.isControllerAction({
      action: "gesture-presence",
      ready: true,
      active: true,
      context: "door-defense",
      sentAt,
    })).toBe(false);
  });

  it("rejects a function even when it has a valid-looking gesture payload", () => {
    const malformedEnvelope = Object.assign(() => {}, {
      action: "gesture-presence",
      ready: true,
      active: true,
      context: "door-defense",
    });

    expect(protocol.isControllerAction(malformedEnvelope)).toBe(false);
  });
});

describe("controller snapshot flush", () => {
  it("accumulates orientation deltas until the next network flush", () => {
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };

    socket.setInput({ move: { x: 0, y: 1 }, viewDelta: { yaw: 40, pitch: -10 }, clutch: true });
    socket.setInput({ move: { x: 0, y: 1 }, viewDelta: { yaw: 20, pitch: 5 } });
    socket.flush();

    expect(socket.socket.emit).toHaveBeenCalledWith(
      protocol.EVENTS.controllerInput,
      expect.objectContaining({
        move: { x: 0, y: 1 },
        viewDelta: { yaw: 60, pitch: -5 },
        clutch: true,
      }),
      expect.any(Function),
    );
    expect(socket.pendingViewDelta).toEqual({ yaw: 0, pitch: 0 });
  });

  it("flushes changed input immediately and reports server RTT", () => {
    let now = 100;
    const telemetry = vi.fn();
    const socket = new ControllerSocket({ room: "617042", onTelemetry: telemetry, now: () => now });
    socket.joined = true;
    socket.socket = {
      connected: true,
      io: { engine: { transport: { name: "websocket" } } },
      emit: vi.fn((_event, _payload, acknowledge) => {
        now = 112;
        acknowledge?.({ ok: true });
      }),
    };

    socket.setInput({ move: { x: 0.25, y: 0.75 } }, { immediate: true });

    expect(socket.socket.emit).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      serverRttMs: 12,
      transport: "websocket",
    }));
  });

  it("matches desktop feedback to an input sequence for applied RTT", () => {
    let now = 200;
    const telemetry = vi.fn();
    const socket = new ControllerSocket({ room: "617042", onTelemetry: telemetry, now: () => now });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };

    socket.setInput({ move: { x: 0, y: 1 } }, { immediate: true });
    now = 248;
    socket.markApplied({ seq: 1, cameraYaw: 32, cameraPitch: -4 });

    expect(telemetry).toHaveBeenLastCalledWith(expect.objectContaining({
      appliedRttMs: 48,
      cameraYaw: 32,
      cameraPitch: -4,
    }));
  });

  it("prefers an open WebRTC data channel for controller input", () => {
    const telemetry = vi.fn();
    const socket = new ControllerSocket({ room: "617042", onTelemetry: telemetry, now: () => 300 });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    socket.dataChannel = { readyState: "open", send: vi.fn() };

    socket.setInput({ move: { x: -0.4, y: 0.6 } }, { immediate: true });

    expect(socket.dataChannel.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.dataChannel.send.mock.calls[0][0])).toMatchObject({
      type: "input",
      payload: { seq: 1, move: { x: -0.4, y: 0.6 } },
    });
    expect(socket.socket.emit).not.toHaveBeenCalledWith(protocol.EVENTS.controllerInput, expect.anything());
    expect(telemetry).toHaveBeenLastCalledWith(expect.objectContaining({ transport: "webrtc" }));
  });

  it("returns desktop control feedback through WebRTC when available", () => {
    const session = new PhoneSession();
    session.dataChannel = { readyState: "open", send: vi.fn() };
    const feedback = { type: "control-feedback", seq: 9, cameraYaw: 70, cameraPitch: 4 };

    session.send(feedback);

    expect(JSON.parse(session.dataChannel.send.mock.calls[0][0])).toEqual({
      type: "feedback",
      payload: feedback,
    });
  });

  it("accumulates every accepted packet until the desktop consumes one frame", () => {
    const session = new PhoneSession();
    session.connected = true;

    session.acceptInput(controllerInput({ seq: 1, viewDelta: { yaw: 7, pitch: -3 } }));
    session.acceptInput(controllerInput({ seq: 2, viewDelta: { yaw: -2, pitch: 5 } }));

    expect(session.currentInput(10_000).viewDelta).toEqual({ yaw: 5, pitch: 2 });
    expect(session.currentInput(10_000).viewDelta).toEqual({ yaw: 0, pitch: 0 });
  });

  it("creates an ordered reliable WebRTC input channel", async () => {
    class FakePeer {
      constructor() {
        this.connectionState = "new";
        this.localDescription = null;
      }

      createDataChannel = vi.fn(() => ({ readyState: "connecting", close: vi.fn() }));
      createOffer = vi.fn(async () => ({ type: "offer", sdp: "fake" }));
      setLocalDescription = vi.fn(async (description) => {
        this.localDescription = description;
      });
      close = vi.fn();
    }

    vi.stubGlobal("RTCPeerConnection", FakePeer);
    const session = new PhoneSession();
    session.socket = { emit: vi.fn() };

    await session.startRtcOffer();

    expect(session.peerConnection.createDataChannel).toHaveBeenCalledWith("controls", { ordered: false });
    vi.unstubAllGlobals();
  });

  it("clears stale tunnel RTT when WebRTC opens", () => {
    const telemetry = vi.fn();
    const socket = new ControllerSocket({ room: "617042", onTelemetry: telemetry });
    socket.telemetry.serverRttMs = 480;
    const channel = { readyState: "open" };

    socket.attachDataChannel(channel);
    channel.onopen();

    expect(telemetry).toHaveBeenLastCalledWith(expect.objectContaining({
      transport: "webrtc",
      serverRttMs: null,
    }));
  });
});
