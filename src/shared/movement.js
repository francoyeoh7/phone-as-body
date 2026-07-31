const cleanZero = (value) => (Math.abs(value) < 1e-12 ? 0 : value);

export function cameraRelativeMovement(move, yawRadians) {
  const inputLength = Math.hypot(move.x, move.y);
  const scale = inputLength > 1 ? 1 / inputLength : 1;
  const strafe = move.x * scale;
  const forward = move.y * scale;
  const sine = Math.sin(yawRadians);
  const cosine = Math.cos(yawRadians);
  return {
    x: cleanZero(cosine * strafe - sine * forward),
    z: cleanZero(-sine * strafe - cosine * forward),
  };
}

export function dampVector(current, target, response, deltaSeconds) {
  const alpha = 1 - Math.exp(-Math.max(0, response) * Math.max(0, deltaSeconds));
  return {
    x: current.x + (target.x - current.x) * alpha,
    z: current.z + (target.z - current.z) * alpha,
  };
}
