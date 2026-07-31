import { describe, expect, it } from "vitest";
import {
  adaptiveAlpha,
  applyDeadZone,
  clampPitch,
  createOrientationTracker,
  normalizeQuaternion,
  quaternionToYawPitch,
  relativeQuaternion,
} from "../src/shared/orientation.js";
import { deviceOrientationToQuaternion } from "../src/controller/MotionController.js";

const radians = (degrees) => (degrees * Math.PI) / 180;

function axisQuaternion(axis, degrees) {
  const half = radians(degrees) / 2;
  const sine = Math.sin(half);
  return normalizeQuaternion({
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
    w: Math.cos(half),
  });
}

describe("orientation math", () => {
  it("normalizes sensor quaternions", () => {
    expect(normalizeQuaternion({ x: 0, y: 0, z: 0, w: 2 })).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(normalizeQuaternion({ x: Number.NaN, y: 0, z: 0, w: 1 })).toBeNull();
  });

  it("uses calibration as the neutral direction", () => {
    const baseline = axisQuaternion({ x: 0, y: 1, z: 0 }, 38);
    expect(quaternionToYawPitch(relativeQuaternion(baseline, baseline))).toMatchObject({ yaw: 0, pitch: 0 });

    const tracker = createOrientationTracker({ smoothingStrength: 0 });
    expect(tracker.calibrate(baseline)).toBe(true);
    expect(tracker.update(baseline, 0.016)).toMatchObject({ yaw: 0, pitch: 0, valid: true });
  });

  it("reports positive yaw after turning right", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });

    const result = tracker.update(axisQuaternion({ x: 0, y: 1, z: 0 }, 45), 0.016);
    expect(result.yaw).toBeCloseTo(45, 4);
    expect(result.pitch).toBeCloseTo(0, 4);
  });

  it("suppresses hand tremor and clamps extreme pitch", () => {
    expect(applyDeadZone(0.5, 1)).toBe(0);
    expect(applyDeadZone(-0.5, 1)).toBe(0);
    expect(applyDeadZone(2, 1)).toBe(2);
    expect(clampPitch(90, 72)).toBe(72);

    const tracker = createOrientationTracker({ deadZoneDeg: 1, maxPitchDeg: 72, smoothingStrength: 0 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });
    expect(tracker.update(axisQuaternion({ x: 1, y: 0, z: 0 }, 89), 0.016).pitch).toBeCloseTo(72, 4);
  });

  it("responds more quickly when angular speed is high", () => {
    expect(adaptiveAlpha(300, 0.7)).toBeGreaterThan(adaptiveAlpha(5, 0.7));
    expect(adaptiveAlpha(30, 0)).toBe(1);
  });

  it("converts device orientation and screen rotation into normalized quaternions", () => {
    const portrait = deviceOrientationToQuaternion({ alpha: 20, beta: 15, gamma: -8 }, 0);
    const landscape = deviceOrientationToQuaternion({ alpha: 20, beta: 15, gamma: -8 }, 90);
    expect(Math.hypot(portrait.x, portrait.y, portrait.z, portrait.w)).toBeCloseTo(1, 6);
    expect(Math.hypot(landscape.x, landscape.y, landscape.z, landscape.w)).toBeCloseTo(1, 6);
    expect(landscape).not.toEqual(portrait);
    expect(deviceOrientationToQuaternion({ alpha: null, beta: 0, gamma: 0 }, 0)).toBeNull();
  });
});
