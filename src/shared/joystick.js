function isValidInput({ dx, dy, radius }) {
  return Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(radius) && radius > 0;
}

export function clampJoystickPoint(input) {
  if (!isValidInput(input)) return { dx: 0, dy: 0 };
  const { dx, dy, radius } = input;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return { dx, dy };
  const scale = radius / distance;
  return { dx: dx * scale, dy: dy * scale };
}

export function normalizeJoystick(input) {
  if (!isValidInput(input)) return { x: 0, y: 0 };
  const point = clampJoystickPoint(input);
  const x = point.dx / input.radius;
  const y = -point.dy / input.radius;
  return {
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y,
  };
}

export function normalizeJoystickWithDeadZone(input, deadZone = 0) {
  if (!isValidInput(input) || !Number.isFinite(deadZone) || deadZone < 0) {
    return { x: 0, y: 0 };
  }

  const distance = Math.hypot(input.dx, input.dy);
  if (distance <= deadZone || deadZone >= input.radius) return { x: 0, y: 0 };

  const magnitude = Math.min(1, (distance - deadZone) / (input.radius - deadZone));
  const x = (input.dx / distance) * magnitude;
  const y = (-input.dy / distance) * magnitude;
  return {
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y,
  };
}
