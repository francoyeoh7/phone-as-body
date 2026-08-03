export const EVENTS = Object.freeze({
  desktopCreate: "desktop:create",
  controllerJoin: "controller:join",
  controllerInput: "controller:input",
  controllerAction: "controller:action",
  desktopEvent: "desktop:event",
  rtcSignal: "rtc:signal",
  peerStatus: "peer:status",
  controllerReplaced: "controller:replaced",
  sessionEnded: "session:ended",
});

export const CONTROLLER_ACTIONS = Object.freeze([
  "interact",
  "flashlight",
  "recenter",
  "gesture-presence",
  "pause",
  "resume",
  "settings",
]);

const isFiniteNumber = (value) => Number.isFinite(value);

export function isRoomCode(value) {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export function isJoystickVector(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    value.x >= -1 &&
    value.x <= 1 &&
    value.y >= -1 &&
    value.y <= 1
  );
}

export function isViewDelta(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isFiniteNumber(value.yaw) &&
    isFiniteNumber(value.pitch) &&
    value.yaw >= -180 &&
    value.yaw <= 180 &&
    value.pitch >= -180 &&
    value.pitch <= 180
  );
}

export function isQuaternion(value) {
  if (value === null || typeof value !== "object") return false;
  const components = [value.x, value.y, value.z, value.w];
  if (!components.every(isFiniteNumber)) return false;
  return components.some((component) => Math.abs(component) > Number.EPSILON);
}

export function isControllerInput(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.seq) &&
    value.seq >= 0 &&
    isFiniteNumber(value.sentAt) &&
    value.sentAt >= 0 &&
    isJoystickVector(value.move) &&
    isViewDelta(value.viewDelta) &&
    typeof value.clutch === "boolean"
  );
}

export function isControllerAction(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    CONTROLLER_ACTIONS.includes(value.action) &&
    (value.sentAt === undefined || isFiniteNumber(value.sentAt)) &&
    (value.action !== "gesture-presence" || (
      typeof value.ready === "boolean" &&
      typeof value.active === "boolean" &&
      ["door-defense", "found-phone"].includes(value.context)
    ))
  );
}

export function isDesktopEvent(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string" && value.type.length <= 48;
}
