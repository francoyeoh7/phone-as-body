import { describe, expect, it } from "vitest";
import { isEggHostEvent, isEggTilt } from "../src/shared/egg-protocol.js";

const baseTilt = { seq: 1, sentAt: 100, g: [0, 0, 1], r: [0, 0, 0, 1] };

describe("egg race protocol", () => {
  it("accepts tilt payloads with a joystick move pair", () => {
    expect(isEggTilt({ ...baseTilt, m: [0.5, 1] })).toBe(true);
    expect(isEggTilt({ ...baseTilt, m: [-1, -0.2] })).toBe(true);
  });

  it("still accepts tilt payloads without a move pair", () => {
    expect(isEggTilt(baseTilt)).toBe(true);
  });

  it("rejects malformed move pairs", () => {
    expect(isEggTilt({ ...baseTilt, m: [2, 0] })).toBe(false);
    expect(isEggTilt({ ...baseTilt, m: [0.5] })).toBe(false);
    expect(isEggTilt({ ...baseTilt, m: "forward" })).toBe(false);
  });

  it("accepts collide events with a slot", () => {
    expect(isEggHostEvent({ event: "collide", slot: 0 })).toBe(true);
    expect(isEggHostEvent({ event: "collide", slot: 3 })).toBe(true);
    expect(isEggHostEvent({ event: "collide", slot: 4 })).toBe(false);
  });
});
