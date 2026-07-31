import jsfeat from "jsfeat";
import { summarizePointMotion } from "../shared/view-motion.js";

const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 72;
const PYRAMID_LEVELS = 3;
const MAXIMUM_CORNERS = 80;
const MINIMUM_TRACKED_CORNERS = 24;
const TRACKING_WINDOW_SIZE = 15;
const MINIMUM_FRAME_INTERVAL_MS = 1000 / 30;
const MINIMUM_DELTA_SECONDS = 1 / 120;
const MAXIMUM_DELTA_SECONDS = 0.1;
const TRANSLATION_PIXELS_PER_UNIT = 70;

export const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 30, max: 30 },
  },
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function finiteOutput(value) {
  if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (value > 0) return Number.MAX_VALUE;
  if (value < 0) return -Number.MAX_VALUE;
  return 0;
}

function zeroVelocity() {
  return { x: 0, y: 0, scaleVelocity: 0, rotation: 0, confidence: 0 };
}

export function cameraSummaryToVelocity(summary, deltaSeconds) {
  if (
    !summary
    || !Number.isFinite(summary.dx)
    || !Number.isFinite(summary.dy)
    || !Number.isFinite(summary.scale)
    || !Number.isFinite(summary.rotation)
    || !Number.isFinite(summary.confidence)
  ) {
    return zeroVelocity();
  }

  const duration = Number.isFinite(deltaSeconds)
    ? clamp(deltaSeconds, MINIMUM_DELTA_SECONDS, MAXIMUM_DELTA_SECONDS)
    : 1 / 30;

  return {
    x: finiteOutput(-summary.dx / (duration * TRANSLATION_PIXELS_PER_UNIT)),
    y: finiteOutput(-summary.dy / (duration * TRANSLATION_PIXELS_PER_UNIT)),
    scaleVelocity: finiteOutput((summary.scale - 1) / duration),
    rotation: summary.rotation,
    confidence: clamp(summary.confidence, 0, 1),
  };
}

export class CameraMotionTracker {
  constructor({
    onSample,
    onState,
    requestCamera = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createVideo = () => document.createElement("video"),
    createCanvas = () => document.createElement("canvas"),
    scheduleFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
    vision = jsfeat,
  } = {}) {
    this.onSample = onSample;
    this.onState = onState;
    this.requestCamera = requestCamera;
    this.createVideo = createVideo;
    this.createCanvas = createCanvas;
    this.scheduleFrame = scheduleFrame;
    this.cancelFrame = cancelFrame;
    this.vision = vision;

    this.active = false;
    this.frozen = false;
    this.startPromise = null;
    this.frameId = null;
    this.lastState = null;
    this.cleanupDone = true;
    this.lifecycleVersion = 0;
    this.stoppedTracks = new WeakSet();
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.handleFrame = this.handleFrame.bind(this);
    this.clearHistory();
  }

  async start() {
    if (this.active) return true;
    if (this.startPromise) return this.startPromise;

    const lifecycleVersion = this.lifecycleVersion + 1;
    this.lifecycleVersion = lifecycleVersion;
    this.cleanupDone = false;
    this.startPromise = this.startInternal(lifecycleVersion);
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal(lifecycleVersion) {
    let requestedStream = null;
    try {
      const stream = await this.requestCamera(CAMERA_CONSTRAINTS);
      requestedStream = stream;
      if (lifecycleVersion !== this.lifecycleVersion) {
        this.stopStream(stream);
        return false;
      }
      if (!stream || typeof stream.getTracks !== "function") throw new Error("Invalid camera stream");
      this.stream = stream;

      const video = this.createVideo();
      if (!video || typeof video.play !== "function") throw new Error("Video unavailable");
      this.video = video;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (lifecycleVersion !== this.lifecycleVersion) return false;

      const canvas = this.createCanvas();
      if (!canvas || typeof canvas.getContext !== "function") throw new Error("Canvas unavailable");
      this.canvas = canvas;
      canvas.width = FRAME_WIDTH;
      canvas.height = FRAME_HEIGHT;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas context unavailable");
      this.context = context;

      this.allocateVisionBuffers();
      this.clearHistory();
      this.active = true;
      this.scheduleAnalysis();
      this.emitState("camera-active");
      return true;
    } catch (error) {
      if (lifecycleVersion !== this.lifecycleVersion) {
        this.stopStream(requestedStream);
        return false;
      }
      this.releaseResources(false);
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      this.emitState(denied ? "camera-denied" : "camera-unavailable");
      return false;
    }
  }

  allocateVisionBuffers() {
    const vision = this.vision;
    if (
      typeof vision?.pyramid_t !== "function"
      || typeof vision?.keypoint_t !== "function"
      || !vision?.imgproc
      || !vision?.yape06
      || !vision?.optical_flow_lk
    ) {
      throw new Error("Vision unavailable");
    }

    this.previousPyramid = new vision.pyramid_t(PYRAMID_LEVELS);
    this.currentPyramid = new vision.pyramid_t(PYRAMID_LEVELS);
    this.previousPyramid.allocate(FRAME_WIDTH, FRAME_HEIGHT, vision.U8C1_t);
    this.currentPyramid.allocate(FRAME_WIDTH, FRAME_HEIGHT, vision.U8C1_t);
    this.corners = Array.from(
      { length: FRAME_WIDTH * FRAME_HEIGHT },
      () => new vision.keypoint_t(0, 0, 0, 0),
    );
    this.previousCoordinates = new Float32Array(MAXIMUM_CORNERS * 2);
    this.currentCoordinates = new Float32Array(MAXIMUM_CORNERS * 2);
    this.trackStatus = new Uint8Array(MAXIMUM_CORNERS);
    this.validPreviousPoints = Array.from({ length: MAXIMUM_CORNERS }, () => null);
    this.validCurrentPoints = Array.from({ length: MAXIMUM_CORNERS }, () => null);
    this.previousPointPool = Array.from({ length: MAXIMUM_CORNERS }, () => ({ x: 0, y: 0 }));
    this.currentPointPool = Array.from({ length: MAXIMUM_CORNERS }, () => ({ x: 0, y: 0 }));

    vision.yape06.laplacian_threshold = 30;
    vision.yape06.min_eigen_value_threshold = 25;
  }

  setFrozen(frozen) {
    const nextFrozen = Boolean(frozen);
    if (nextFrozen === this.frozen) return;
    this.frozen = nextFrozen;
    if (nextFrozen) {
      this.clearHistory();
      this.emitZero();
    }
  }

  reset() {
    this.clearHistory();
    this.emitZero();
  }

  stop() {
    if (this.cleanupDone) return;
    this.lifecycleVersion += 1;
    this.releaseResources(true);
  }

  destroy() {
    this.stop();
  }

  clearHistory() {
    this.clearFrameHistory();
    this.lastAnalysisTimestamp = null;
  }

  clearFrameHistory() {
    this.hasPreviousFrame = false;
    this.trackedPointCount = 0;
    this.stableFramesRemaining = 3;
  }

  emitZero() {
    this.onSample?.(zeroVelocity());
  }

  emitState(state) {
    if (state === this.lastState) return;
    this.lastState = state;
    this.onState?.(state);
  }

  scheduleAnalysis() {
    if (!this.active || this.frameId !== null) return;
    this.frameId = this.scheduleFrame(this.handleFrame);
  }

  handleFrame(timestamp) {
    this.frameId = null;
    if (!this.active) return;

    const frameTimestamp = Number.isFinite(timestamp) ? timestamp : null;
    if (
      frameTimestamp !== null
      && this.lastAnalysisTimestamp !== null
      && frameTimestamp >= this.lastAnalysisTimestamp
      && frameTimestamp - this.lastAnalysisTimestamp < MINIMUM_FRAME_INTERVAL_MS
    ) {
      this.scheduleAnalysis();
      return;
    }

    const deltaSeconds = frameTimestamp !== null && this.lastAnalysisTimestamp !== null
      ? (frameTimestamp - this.lastAnalysisTimestamp) / 1000
      : 1 / 30;
    if (frameTimestamp !== null) this.lastAnalysisTimestamp = frameTimestamp;

    try {
      this.processFrame(deltaSeconds);
    } catch {
      this.clearFrameHistory();
      this.emitZero();
    } finally {
      this.scheduleAnalysis();
    }
  }

  processFrame(deltaSeconds) {
    if (
      !this.video
      || !this.context
      || this.video.readyState < 2
      || this.video.videoWidth <= 0
      || this.video.videoHeight <= 0
    ) {
      this.clearFrameHistory();
      this.emitZero();
      return;
    }

    this.context.drawImage(this.video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    const imageData = this.context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    if (!imageData?.data) throw new Error("Camera frame unavailable");
    this.vision.imgproc.grayscale(
      imageData.data,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      this.currentPyramid.data[0],
    );
    this.currentPyramid.build(this.currentPyramid.data[0], true);

    if (!this.hasPreviousFrame) {
      this.trackedPointCount = this.detectCorners(this.currentPyramid.data[0]);
      this.hasPreviousFrame = true;
      this.swapPyramids();
      this.emitZero();
      return;
    }

    this.vision.optical_flow_lk.track(
      this.previousPyramid,
      this.currentPyramid,
      this.previousCoordinates,
      this.currentCoordinates,
      this.trackedPointCount,
      TRACKING_WINDOW_SIZE,
      20,
      this.trackStatus,
      0.01,
      0.001,
    );

    const validCount = this.collectValidTracks();
    const summary = summarizePointMotion(this.validPreviousPoints, this.validCurrentPoints);

    if (validCount < MINIMUM_TRACKED_CORNERS) {
      this.trackedPointCount = this.detectCorners(this.currentPyramid.data[0]);
    } else {
      this.trackedPointCount = validCount;
      for (let index = 0; index < validCount; index += 1) {
        const coordinateIndex = index * 2;
        const point = this.validCurrentPoints[index];
        this.previousCoordinates[coordinateIndex] = point.x;
        this.previousCoordinates[coordinateIndex + 1] = point.y;
      }
    }
    this.swapPyramids();

    if (!(summary.confidence > 0)) {
      this.emitState("tracking-weak");
      this.emitZero();
      return;
    }

    this.emitState("camera-active");
    if (this.frozen) {
      this.emitZero();
      return;
    }
    if (this.stableFramesRemaining > 0) {
      this.stableFramesRemaining -= 1;
      this.emitZero();
      return;
    }
    this.onSample?.(cameraSummaryToVelocity(summary, deltaSeconds));
  }

  detectCorners(frame) {
    const detected = clamp(
      Math.trunc(this.vision.yape06.detect(frame, this.corners, 8)),
      0,
      this.corners.length,
    );
    const selected = Math.min(detected, MAXIMUM_CORNERS);

    for (let slot = 0; slot < selected; slot += 1) {
      let strongest = slot;
      for (let candidate = slot + 1; candidate < detected; candidate += 1) {
        if (this.corners[candidate].score > this.corners[strongest].score) strongest = candidate;
      }
      if (strongest !== slot) {
        const corner = this.corners[slot];
        this.corners[slot] = this.corners[strongest];
        this.corners[strongest] = corner;
      }

      const coordinateIndex = slot * 2;
      this.previousCoordinates[coordinateIndex] = this.corners[slot].x;
      this.previousCoordinates[coordinateIndex + 1] = this.corners[slot].y;
    }

    return selected;
  }

  collectValidTracks() {
    let validCount = 0;
    for (let index = 0; index < this.trackedPointCount; index += 1) {
      if (this.trackStatus[index] !== 1) continue;
      const coordinateIndex = index * 2;
      const previousX = this.previousCoordinates[coordinateIndex];
      const previousY = this.previousCoordinates[coordinateIndex + 1];
      const currentX = this.currentCoordinates[coordinateIndex];
      const currentY = this.currentCoordinates[coordinateIndex + 1];
      if (
        !Number.isFinite(previousX)
        || !Number.isFinite(previousY)
        || !Number.isFinite(currentX)
        || !Number.isFinite(currentY)
        || previousX < 0
        || previousX >= FRAME_WIDTH
        || previousY < 0
        || previousY >= FRAME_HEIGHT
        || currentX < 0
        || currentX >= FRAME_WIDTH
        || currentY < 0
        || currentY >= FRAME_HEIGHT
      ) {
        continue;
      }

      const previousPoint = this.previousPointPool[validCount];
      previousPoint.x = previousX;
      previousPoint.y = previousY;
      const currentPoint = this.currentPointPool[validCount];
      currentPoint.x = currentX;
      currentPoint.y = currentY;
      this.validPreviousPoints[validCount] = previousPoint;
      this.validCurrentPoints[validCount] = currentPoint;
      validCount += 1;
    }

    for (let index = validCount; index < MAXIMUM_CORNERS; index += 1) {
      this.validPreviousPoints[index] = null;
      this.validCurrentPoints[index] = null;
    }
    return validCount;
  }

  swapPyramids() {
    const previous = this.previousPyramid;
    this.previousPyramid = this.currentPyramid;
    this.currentPyramid = previous;
  }

  releaseResources(emitZero) {
    this.active = false;
    if (this.frameId !== null) {
      this.cancelFrame(this.frameId);
      this.frameId = null;
    }

    if (this.video) {
      if (typeof this.video.pause === "function") this.video.pause();
      this.video.srcObject = null;
    }

    this.stopStream(this.stream);

    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.previousPyramid = null;
    this.currentPyramid = null;
    this.corners = null;
    this.previousCoordinates = null;
    this.currentCoordinates = null;
    this.trackStatus = null;
    this.validPreviousPoints = null;
    this.validCurrentPoints = null;
    this.previousPointPool = null;
    this.currentPointPool = null;
    this.clearHistory();
    this.cleanupDone = true;
    if (emitZero) this.emitZero();
  }

  stopStream(stream) {
    if (!stream || typeof stream.getTracks !== "function") return;

    let tracks;
    try {
      tracks = stream.getTracks();
    } catch {
      return;
    }
    for (const track of tracks) {
      if (!track || (typeof track !== "object" && typeof track !== "function")) continue;
      if (this.stoppedTracks.has(track)) continue;
      this.stoppedTracks.add(track);
      try {
        track.stop?.();
      } catch {
        // A failed track cannot be made safer by retrying stop during later cleanup.
      }
    }
  }
}
