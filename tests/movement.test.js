import { describe, expect, it } from "vitest";
import { cameraRelativeMovement, dampVector } from "../src/shared/movement.js";

describe("camera-relative movement", () => {
  it("moves forward along the camera's default view", () => {
    expect(cameraRelativeMovement({ x: 0, y: 1 }, 0)).toEqual({ x: 0, z: -1 });
  });

  it("moves right perpendicular to the view", () => {
    expect(cameraRelativeMovement({ x: 1, y: 0 }, 0)).toEqual({ x: 1, z: 0 });
  });

  it("rotates movement with camera yaw", () => {
    const result = cameraRelativeMovement({ x: 0, y: 1 }, -Math.PI / 2);
    expect(result.x).toBeCloseTo(1, 6);
    expect(result.z).toBeCloseTo(0, 6);
  });

  it("does not accelerate diagonal input beyond full speed", () => {
    const result = cameraRelativeMovement({ x: 1, y: 1 }, 0);
    expect(Math.hypot(result.x, result.z)).toBeCloseTo(1, 6);
  });

  it("damps velocity toward a target without overshooting", () => {
    const result = dampVector({ x: 0, z: 0 }, { x: 4, z: -2 }, 20, 0.1);
    expect(result.x).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(4);
    expect(result.z).toBeLessThan(0);
    expect(result.z).toBeGreaterThan(-2);
  });
});
