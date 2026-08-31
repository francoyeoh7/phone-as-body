import {
  deviceOrientationToQuaternion,
  inverseQuaternion,
  relativeQuaternion,
  rotateVector,
} from "../shared/orientation.js";

// Plate frame (portrait hold, phone carried like a tray):
//   +x = right edge, +y = top edge (forward, toward the world screen),
//   +z = screen normal (up when the plate is level).
// World up expressed in the plate frame is (0,0,1) exactly when level, so the
// tangential gravity components (-g.x, -g.y) point downhill on the plate.
const WORLD_UP = { x: 0, y: 0, z: 1 };
const DEG_PER_RAD = 180 / Math.PI;

export function plateQuaternion(event) {
  return deviceOrientationToQuaternion({
    alpha: event?.alpha,
    beta: event?.beta,
    gamma: event?.gamma,
  });
}

export function gravityInPlateFrame(quaternion) {
  const inverse = inverseQuaternion(quaternion);
  const gravity = inverse ? rotateVector(inverse, WORLD_UP) : null;
  if (!gravity || ![gravity.x, gravity.y, gravity.z].every(Number.isFinite)) return null;
  const length = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (length <= Number.EPSILON) return null;
  return { x: gravity.x / length, y: gravity.y / length, z: gravity.z / length };
}

export function tiltDegrees(gravity) {
  if (!gravity) return { forward: 0, lateral: 0 };
  const z = Math.max(0.2, gravity.z);
  return {
    forward: Math.atan2(-gravity.y, z) * DEG_PER_RAD,
    lateral: Math.atan2(-gravity.x, z) * DEG_PER_RAD,
  };
}

export function slideAcceleration(gravity, { gravityMps2 = 9.8, gain = 1 } = {}) {
  if (!gravity) return { x: 0, y: 0 };
  return {
    x: -gravity.x * gravityMps2 * gain,
    y: -gravity.y * gravityMps2 * gain,
  };
}

export function createPlateTracker() {
  let baseline = null;
  return {
    calibrate(quaternion) {
      if (!quaternion) return false;
      baseline = quaternion;
      return true;
    },
    get calibrated() {
      return baseline !== null;
    },
    relative(quaternion) {
      return baseline ? relativeQuaternion(baseline, quaternion) : null;
    },
  };
}
