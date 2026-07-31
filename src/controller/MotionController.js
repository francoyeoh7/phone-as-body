import { Euler, Quaternion, Vector3 } from "three";

const zee = new Vector3(0, 0, 1);
const deviceCorrection = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const toRadians = Math.PI / 180;

function screenAngle() {
  const angle = window.screen?.orientation?.angle;
  return Number.isFinite(angle) ? angle : Number(window.orientation) || 0;
}

export function deviceOrientationToQuaternion({ alpha, beta, gamma }, orientationAngle = screenAngle()) {
  if (![alpha, beta, gamma, orientationAngle].every(Number.isFinite)) return null;
  const euler = new Euler(beta * toRadians, alpha * toRadians, -gamma * toRadians, "YXZ");
  const quaternion = new Quaternion().setFromEuler(euler);
  quaternion.multiply(deviceCorrection);
  quaternion.multiply(new Quaternion().setFromAxisAngle(zee, -orientationAngle * toRadians));
  quaternion.normalize();
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

export class MotionController {
  constructor({ onSample, onState }) {
    this.onSample = onSample;
    this.onState = onState;
    this.latest = null;
    this.frame = null;
    this.active = false;
    this.suspendedUntil = 0;
    this.resumeTimer = null;
    this.handleOrientation = this.handleOrientation.bind(this);
    this.handleScreenOrientation = this.handleScreenOrientation.bind(this);
  }

  get supported() {
    return typeof window.DeviceOrientationEvent !== "undefined";
  }

  async requestPermission() {
    if (!window.isSecureContext && location.hostname !== "localhost") {
      this.onState?.("insecure");
      return false;
    }
    if (!this.supported) {
      this.onState?.("unsupported");
      return false;
    }

    try {
      const request = window.DeviceOrientationEvent.requestPermission;
      const permission = typeof request === "function" ? await request.call(window.DeviceOrientationEvent) : "granted";
      if (permission !== "granted") {
        this.onState?.("denied");
        return false;
      }
      this.start();
      return true;
    } catch {
      this.onState?.("denied");
      return false;
    }
  }

  start() {
    if (this.active) return;
    this.active = true;
    window.addEventListener("deviceorientation", this.handleOrientation, true);
    window.screen?.orientation?.addEventListener("change", this.handleScreenOrientation);
    window.addEventListener("orientationchange", this.handleScreenOrientation);
    this.onState?.("waiting");
  }

  handleOrientation(event) {
    if (Date.now() < this.suspendedUntil) return;
    const sample = deviceOrientationToQuaternion(event);
    if (!sample) return;
    this.latest = sample;
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.onSample?.(this.latest);
      this.onState?.("active");
    });
  }

  handleScreenOrientation() {
    this.suspendedUntil = Date.now() + 350;
    this.onState?.("reorienting");
    window.clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => this.onState?.("waiting"), 350);
  }

  destroy() {
    window.removeEventListener("deviceorientation", this.handleOrientation, true);
    window.screen?.orientation?.removeEventListener("change", this.handleScreenOrientation);
    window.removeEventListener("orientationchange", this.handleScreenOrientation);
    window.clearTimeout(this.resumeTimer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }
}
