import { describe, expect, it } from "vitest";
import {
  plateQuaternion,
  gravityInPlateFrame,
  tiltDegrees,
  slideAcceleration,
  createPlateTracker,
} from "../src/egg/plate-tilt.js";

function orientation(alpha, beta, gamma) {
  return { alpha, beta, gamma };
}

describe("plate tilt", () => {
  it("reports level gravity when the phone lies flat", () => {
    const gravity = gravityInPlateFrame(plateQuaternion(orientation(0, 0, 0)));
    expect(gravity.x).toBeCloseTo(0, 6);
    expect(gravity.y).toBeCloseTo(0, 6);
    expect(gravity.z).toBeCloseTo(1, 6);
  });

  it("reads forward tilt when the top edge drops", () => {
    const gravity = gravityInPlateFrame(plateQuaternion(orientation(0, -20, 0)));
    const tilt = tiltDegrees(gravity);
    expect(tilt.forward).toBeGreaterThan(15);
    expect(Math.abs(tilt.lateral)).toBeLessThan(2);
  });

  it("reads lateral tilt when the right edge drops", () => {
    const gravity = gravityInPlateFrame(plateQuaternion(orientation(0, 0, 20)));
    const tilt = tiltDegrees(gravity);
    expect(tilt.lateral).toBeGreaterThan(15);
    expect(Math.abs(tilt.forward)).toBeLessThan(2);
  });

  it("slides the egg downhill toward the dropped edge", () => {
    const forward = gravityInPlateFrame(plateQuaternion(orientation(0, -25, 0)));
    expect(slideAcceleration(forward).y).toBeGreaterThan(0);

    const right = gravityInPlateFrame(plateQuaternion(orientation(0, 0, 25)));
    expect(slideAcceleration(right).x).toBeGreaterThan(0);
  });

  it("keeps the plate level relative to the calibrated pose", () => {
    const tracker = createPlateTracker();
    const held = plateQuaternion(orientation(40, 15, -10));
    tracker.calibrate(held);
    const relative = tracker.relative(held);
    expect(relative.w).toBeCloseTo(1, 5);
    expect(Math.abs(relative.x)).toBeLessThan(1e-5);
    expect(Math.abs(relative.y)).toBeLessThan(1e-5);
    expect(Math.abs(relative.z)).toBeLessThan(1e-5);
  });

  it("returns null gravity for invalid input", () => {
    expect(gravityInPlateFrame(null)).toBeNull();
    expect(tiltDegrees(null)).toEqual({ forward: 0, lateral: 0 });
    expect(slideAcceleration(null)).toEqual({ x: 0, y: 0 });
  });
});
