export const CASTLE_EVENTS = Object.freeze({
  hostCreate: "castle:host-create",
  roomUpdate: "castle:room-update",
  playerJoin: "castle:player-join",
  playerInput: "castle:player-input",
  playerAction: "castle:player-action",
  hostPhase: "castle:host-phase",
  hostEvent: "castle:host-event",
  ping: "castle:ping",
  ended: "castle:ended",
});

const isFiniteNumber = (value) => Number.isFinite(value);

function isMovePair(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((component) => isFiniteNumber(component) && Math.abs(component) <= 1.5);
}

export function isCastleInput(value) {
  return (
    value !== null
    && typeof value === "object"
    && Number.isInteger(value.seq) && value.seq >= 0
    && isFiniteNumber(value.sentAt) && value.sentAt >= 0
    && isMovePair(value.m)
    && isFiniteNumber(value.dyaw) && Math.abs(value.dyaw) <= 360
    && isFiniteNumber(value.dpitch) && Math.abs(value.dpitch) <= 360
    && (value.light === undefined || typeof value.light === "boolean")
    && (value.crouch === undefined || typeof value.crouch === "boolean")
  );
}

export function isCastleAction(value) {
  return value !== null && typeof value === "object" && value.action === "grab";
}

export function isCastlePhase(value) {
  return (
    value !== null
    && typeof value === "object"
    && ["lobby", "playing", "finished"].includes(value.phase)
    && isFiniteNumber(value.at)
    && (value.viewMode === undefined || ["fp", "tp"].includes(value.viewMode))
  );
}

export function isCastleHostEvent(value) {
  if (value === null || typeof value !== "object") return false;
  if (!["collect", "caught", "extract", "alert", "alert-end"].includes(value.event)) return false;
  if (value.event === "collect") {
    return isFiniteNumber(value.value) && value.value > 0 && isFiniteNumber(value.total) && value.total >= 0;
  }
  return true;
}

export function isCastleViewMode(value) {
  return value === "fp" || value === "tp";
}
