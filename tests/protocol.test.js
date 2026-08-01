import { describe, expect, it, vi } from "vitest";
import { ControllerSocket } from "../src/controller/ControllerSocket.js";
import { PhoneSession } from "../src/desktop/PhoneSession.js";
import * as protocol from "../src/shared/protocol.js";

const controllerInput = (overrides = {}) => ({
  seq: 1,
  sentAt: 100,
  move: { x: 0, y: 1 },
  viewDelta: { yaw: 42, pitch: -18 },
  ...overrides,
});

describe("view delta protocol", () => {
  it("accepts finite bounded view deltas in degrees", () => {
    expect(protocol.isViewDelta({ yaw: 42, pitch: -18 })).toBe(true);
    expect(protocol.isControllerInput(controllerInput())).toBe(true);
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

describe("controller snapshot flush", () => {
  it("accumulates orientation deltas until the next network flush", () => {
    const socket = new ControllerSocket({ room: "617042" });
    socket.joined = true;
    socket.socket = { connected: true, emit: vi.fn() };

    socket.setInput({ move: { x: 0, y: 1 }, viewDelta: { yaw: 40, pitch: -10 } });
    socket.setInput({ move: { x: 0, y: 1 }, viewDelta: { yaw: 20, pitch: 5 } });
    socket.flush();

    expect(socket.socket.emit).toHaveBeenCalledWith(
      protocol.EVENTS.controllerInput,
      expect.objectContaining({
        move: { x: 0, y: 1 },
        viewDelta: { yaw: 60, pitch: -5 },
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
