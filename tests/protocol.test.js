import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerSocket } from "../src/controller/ControllerSocket.js";
import { PhoneSession } from "../src/desktop/PhoneSession.js";
import * as protocol from "../src/shared/protocol.js";

const socketHarness = vi.hoisted(() => {
  const handlers = new Map();
  const socket = {
    on: vi.fn((event, handler) => handlers.set(event, handler)),
  };
  return { handlers, socket };
});

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => socketHarness.socket),
}));

const controllerInput = (overrides = {}) => ({
  seq: 1,
  sentAt: 100,
  move: { x: 0, y: 1 },
  viewMotion: { x: 0.25, y: -0.5, confidence: 0.8 },
  ...overrides,
});

describe("view motion protocol", () => {
  it("accepts normalized finite view motion", () => {
    expect(protocol.isViewMotion).toBeTypeOf("function");
    expect(protocol.isViewMotion({ x: 0.25, y: -0.5, confidence: 0.8 })).toBe(true);
  });

  it.each([
    ["null", null],
    ["x below range", { x: -1.01, y: 0, confidence: 0.5 }],
    ["x above range", { x: 1.01, y: 0, confidence: 0.5 }],
    ["y below range", { x: 0, y: -1.01, confidence: 0.5 }],
    ["y above range", { x: 0, y: 1.01, confidence: 0.5 }],
    ["non-finite x", { x: Number.NaN, y: 0, confidence: 0.5 }],
    ["non-finite y", { x: 0, y: Number.POSITIVE_INFINITY, confidence: 0.5 }],
    ["non-finite confidence", { x: 0, y: 0, confidence: Number.NEGATIVE_INFINITY }],
    ["confidence below range", { x: 0, y: 0, confidence: -0.01 }],
    ["confidence above range", { x: 0, y: 0, confidence: 1.01 }],
  ])("rejects %s", (_label, value) => {
    expect(protocol.isViewMotion(value)).toBe(false);
  });

  it("requires view motion instead of orientation for controller input", () => {
    expect(protocol.isControllerInput(controllerInput())).toBe(true);
    expect(
      protocol.isControllerInput({
        seq: 1,
        sentAt: 100,
        move: { x: 0, y: 1 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    ).toBe(false);
    expect(protocol.isControllerInput(controllerInput({ viewMotion: null }))).toBe(false);
    expect(protocol.isControllerInput(controllerInput({ orientation: "ignored" }))).toBe(true);
  });
});

describe("view motion snapshots", () => {
  beforeEach(() => {
    socketHarness.handlers.clear();
    socketHarness.socket.on.mockClear();
  });

  it("copies controller input view motion without retaining orientation", () => {
    const socket = new ControllerSocket({ room: "617042" });
    expect(socket.latest).toEqual({
      move: { x: 0, y: 0 },
      viewMotion: { x: 0, y: 0, confidence: 0 },
    });

    const input = controllerInput({ orientation: { x: 0, y: 0, z: 0, w: 1 } });
    socket.setInput(input);
    input.move.y = -1;
    input.viewMotion.x = 1;

    expect(socket.latest).toEqual({
      move: { x: 0, y: 1 },
      viewMotion: { x: 0.25, y: -0.5, confidence: 0.8 },
    });
  });

  it("uses stopped view motion for a new phone session", () => {
    const session = new PhoneSession();

    expect(session.input).toEqual({
      seq: -1,
      move: { x: 0, y: 0 },
      viewMotion: { x: 0, y: 0, confidence: 0 },
      receivedAt: 0,
    });
  });

  it("copies nested values from received controller input", () => {
    const session = new PhoneSession();
    session.dispatchEvent = () => true;
    session.start();
    const payload = controllerInput();
    const expectedInput = {
      ...payload,
      move: { ...payload.move },
      viewMotion: { ...payload.viewMotion },
    };

    const receiveInput = socketHarness.handlers.get(protocol.EVENTS.controllerInput);
    expect(receiveInput).toBeTypeOf("function");
    receiveInput(payload);
    const receivedAt = session.input.receivedAt;
    payload.move.y = -1;
    payload.viewMotion.x = 1;

    expect(session.input).toEqual({ ...expectedInput, receivedAt });
  });

  it("zeros disconnected phone input while preserving metadata", () => {
    const session = new PhoneSession();
    session.connected = false;
    session.input = {
      ...controllerInput(),
      receivedAt: performance.now(),
    };

    expect(session.currentInput()).toEqual({
      ...session.input,
      move: { x: 0, y: 0 },
      viewMotion: { x: 0, y: 0, confidence: 0 },
    });
  });

  it("stores stopped input when the phone disconnects", () => {
    const session = new PhoneSession();
    const receivedAt = performance.now();
    session.connected = true;
    session.input = {
      ...controllerInput(),
      receivedAt,
    };
    session.dispatchEvent = () => true;

    session.setPeerConnected(false);

    expect(session.connected).toBe(false);
    expect(session.input).toEqual({
      ...controllerInput(),
      move: { x: 0, y: 0 },
      viewMotion: { x: 0, y: 0, confidence: 0 },
      receivedAt,
    });
  });

  it("zeros stale phone input while preserving metadata", () => {
    const session = new PhoneSession();
    session.connected = true;
    session.input = {
      ...controllerInput(),
      receivedAt: performance.now() - 1_000,
    };

    expect(session.currentInput(500)).toEqual({
      ...session.input,
      move: { x: 0, y: 0 },
      viewMotion: { x: 0, y: 0, confidence: 0 },
    });
  });
});
