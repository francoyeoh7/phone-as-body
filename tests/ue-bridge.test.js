import { describe, expect, it, vi } from "vitest";
import { createUeBridge, createUeActionPacket, createUeInputPacket } from "../server/ue-bridge.js";
import { createStoppedControllerInput } from "../src/ue-bridge/stop-input.js";

function sampleInput(overrides = {}) {
  return {
    seq: 12,
    sentAt: 100,
    move: { x: -0.35, y: 0.8 },
    viewDelta: { yaw: 6.5, pitch: -2.25 },
    clutch: true,
    ...overrides,
  };
}

describe("UE bridge packets", () => {
  it("normalizes valid controller input for Unreal", () => {
    expect(createUeInputPacket(sampleInput(), 250)).toEqual({
      type: "input",
      seq: 12,
      sentAt: 100,
      receivedAt: 250,
      move: { x: -0.35, y: 0.8 },
      viewDelta: { yaw: 6.5, pitch: -2.25 },
      clutch: true,
    });
  });

  it("drops invalid controller input before it reaches Unreal", () => {
    expect(createUeInputPacket(sampleInput({ viewDelta: { yaw: 999, pitch: 0 } }))).toBeNull();
    expect(createUeInputPacket(sampleInput({ clutch: undefined }))).toBeNull();
  });

  it("passes interact and settings actions through to Unreal", () => {
    expect(createUeActionPacket({ action: "interact", sentAt: 300 })).toEqual({
      type: "action",
      action: "interact",
      sentAt: 300,
    });

    expect(createUeActionPacket({
      action: "settings",
      sentAt: 310,
      settings: { sensitivity: 1.3, smoothing: 0.2 },
    })).toEqual({
      type: "action",
      action: "settings",
      sentAt: 310,
      settings: { sensitivity: 1.3, smoothing: 0.2 },
    });
  });

  it("sends encoded packets through the configured UDP transport", () => {
    const socket = { send: vi.fn() };
    const bridge = createUeBridge({ socket, host: "127.0.0.1", port: 61717, now: () => 400 });

    expect(bridge.sendInput(sampleInput())).toBe(true);

    const [buffer, port, host] = socket.send.mock.calls[0];
    expect(port).toBe(61717);
    expect(host).toBe("127.0.0.1");
    expect(JSON.parse(buffer.toString("utf8"))).toMatchObject({
      type: "input",
      seq: 12,
      receivedAt: 400,
    });
  });

  it("creates a newer neutral packet so Unreal stops after phone disconnect", () => {
    expect(createStoppedControllerInput(41, 500)).toEqual({
      seq: 42,
      sentAt: 500,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
    });
    expect(createUeInputPacket(createStoppedControllerInput(41, 500), 520)).toMatchObject({
      type: "input",
      seq: 42,
      move: { x: 0, y: 0 },
      clutch: false,
    });
  });
});
