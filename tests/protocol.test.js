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

const handLandmarks = () => Array.from({ length: 21 }, (_, index) => [
  index === 9 ? 0 : index === 17 ? 1 : 0.1 + index / 100,
  index === 5 || index === 17 ? 1 : 0.2 + index / 100,
  index === 9 ? 1 : 0.3 + index / 100,
]);

const handFrame = (overrides = {}) => ({
  version: 1,
  seq: 1,
  capturedAt: 4102.3,
  modeEpoch: 4,
  state: "tracked",
  handedness: "left",
  handConfidence: 0.94,
  trackingConfidence: 0.87,
  landmarks: handLandmarks(),
  worldLandmarks: handLandmarks(),
  center: [0.1, 0.2, 0.3],
  wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
  curls: [0.1, 0.2, 0.3, 0.4, 0.5],
  openness: 0.82,
  grabStrength: 0.18,
  palmFacing: 0.76,
  relativeScale: 1.04,
  velocity: 0.03,
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

describe("strict hand frame protocol", () => {
  it("accepts a complete tracked frame with exactly 21 finite points", () => {
    expect(protocol.EVENTS.controllerHand).toBe("controller:hand");
    expect(protocol.isHandFrame(handFrame())).toBe(true);
  });

  it.each([
    ["20 landmarks", { landmarks: handLandmarks().slice(0, 20) }],
    ["invalid confidence", { handConfidence: 1.01 }],
    ["unknown state", { state: "maybe" }],
    ["raw video key", { video: undefined }],
    ["non-orthogonal wrist", { wrist: { right: [1, 0, 0], up: [1, 0, 0], forward: [0, 0, 1] } }],
  ])("rejects %s", (_label, overrides) => {
    expect(protocol.isHandFrame(handFrame(overrides))).toBe(false);
  });

  it("rejects a serialized payload over 12 KiB and catches stringify failures", () => {
    expect(protocol.isHandFrame(handFrame({ reason: "x".repeat(13_000) }))).toBe(false);
    const circular = handFrame();
    circular.loop = circular;
    expect(protocol.isHandFrame(circular)).toBe(false);
  });

  it("accepts status frames without landmark arrays", () => {
    expect(protocol.isHandFrame({
      version: 1, seq: 2, capturedAt: 1, modeEpoch: 0, state: "lost", reason: "occluded",
    })).toBe(true);
    expect(protocol.isHandFrame({
      version: 1, seq: 2, capturedAt: 1, modeEpoch: 0, state: "unavailable", landmarks: [],
    })).toBe(false);
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

      createDataChannel = vi.fn((label) => ({ label, readyState: "connecting", close: vi.fn() }));
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

    expect(session.peerConnection.createDataChannel).toHaveBeenNthCalledWith(1, "controls", { ordered: false });
    expect(session.peerConnection.createDataChannel).toHaveBeenNthCalledWith(2, "hand", { ordered: false, maxRetransmits: 0 });
    expect(session.handChannel).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("routes labeled channels independently and keeps controls feedback on controls", () => {
    const socket = new ControllerSocket({ room: "617042" });
    const controls = { label: "controls", readyState: "open", send: vi.fn(), close: vi.fn() };
    const hand = { label: "hand", readyState: "open", bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    socket.attachDataChannel(controls);
    socket.attachDataChannel(hand);
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };

    socket.setInput({ move: { x: 0, y: 1 } }, { immediate: true });
    socket.sendHandFrame(handFrame({ seq: 7 }));

    expect(controls.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(hand.send.mock.calls[0][0])).toMatchObject({ type: "hand", payload: { seq: 7 } });
    hand.onclose();
    socket.setInput({ move: { x: 1, y: 0 } }, { immediate: true });
    expect(controls.send).toHaveBeenCalledTimes(2);
  });

  it.each([32768, 32769])("handles hand-channel high-water boundary %s", (bufferedAmount) => {
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    socket.handChannel = { readyState: "open", bufferedAmount, send: vi.fn() };
    socket.sendHandFrame(handFrame());
    if (bufferedAmount <= 32768) expect(socket.handChannel.send).toHaveBeenCalledOnce();
    else expect(socket.handChannel.send).not.toHaveBeenCalled();
    expect(socket.socket.emit).not.toHaveBeenCalledWith(protocol.EVENTS.controllerHand, expect.anything(), expect.anything());
  });

  it("dispatches only newer hand frames with local receive time", () => {
    vi.stubGlobal("performance", { now: vi.fn(() => 9876) });
    const session = new PhoneSession();
    const hand = vi.fn();
    session.addEventListener("hand", hand);
    session.acceptHandFrame(handFrame({ seq: 2, modeEpoch: 1 }));
    session.acceptHandFrame(handFrame({ seq: 1, modeEpoch: 1 }));
    session.acceptHandFrame(handFrame({ seq: 3, modeEpoch: 0 }));
    session.acceptHandFrame(handFrame({ seq: 3, modeEpoch: 2 }));
    expect(hand).toHaveBeenCalledTimes(2);
    expect(hand.mock.calls[0][0].detail.receivedAt).toBe(9876);
    expect(hand.mock.calls[1][0].detail.seq).toBe(3);
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
