import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createOrientationTracker,
  deviceOrientationToQuaternion,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionToAimVector,
} from "../src/shared/orientation.js";

const radians = (degrees) => (degrees * Math.PI) / 180;

function expectedDeviceQuaternion({ alpha, beta, gamma }) {
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    radians(alpha),
  );
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    radians(beta),
  ));
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    radians(gamma),
  ));
  return quaternion.normalize();
}

function expectEquivalentQuaternion(actual, expected) {
  const dot = Math.abs(
    actual.x * expected.x
    + actual.y * expected.y
    + actual.z * expected.z
    + actual.w * expected.w,
  );
  expect(dot).toBeCloseTo(1, 6);
}

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
  it.each([
    { alpha: 0, beta: 0, gamma: 0, screenAngle: 0 },
    { alpha: 37, beta: 18, gamma: -24, screenAngle: 0 },
    { alpha: 285, beta: -42, gamma: 61, screenAngle: 90 },
    { alpha: 112, beta: 74, gamma: -38, screenAngle: -90 },
  ])("matches the W3C intrinsic Z-X'-Y'' device rotation for %o", (sample) => {
    expectEquivalentQuaternion(deviceOrientationToQuaternion(sample), expectedDeviceQuaternion(sample));
  });

  it("keeps the physical phone frame independent of screen UI rotation", () => {
    const sample = { alpha: 42, beta: 18, gamma: -33 };
    expectEquivalentQuaternion(
      deviceOrientationToQuaternion({ ...sample, screenAngle: 90 }),
      deviceOrientationToQuaternion({ ...sample, screenAngle: 0 }),
    );
  });

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

  it.each([0, 45, 90])("tracks a realistic outward-return gesture at %s degrees of grip roll", (gripRoll) => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    const grip = axisQuaternion({ x: 0, y: 1, z: 0 }, gripRoll);
    tracker.calibrate(grip);

    const outward = [2, 4, 8, 12, 16, 20].map((degrees) => tracker.update(
      multiplyQuaternions(axisQuaternion({ x: 0, y: 0, z: 1 }, degrees), grip),
    ));
    const returning = [16, 12, 8, 4, 2, 0].map((degrees) => tracker.update(
      multiplyQuaternions(axisQuaternion({ x: 0, y: 0, z: 1 }, degrees), grip),
    ));

    expect(outward.reduce((sum, sample) => sum + sample.yaw, 0)).toBeCloseTo(80, 3);
    expect(Math.max(...outward.map((sample) => Math.abs(sample.yaw)))).toBeLessThanOrEqual(16.001);
    expect(returning.every((sample) => sample.yaw === 0)).toBe(true);
    expect(outward.at(-1).physicalYaw).toBeCloseTo(20, 6);
    expect(outward.at(-1).physicalPitch).toBeCloseTo(0, 6);
  });

  it("suppresses natural sub-degree hand tremor", () => {
    const tracker = createOrientationTracker({ smoothingStrength: 0, gain: 4 });
    tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });

    const output = [0.2, -0.35, 0.55, -0.7, 0.4].map((degrees) => tracker.update(
      axisQuaternion({ x: 0, y: 0, z: 1 }, degrees),
    ));

    expect(output.every((sample) => sample.yaw === 0 && sample.pitch === 0)).toBe(true);
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
