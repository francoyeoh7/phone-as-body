// Fist-grab detector for the egg race controller. Phone lies flat in the palm,
// front camera faces up — the free hand above the phone makes a fist to grab.
// All frames stay on-device; only the fired gesture event leaves the phone.

const DETECT_INTERVAL_MS = 66;
const FIST_HOLD_MS = 140;
const REARM_MS = 300;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const FINGERS = [
  [8, 6],   // index tip / pip
  [12, 10], // middle
  [16, 14], // ring
  [20, 18], // pinky
];

function curledCount(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;
  const wrist = landmarks[0];
  let curled = 0;
  for (const [tip, pip] of FINGERS) {
    if (dist(landmarks[tip], wrist) < dist(landmarks[pip], wrist) * 1.12) curled += 1;
  }
  return curled;
}

function isFist(landmarks) {
  return curledCount(landmarks) >= 3;
}

function isOpen(landmarks) {
  return curledCount(landmarks) <= 1;
}

export class FistGrabDetector {
  constructor({ onGrab, onState, onHandPresence } = {}) {
    this.onGrab = onGrab;
    this.onState = onState;
    this.onHandPresence = onHandPresence;
    this.video = null;
    this.landmarker = null;
    this.timer = null;
    this.fistSince = null;
    this.armed = true;
    this.openSince = null;
    this.running = false;
    this.destroyed = false;
    this.lastHandSeen = false;
  }

  async start() {
    if (this.running || this.destroyed) return this.running;
    this.onState?.("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 320, height: 240 },
        audio: false,
      });
      this.video = document.createElement("video");
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();

      const module = await import("@mediapipe/tasks-vision");
      const fileset = await module.FilesetResolver.forVisionTasks("/assets/mediapipe/wasm");
      this.landmarker = await module.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/assets/mediapipe/hand_landmarker.task" },
        runningMode: "VIDEO",
        numHands: 1,
      });

      this.running = true;
      this.onState?.("ready");
      this.timer = window.setInterval(() => this.detect(), DETECT_INTERVAL_MS);
      return true;
    } catch {
      this.onState?.("unavailable");
      this.stop();
      return false;
    }
  }

  detect() {
    if (!this.running || !this.video || this.video.readyState < 2) return;
    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, performance.now());
    } catch {
      return;
    }
    const landmarks = result?.landmarks?.[0];
    const now = performance.now();

    const handSeen = Boolean(landmarks);
    if (handSeen !== this.lastHandSeen) {
      this.lastHandSeen = handSeen;
      this.onHandPresence?.(handSeen);
    }

    if (landmarks && isFist(landmarks)) {
      this.openSince = null;
      if (this.fistSince === null) this.fistSince = now;
      if (this.armed && now - this.fistSince >= FIST_HOLD_MS) {
        this.armed = false;
        this.fistSince = null;
        this.onGrab?.();
      }
      return;
    }
    this.fistSince = null;
    if (!landmarks || isOpen(landmarks)) {
      if (this.openSince === null) this.openSince = now;
      if (now - this.openSince >= REARM_MS) this.armed = true;
    } else {
      this.openSince = null;
    }
  }

  stop() {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    try { this.landmarker?.close?.(); } catch { /* noop */ }
    this.landmarker = null;
    const stream = this.video?.srcObject;
    if (stream) for (const track of stream.getTracks()) track.stop();
    this.video = null;
  }
}
