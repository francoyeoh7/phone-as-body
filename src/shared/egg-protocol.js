export const EGG_EVENTS = Object.freeze({
  hostCreate: "egg:host-create",
  roomUpdate: "egg:room-update",
  playerJoin: "egg:player-join",
  playerTilt: "egg:player-tilt",
  playerAction: "egg:player-action",
  hostPhase: "egg:host-phase",
  hostEvent: "egg:host-event",
  hostReserve: "egg:host-reserve",
  ping: "egg:ping",
  ended: "egg:ended",
});

export const EGG_MAX_PLAYERS = 3;
export const EGG_PHASES = Object.freeze(["lobby", "calibrate", "countdown", "racing", "finished"]);

const isFiniteNumber = (value) => Number.isFinite(value);

function isUnitTriple(value, tolerance = 0.12) {
  return Array.isArray(value)
    && value.length === 3
    && value.every(isFiniteNumber)
    && Math.abs(Math.hypot(value[0], value[1], value[2]) - 1) <= tolerance;
}

function isUnitQuaternion(value, tolerance = 0.12) {
  return Array.isArray(value)
    && value.length === 4
    && value.every(isFiniteNumber)
    && Math.abs(Math.hypot(value[0], value[1], value[2], value[3]) - 1) <= tolerance;
}

function isMovePair(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((component) => isFiniteNumber(component) && Math.abs(component) <= 1.5);
}

export function isEggTilt(value) {
  return (
    value !== null
    && typeof value === "object"
    && Number.isInteger(value.seq) && value.seq >= 0
    && isFiniteNumber(value.sentAt) && value.sentAt >= 0
    && isUnitTriple(value.g)
    && isUnitQuaternion(value.r)
    && (value.m === undefined || isMovePair(value.m))
    && (value.rtt === undefined || (isFiniteNumber(value.rtt) && value.rtt >= 0 && value.rtt <= 3000))
  );
}

export function isEggPhase(value) {
  return (
    value !== null
    && typeof value === "object"
    && EGG_PHASES.includes(value.phase)
    && isFiniteNumber(value.at)
    && (value.durationMs === undefined || (isFiniteNumber(value.durationMs) && value.durationMs > 0 && value.durationMs <= 60_000))
  );
}

export function isEggHostEvent(value) {
  if (value === null || typeof value !== "object") return false;
  if (!["drop", "bump", "finish", "drop-reset", "collide", "grabbed", "grab-hit", "grab-miss"].includes(value.event)) return false;
  if (!Number.isInteger(value.slot) || value.slot < 0 || value.slot > 3) return false;
  if (value.event === "finish") {
    return Number.isInteger(value.rank) && value.rank >= 1 && value.rank <= 4
      && isFiniteNumber(value.timeMs) && value.timeMs >= 0;
  }
  return true;
}

export function isEggPlayerName(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 12;
}

export function isEggPlayerAction(value) {
  return value !== null && typeof value === "object" && value.action === "grab";
}

export function isEggPlayerKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
}
