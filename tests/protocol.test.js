import { describe, expect, it, vi } from "vitest";
import { ControllerSocket } from "../src/controller/ControllerSocket.js";
import { PhoneSession } from "../src/desktop/PhoneSession.js";
import { MediaPipeHandTracker } from "../src/controller/MediaPipeHandTracker.js";
import * as protocol from "../src/shared/protocol.js";

const { socketIoMock } = vi.hoisted(() => ({ socketIoMock: vi.fn() }));

vi.mock("socket.io-client", () => ({ io: socketIoMock }));

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
  pinchStrength: 0.3,
  reachEligible: true,
  reachProgress: 1,
  depth: -0.04,
  palmSpan: 0.18,
  palmFacing: 0.76,
  relativeScale: 1.04,
  velocity: 0.03,
  ...overrides,
});

const trackerFrame = () => {
  const points = Array.from({ length: 21 }, (_, index) => ({
    x: (index % 5) / 5,
    y: Math.floor(index / 5) / 5,
    z: 0,
  }));
  let frame;
  const tracker = new MediaPipeHandTracker({ inputMirrored: false, onFrame: (next) => { frame = next; } });
  tracker.active = true;
  tracker.modeEpoch = 1;
  tracker.handleResult({
    result: { landmarks: [points], worldLandmarks: [points], handedness: [[{ categoryName: "Right", score: 0.94 }]] },
    capturedAt: 20,
  });
  return frame;
};

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

  it("accepts the actual rear-camera tracker frame with a boolean mirror flag", () => {
    const frame = trackerFrame();
    expect(frame).toMatchObject({ state: "tracked", handedness: "left", inputMirrored: false });
    expect(protocol.isHandFrame(frame)).toBe(true);
  });

  it.each([null, "false", 0, 1])( "rejects a non-boolean inputMirrored value: %p", (inputMirrored) => {
    expect(protocol.isHandFrame(handFrame({ inputMirrored }))).toBe(false);
  });

  it("keeps legacy input valid while accepting only boolean crouch state", () => {
    expect(protocol.isControllerInput(controllerInput())).toBe(true);
    expect(protocol.isControllerInput(controllerInput({ crouch: true }))).toBe(true);
    expect(protocol.isControllerInput(controllerInput({ crouch: "true" }))).toBe(false);
  });

  it("rejects physical-right tracked envelopes while retaining status frames", () => {
    expect(protocol.isHandFrame(handFrame({ handedness: "right" }))).toBe(false);
    expect(protocol.isHandFrame({
      version: 1, seq: 2, capturedAt: 1, modeEpoch: 0, state: "lost", reason: "no-hand",
    })).toBe(true);
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

describe("voice and inventory transient protocol", () => {
  it("validates only bounded 24 kHz PCM16 voice stream frames", () => {
    expect(protocol.isVoiceStreamFrame({ type: "voice-start", sampleRate: 24_000, format: "pcm16" })).toBe(true);
    expect(protocol.isVoiceStreamFrame({ type: "voice-stop" })).toBe(true);
    expect(protocol.isVoiceStreamFrame(new ArrayBuffer(640))).toBe(true);
    expect(protocol.isVoiceStreamFrame(new ArrayBuffer(0))).toBe(false);
    expect(protocol.isVoiceStreamFrame(new ArrayBuffer(32_769))).toBe(false);
    expect(protocol.isVoiceStreamFrame({ type: "voice-start", sampleRate: 44_100, format: "pcm16" })).toBe(false);
  });

  const voiceClip = (overrides = {}) => ({
    version: 1,
    seq: 0,
    durationMs: 900,
    mimeType: "audio/webm;codecs=opus",
    data: new Uint8Array([1, 2, 3]),
    ...overrides,
  });

  it("accepts bounded binary voice clips and exposes their event", () => {
    expect(protocol.EVENTS.controllerVoiceClip).toBe("controller:voice-clip");
    expect(protocol.isVoiceClip(voiceClip())).toBe(true);
    expect(protocol.isVoiceClip(voiceClip({ data: new Uint8Array(768 * 1024) }))).toBe(true);
    expect(protocol.isVoiceClip(voiceClip({ data: new Uint8Array(1024 * 1024 + 1) }))).toBe(false);
  });

  it.each([
    ["raw media", { data: "raw" }],
    ["base64 media", { data: "AQID" }],
    ["unapproved mime", { mimeType: "audio/wav" }],
    ["too long", { durationMs: 10_001 }],
    ["empty data", { data: new Uint8Array() }],
  ])("rejects voice clips with %s", (_label, overrides) => {
    expect(protocol.isVoiceClip(voiceClip(overrides))).toBe(false);
  });

  it("accepts only exact voice-recording action keys", () => {
    expect(protocol.isControllerAction({ action: "voice-recording", active: true, sentAt: 10 })).toBe(true);
    expect(protocol.isControllerAction({ action: "voice-recording", active: true, data: "raw" })).toBe(false);
    expect(protocol.isControllerAction({ action: "voice-recording", active: true, dataUrl: "AQID" })).toBe(false);
  });

  it("accepts bounded interim voice transcripts without weakening the action shape", () => {
    const transcript = {
      action: "voice-transcript",
      transcript: "有人看到我的PPT吗",
      confidence: 0.8,
      voiceLevel: 0.6,
      interim: true,
    };

    expect(protocol.isControllerAction(transcript)).toBe(true);
    expect(protocol.isControllerAction({ ...transcript, interim: "yes" })).toBe(false);
    expect(protocol.isControllerAction({ ...transcript, rawAudio: "data" })).toBe(false);
  });

  it("bounds inventory pointer movement and rejects deltas for other phases", () => {
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "open" })).toBe(true);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "open", entryY: 0.25 })).toBe(true);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "open", entryY: -0.01 })).toBe(false);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "open", entryY: 1.01 })).toBe(false);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "move", dx: 12, dy: -4 })).toBe(true);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "move", dx: 12, dy: -4, entryY: 0.5 })).toBe(false);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "move", dx: 999, dy: 0 })).toBe(false);
    expect(protocol.isControllerAction({ action: "inventory-pointer", phase: "commit", dx: 0, dy: 0 })).toBe(false);
  });

  it("sends validated clips only through the reliable Socket.IO channel", () => {
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    socket.handChannel = { readyState: "open", send: vi.fn() };

    expect(socket.sendVoiceClip(voiceClip())).toBe(true);
    expect(socket.socket.emit).toHaveBeenCalledWith(protocol.EVENTS.controllerVoiceClip, voiceClip());
    expect(socket.handChannel.send).not.toHaveBeenCalled();
    expect(socket.sendVoiceClip(voiceClip({ data: "raw" }))).toBe(false);
  });

  it("validates voice clips again before dispatching a desktop event", () => {
    const session = new PhoneSession();
    const receive = vi.fn();
    session.addEventListener("voice-clip", receive);

    expect(session.acceptVoiceClip(voiceClip())).toBe(true);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ detail: voiceClip() }));
    expect(session.acceptVoiceClip(voiceClip({ data: "raw" }))).toBe(false);
    expect(receive).toHaveBeenCalledOnce();
  });

  it("clears crouch with movement when the desktop peer disconnects", () => {
    const session = new PhoneSession();
    session.connected = true;
    session.acceptInput(controllerInput({ crouch: true }));

    session.setPeerConnected(false);

    expect(session.currentInput(10_000)).toMatchObject({ move: { x: 0, y: 0 }, crouch: false });
  });

  it.each(["disconnect", protocol.EVENTS.controllerReplaced, protocol.EVENTS.sessionEnded])(
    "clears crouch when the controller receives %s",
    (event) => {
      const listeners = new Map();
      socketIoMock.mockReturnValue({
        on: vi.fn((name, listener) => listeners.set(name, listener)),
        emit: vi.fn(),
        disconnect: vi.fn(),
      });
      vi.stubGlobal("window", { setInterval: vi.fn() });
      const socket = new ControllerSocket({ room: "617042" });
      socket.connect();
      socket.setInput({ move: { x: 0.5, y: 1 }, crouch: true });

      listeners.get(event)();

      expect(socket.latest).toEqual({ move: { x: 0, y: 0 }, clutch: false, crouch: false });
      vi.unstubAllGlobals();
    },
  );
});

describe("controller settings action protocol", () => {
  it("accepts the exact settings shape emitted by ControllerApp", () => {
    expect(protocol.isControllerAction({
      action: "settings",
      sentAt: 10,
      settings: { sensitivity: 1.3, smoothing: 0.2 },
    })).toBe(true);
  });

  it.each([
    ["nested raw media", { sensitivity: 1, smoothing: 0.2, data: "raw" }],
    ["nested base64 media", { sensitivity: 1, smoothing: 0.2, dataUrl: "AQID" }],
    ["unknown setting", { sensitivity: 1, smoothing: 0.2, debug: true }],
    ["wrong sensitivity type", { sensitivity: "1", smoothing: 0.2 }],
    ["non-finite smoothing", { sensitivity: 1, smoothing: Number.POSITIVE_INFINITY }],
    ["low sensitivity", { sensitivity: 0.59, smoothing: 0.2 }],
    ["high smoothing", { sensitivity: 1, smoothing: 1.01 }],
  ])("rejects settings actions with %s", (_label, settings) => {
    expect(protocol.isControllerAction({ action: "settings", settings })).toBe(false);
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

  it("creates independent controls, hand, and reliable voice WebRTC channels", async () => {
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

    expect(session.peerConnection.createDataChannel).toHaveBeenNthCalledWith(1, "controls", { ordered: false, maxRetransmits: 0 });
    expect(session.peerConnection.createDataChannel).toHaveBeenNthCalledWith(2, "hand", { ordered: false, maxRetransmits: 0 });
    expect(session.peerConnection.createDataChannel).toHaveBeenNthCalledWith(3, "voice", { ordered: true });
    expect(session.handChannel).toBeTruthy();
    expect(session.voiceChannel).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("accepts only a bounded explicit door fallback hold", () => {
    expect(protocol.isControllerAction({
      action: "task-hold",
      context: "door-defense",
      active: true,
      sentAt: 12,
    })).toBe(true);
    expect(protocol.isControllerAction({
      action: "task-hold",
      context: "found-phone",
      active: true,
    })).toBe(false);
    expect(protocol.isControllerAction({
      action: "task-hold",
      context: "door-defense",
      active: "yes",
    })).toBe(false);
  });

  it("keeps controls on WebRTC while routing hand state through Socket.IO", () => {
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
    expect(hand.send).not.toHaveBeenCalled();
    expect(socket.socket.emit).toHaveBeenCalledWith(protocol.EVENTS.controllerHand, expect.objectContaining({ seq: 7 }));
    hand.onclose();
    socket.setInput({ move: { x: 1, y: 0 } }, { immediate: true });
    expect(controls.send).toHaveBeenCalledTimes(2);
  });

  it("keeps the Socket.IO fallback controller input at a responsive 30Hz cadence", () => {
    const setInterval = vi.fn(() => 17);
    socketIoMock.mockReturnValue({ on: vi.fn(), emit: vi.fn() });
    const socket = new ControllerSocket({ room: "617042" });

    vi.stubGlobal("window", { setInterval });
    socket.connect();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), expect.closeTo(1000 / 30, 5));
    vi.unstubAllGlobals();
  });

  it("sends bounded realtime voice controls and PCM chunks on the voice channel", () => {
    const socket = new ControllerSocket({ room: "617042" });
    const voice = { label: "voice", readyState: "open", bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    socket.attachDataChannel(voice);
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };

    expect(socket.sendVoiceFrame({ type: "voice-start", sampleRate: 24_000, format: "pcm16" })).toBe(true);
    expect(socket.sendVoiceFrame(new Int16Array([1, -1, 2]).buffer)).toBe(true);
    expect(socket.sendVoiceFrame({ type: "voice-stop" })).toBe(true);
    expect(JSON.parse(voice.send.mock.calls[0][0])).toEqual({ type: "voice-start", sampleRate: 24_000, format: "pcm16" });
    expect(voice.send.mock.calls[1][0]).toBeInstanceOf(ArrayBuffer);
  });

  it("drops invalid or backpressured realtime voice frames", () => {
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    socket.voiceChannel = { readyState: "open", bufferedAmount: 65_537, send: vi.fn() };
    expect(socket.sendVoiceFrame(new ArrayBuffer(320))).toBe(false);
    socket.voiceChannel.bufferedAmount = 0;
    expect(socket.sendVoiceFrame(new ArrayBuffer(0))).toBe(false);
    expect(socket.sendVoiceFrame({ type: "voice-start", sampleRate: 48_000, format: "pcm16" })).toBe(false);
  });

  it("dispatches realtime voice controls and binary chunks on desktop", () => {
    const session = new PhoneSession();
    const receive = vi.fn();
    session.addEventListener("voice-stream", receive);
    const channel = { label: "voice", onmessage: null, onclose: null };
    session.attachDataChannel(channel);

    channel.onmessage({ data: JSON.stringify({ type: "voice-start", sampleRate: 24_000, format: "pcm16" }) });
    channel.onmessage({ data: new Int16Array([4, 5]).buffer });
    channel.onmessage({ data: JSON.stringify({ type: "voice-stop" }) });

    expect(receive).toHaveBeenCalledTimes(3);
    expect(receive.mock.calls[1][0].detail).toBeInstanceOf(ArrayBuffer);
  });

  it.each([32768, 32769])("handles hand-channel high-water boundary %s", (bufferedAmount) => {
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    socket.handChannel = { readyState: "open", bufferedAmount, send: vi.fn() };
    socket.sendHandFrame(handFrame());
    expect(socket.handChannel.send).not.toHaveBeenCalled();
    expect(socket.socket.emit).toHaveBeenCalledWith(protocol.EVENTS.controllerHand, expect.anything());
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

  it("accepts hand envelopes arriving on the hand DataChannel", () => {
    const session = new PhoneSession();
    const hand = vi.fn();
    session.addEventListener("hand", hand);
    const channel = { label: "hand", onmessage: null, onclose: null };

    session.attachDataChannel(channel);
    channel.onmessage({ data: JSON.stringify({ type: "hand", payload: handFrame({ seq: 8, modeEpoch: 2 }) }) });

    expect(hand).toHaveBeenCalledOnce();
    expect(hand.mock.calls[0][0].detail).toMatchObject({ seq: 8, modeEpoch: 2 });
  });

  it("delivers tracker frames through the reliable Socket.IO hand path", () => {
    const frame = trackerFrame();
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    expect(socket.sendHandFrame(frame)).toBe(true);
    expect(socket.socket.emit).toHaveBeenCalledWith(protocol.EVENTS.controllerHand, frame);

    socket.handChannel = { readyState: "open", bufferedAmount: 0, send: vi.fn() };
    expect(socket.sendHandFrame(frame)).toBe(true);
    expect(socket.handChannel.send).not.toHaveBeenCalled();
    expect(socket.socket.emit).toHaveBeenLastCalledWith(protocol.EVENTS.controllerHand, frame);
  });

  it("accepts a tracker frame in a hand DataChannel envelope", () => {
    const session = new PhoneSession();
    const receive = vi.fn();
    session.addEventListener("hand", receive);
    const channel = { label: "hand", onmessage: null, onclose: null };
    session.attachDataChannel(channel);

    const frame = trackerFrame();
    channel.onmessage({ data: JSON.stringify({ type: "hand", payload: frame }) });

    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0][0].detail).toMatchObject({ inputMirrored: false, seq: frame.seq });
  });

  it("falls back to Socket.IO when hand-channel pressure is unreadable", () => {
    for (const bufferedAmount of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const socket = new ControllerSocket({ room: "617042" });
      socket.joined = true;
      socket.socket = { connected: true, emit: vi.fn() };
      socket.handChannel = { readyState: "open", bufferedAmount, send: vi.fn() };

      expect(socket.sendHandFrame(handFrame())).toBe(true);
      expect(socket.handChannel.send).not.toHaveBeenCalled();
      expect(socket.socket.emit).toHaveBeenCalledWith(protocol.EVENTS.controllerHand, expect.anything());
    }

    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };
    const channel = { readyState: "open", send: vi.fn() };
    Object.defineProperty(channel, "bufferedAmount", { get: () => { throw new Error("unreadable"); } });
    socket.handChannel = channel;

    expect(socket.sendHandFrame(handFrame())).toBe(true);
    expect(channel.send).not.toHaveBeenCalled();
    expect(socket.socket.emit).toHaveBeenCalledWith(protocol.EVENTS.controllerHand, expect.anything());
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

describe("multi-controller protocol", () => {
  it("exposes the controller cap", () => {
    expect(protocol.MAX_CONTROLLERS).toBe(8);
  });

  it("accepts url-safe device tokens between 8 and 64 chars", () => {
    expect(protocol.isDeviceToken("d-1a2B3c4E5f6")).toBe(true);
    expect(protocol.isDeviceToken("a".repeat(64))).toBe(true);
    expect(protocol.isDeviceToken("short")).toBe(false);
    expect(protocol.isDeviceToken("has space!")).toBe(false);
    expect(protocol.isDeviceToken("a".repeat(65))).toBe(false);
    expect(protocol.isDeviceToken(123)).toBe(false);
    expect(protocol.isDeviceToken(null)).toBe(false);
  });

  it("bounds slots to the controller cap", () => {
    expect(protocol.isSlot(0)).toBe(true);
    expect(protocol.isSlot(7)).toBe(true);
    expect(protocol.isSlot(8)).toBe(false);
    expect(protocol.isSlot(-1)).toBe(false);
    expect(protocol.isSlot(1.5)).toBe(false);
    expect(protocol.isSlot("0")).toBe(false);
  });
});
