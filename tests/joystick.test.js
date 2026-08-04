import { describe, expect, it } from "vitest";
import {
  clampJoystickPoint,
  normalizeJoystick,
  normalizeJoystickWithDeadZone,
} from "../src/shared/joystick.js";

describe("joystick normalization", () => {
  it("returns no movement at the touch origin", () => {
    expect(normalizeJoystick({ dx: 0, dy: 0, radius: 60 })).toEqual({ x: 0, y: 0 });
  });

  it("maps screen-up to forward movement", () => {
    expect(normalizeJoystick({ dx: 30, dy: -30, radius: 60 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps movement outside the circular boundary", () => {
    expect(normalizeJoystick({ dx: 120, dy: 0, radius: 60 })).toEqual({ x: 1, y: 0 });
    const diagonal = normalizeJoystick({ dx: 90, dy: -90, radius: 60 });
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 6);
  });

  it("maps movement continuously from a radial dead-zone edge", () => {
    expect(normalizeJoystickWithDeadZone({ dx: 14, dy: 0, radius: 84 }, 14)).toEqual({ x: 0, y: 0 });
    expect(normalizeJoystickWithDeadZone({ dx: 15, dy: 0, radius: 84 }, 14)).toEqual({ x: 1 / 70, y: 0 });
    expect(normalizeJoystickWithDeadZone({ dx: 84, dy: 0, radius: 84 }, 14)).toEqual({ x: 1, y: 0 });
  });

  it("returns the matching clamped thumb offset", () => {
    expect(clampJoystickPoint({ dx: 120, dy: 0, radius: 60 })).toEqual({ dx: 60, dy: 0 });
    const point = clampJoystickPoint({ dx: 50, dy: 20, radius: 60 });
    expect(point).toEqual({ dx: 50, dy: 20 });
  });

  it("rejects invalid dimensions without propagating NaN", () => {
    expect(normalizeJoystick({ dx: Number.NaN, dy: 0, radius: 60 })).toEqual({ x: 0, y: 0 });
    expect(normalizeJoystick({ dx: 20, dy: 20, radius: 0 })).toEqual({ x: 0, y: 0 });
  });
});
