import { describe, expect, it } from "vitest";
import {
  createOrientationTracker,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionToAimVector,
} from "../src/shared/orientation.js";

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

describe("phone aiming orientation", () => {
  it("turns the phone long axis into a stable aim vector", () => {
    const aim = quaternionToAimVector(axisQuaternion({ x: 0, y: 0, z: 1 }, 20));
    expect(aim.x).toBeCloseTo(-Math.sin(radians(20)), 5);
    expect(aim.y).toBeCloseTo(Math.cos(radians(20)), 5);
    expect(aim.z).toBeCloseTo(0, 5);
  });

  it("ignores a 90-degree roll around the phone long axis", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });

    const result = tracker.update(axisQuaternion({ x: 0, y: 1, z: 0 }, 90));

    expect(result).toMatchObject({ yaw: 0, pitch: 0, valid: true });
  });

  it("maps outward horizontal and vertical aim changes with high gain", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });

    const horizontal = tracker.update(axisQuaternion({ x: 0, y: 0, z: 1 }, 20));
    expect(horizontal.yaw).toBeCloseTo(80, 3);
    expect(horizontal.pitch).toBeCloseTo(0, 3);

    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });
    const vertical = tracker.update(axisQuaternion({ x: 1, y: 0, z: 0 }, 20));
    expect(vertical.pitch).toBeCloseTo(80, 3);
    expect(vertical.yaw).toBeCloseTo(0, 3);
  });

  it("keeps face-on and edge-on horizontal gestures equivalent", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });
    const faceOn = tracker.update(axisQuaternion({ x: 0, y: 0, z: 1 }, 20));

    const edgeOn = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    edgeOn.calibrate({ x: 0, y: 0, z: 0, w: 1 });
    const edgePose = multiplyQuaternions(
      axisQuaternion({ x: 0, y: 0, z: 1 }, 20),
      axisQuaternion({ x: 0, y: 1, z: 0 }, 90),
    );
    const edge = edgeOn.update(edgePose);

    expect(edge.yaw).toBeCloseTo(faceOn.yaw, 3);
    expect(edge.pitch).toBeCloseTo(faceOn.pitch, 3);
  });

  it("does not reverse the camera when the player returns to neutral", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });

    expect(tracker.update(axisQuaternion({ x: 0, y: 0, z: 1 }, 20)).yaw).toBeCloseTo(80, 3);
    expect(tracker.update(axisQuaternion({ x: 0, y: 0, z: 1 }, 8)).yaw).toBe(0);
    expect(tracker.update({ x: 0, y: 0, z: 0, w: 1 }).yaw).toBe(0);
    expect(tracker.update(axisQuaternion({ x: 0, y: 0, z: -1 }, 20)).yaw).toBeCloseTo(-80, 3);
  });

  it("suppresses jitter but preserves a deliberate turn during grip transition", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });

    const smallAimDrift = multiplyQuaternions(
      axisQuaternion({ x: 0, y: 0, z: 1 }, 2),
      axisQuaternion({ x: 0, y: 1, z: 0 }, 40),
    );
    expect(tracker.update(smallAimDrift).yaw).toBe(0);

    const deliberateAimChange = multiplyQuaternions(
      axisQuaternion({ x: 0, y: 0, z: 1 }, 12),
      axisQuaternion({ x: 0, y: 1, z: 0 }, 40),
    );
    expect(tracker.update(deliberateAimChange).yaw).toBeCloseTo(48, 3);
  });
});
