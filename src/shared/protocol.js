export const EVENTS = Object.freeze({
  desktopCreate: "desktop:create",
  controllerJoin: "controller:join",
  controllerInput: "controller:input",
  controllerHand: "controller:hand",
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
  "task-hold",
  "pause",
  "resume",
  "settings",
]);

const isFiniteNumber = (value) => Number.isFinite(value);
const HAND_RAW_MEDIA_KEYS = ["image", "video", "pixels", "frame", "blob", "dataUrl"];
const HAND_TRACKED_KEYS = new Set([
  "version", "seq", "capturedAt", "modeEpoch", "state", "handedness",
  "handConfidence", "trackingConfidence", "landmarks", "worldLandmarks",
  "center", "wrist", "curls", "openness", "grabStrength", "palmFacing",
  "relativeScale", "velocity", "pinchStrength", "reachEligible", "reachProgress",
  "depth", "palmSpan",
]);
const HAND_STATUS_KEYS = new Set(["version", "seq", "capturedAt", "modeEpoch", "state", "reason"]);

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

function isFiniteTriple(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isLandmarkArray(value) {
  return Array.isArray(value) && value.length === 21 && value.every(isFiniteTriple);
}

function isUnitVector(value) {
  return isFiniteTriple(value) && Math.abs(Math.hypot(...value) - 1) <= 1e-4;
}

function isOrthogonalBasis(value) {
  if (value === null || typeof value !== "object") return false;
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.every((key) => ["right", "up", "forward"].includes(key))) return false;
  const axes = [value.right, value.up, value.forward];
  if (!axes.every(isUnitVector)) return false;
  return Math.abs(axes[0][0] * axes[1][0] + axes[0][1] * axes[1][1] + axes[0][2] * axes[1][2]) <= 1e-4
    && Math.abs(axes[0][0] * axes[2][0] + axes[0][1] * axes[2][1] + axes[0][2] * axes[2][2]) <= 1e-4
    && Math.abs(axes[1][0] * axes[2][0] + axes[1][1] * axes[2][1] + axes[1][2] * axes[2][2]) <= 1e-4;
}

export function isHandFrame(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    if (JSON.stringify(value).length > 12_288) return false;
  } catch {
    return false;
  }
  if (HAND_RAW_MEDIA_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return false;
  const keys = Object.keys(value);
  if (value.version !== 1 || !Number.isInteger(value.seq) || value.seq < 0
    || !Number.isInteger(value.modeEpoch) || value.modeEpoch < 0
    || !isFiniteNumber(value.capturedAt) || value.capturedAt < 0
    || !["tracked", "lost", "unavailable"].includes(value.state)) return false;
  const allowed = value.state === "tracked" ? HAND_TRACKED_KEYS : HAND_STATUS_KEYS;
  if (keys.some((key) => !allowed.has(key))) return false;
  if (value.state !== "tracked") {
    return (!Object.prototype.hasOwnProperty.call(value, "reason")
      || (typeof value.reason === "string" && value.reason.length <= 48))
      && !Object.prototype.hasOwnProperty.call(value, "landmarks")
      && !Object.prototype.hasOwnProperty.call(value, "worldLandmarks");
  }
  const bounded = [
    value.handConfidence, value.trackingConfidence, value.openness, value.grabStrength,
    value.pinchStrength, value.reachProgress, value.palmFacing,
  ];
  return value.handedness === "left"
    ? bounded.every((score) => isFiniteNumber(score) && score >= 0 && score <= 1)
      && isLandmarkArray(value.landmarks)
      && isLandmarkArray(value.worldLandmarks)
      && isFiniteTriple(value.center)
      && isOrthogonalBasis(value.wrist)
      && Array.isArray(value.curls) && value.curls.length === 5
      && value.curls.every((score) => isFiniteNumber(score) && score >= 0 && score <= 1)
      && isFiniteNumber(value.relativeScale) && value.relativeScale > 0
      && isFiniteNumber(value.velocity) && value.velocity >= 0
      && typeof value.reachEligible === "boolean"
      && isFiniteNumber(value.depth)
      && isFiniteNumber(value.palmSpan) && value.palmSpan > 0
    : false;
}

export function isControllerAction(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    CONTROLLER_ACTIONS.includes(value.action) &&
    (value.sentAt === undefined || isFiniteNumber(value.sentAt)) &&
    (value.action !== "task-hold" || (
      value.context === "door-defense" && typeof value.active === "boolean"
    )) &&
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
