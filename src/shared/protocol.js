export const EVENTS = Object.freeze({
  desktopCreate: "desktop:create",
  controllerJoin: "controller:join",
  controllerInput: "controller:input",
  controllerHand: "controller:hand",
  controllerAction: "controller:action",
  controllerVoiceClip: "controller:voice-clip",
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
  "voice-recording",
  "inventory-pointer",
]);

export const MAX_VOICE_DURATION_MS = 10_000;
export const MAX_VOICE_CLIP_BYTES = 256 * 1024;
export const INVENTORY_DELTA_LIMIT = 96;

const isFiniteNumber = (value) => Number.isFinite(value);
const CONTROLLER_SETTINGS_KEYS = new Set(["sensitivity", "smoothing"]);
const HAND_RAW_MEDIA_KEYS = ["image", "video", "pixels", "frame", "blob", "dataUrl"];
const HAND_TRACKED_KEYS = new Set([
  "version", "seq", "capturedAt", "modeEpoch", "state", "handedness",
  "handConfidence", "trackingConfidence", "landmarks", "worldLandmarks",
  "center", "wrist", "curls", "openness", "grabStrength", "palmFacing",
  "relativeScale", "velocity", "pinchStrength", "reachEligible", "reachProgress",
  "depth", "palmSpan", "inputMirrored",
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
    typeof value.clutch === "boolean" &&
    (!Object.hasOwn(value, "crouch") || typeof value.crouch === "boolean")
  );
}

function binaryByteLength(value) {
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

export function isVoiceClip(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => ["version", "seq", "durationMs", "mimeType", "data"].includes(key))) return false;
  const bytes = binaryByteLength(value.data);
  const mime = String(value.mimeType ?? "").split(";")[0].toLowerCase();
  return value.version === 1
    && Number.isInteger(value.seq) && value.seq >= 0
    && isFiniteNumber(value.durationMs) && value.durationMs > 0
    && value.durationMs <= MAX_VOICE_DURATION_MS
    && ["audio/webm", "audio/ogg", "audio/mp4"].includes(mime)
    && bytes > 0 && bytes <= MAX_VOICE_CLIP_BYTES;
}

function isFiniteTriple(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isControllerSettings(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === CONTROLLER_SETTINGS_KEYS.size
    && keys.every((key) => CONTROLLER_SETTINGS_KEYS.has(key))
    && isFiniteNumber(value.sensitivity) && value.sensitivity >= 0.6 && value.sensitivity <= 1.6
    && isFiniteNumber(value.smoothing) && value.smoothing >= 0 && value.smoothing <= 1;
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
  if (Object.hasOwn(value, "inputMirrored") && typeof value.inputMirrored !== "boolean") return false;
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!CONTROLLER_ACTIONS.includes(value.action)) return false;
  if (value.sentAt !== undefined && !isFiniteNumber(value.sentAt)) return false;

  const allowedKeys = {
    interact: ["action", "sentAt"],
    flashlight: ["action", "sentAt"],
    recenter: ["action", "sentAt"],
    pause: ["action", "sentAt"],
    resume: ["action", "sentAt"],
    settings: ["action", "sentAt", "settings"],
    "task-hold": ["action", "sentAt", "context", "active"],
    "gesture-presence": ["action", "sentAt", "ready", "active", "context"],
    "voice-recording": ["action", "sentAt", "active"],
    "inventory-pointer": ["action", "sentAt", "phase", "dx", "dy", "entryY"],
  };
  if (Object.keys(value).some((key) => !allowedKeys[value.action].includes(key))) return false;

  if (value.action === "task-hold") {
    return value.context === "door-defense" && typeof value.active === "boolean";
  }
  if (value.action === "gesture-presence") {
    return typeof value.ready === "boolean"
      && typeof value.active === "boolean"
      && ["door-defense", "found-phone"].includes(value.context);
  }
  if (value.action === "voice-recording") return typeof value.active === "boolean";
  if (value.action === "settings") return isControllerSettings(value.settings);
  if (value.action === "inventory-pointer") {
    if (!["open", "move", "commit", "cancel"].includes(value.phase)) return false;
    if (value.phase === "open") {
      return value.dx === undefined && value.dy === undefined
        && (value.entryY === undefined || (isFiniteNumber(value.entryY) && value.entryY >= 0 && value.entryY <= 1));
    }
    if (value.phase !== "move") {
      return value.dx === undefined && value.dy === undefined && value.entryY === undefined;
    }
    if (value.entryY !== undefined) return false;
    return isFiniteNumber(value.dx) && Math.abs(value.dx) <= INVENTORY_DELTA_LIMIT
      && isFiniteNumber(value.dy) && Math.abs(value.dy) <= INVENTORY_DELTA_LIMIT;
  }
  return true;
}

export function isDesktopEvent(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string" && value.type.length <= 48;
}
