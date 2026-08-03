const CAMERA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 15, max: 20 },
  },
});

const DEFAULT_OPTIONS = Object.freeze({
  pixelThreshold: 6 / 255,
  minMeanDifference: 0.004,
  maxMeanDifference: 0.8,
  minActiveRatio: 0.02,
  minLargestActiveRatio: 0.004,
  maxActiveRatio: 0.92,
});

const defaultNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const defaultRequestFrame = (callback) => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(callback, 66);
};
const defaultCancelFrame = (handle) => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

function finitePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function measureFrameMotion(previous, current, width, height, options = {}) {
  const pixelCount = Math.max(0, Math.floor(Number(width) * Number(height)));
  if (!pixelCount || !previous || !current || previous.length < pixelCount || current.length < pixelCount) {
    return { meanDifference: 0, activeRatio: 0 };
  }

  const threshold = Number.isFinite(options.pixelThreshold)
    ? Math.min(1, Math.max(0, options.pixelThreshold))
    : DEFAULT_OPTIONS.pixelThreshold;
  let differenceSum = 0;
  let activePixels = 0;
  const activeMask = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const difference = Math.abs(Number(current[index]) - Number(previous[index])) / 255;
    differenceSum += difference;
    if (difference >= threshold) {
      activePixels += 1;
      activeMask[index] = 1;
    }
  }

  let largestActivePixels = 0;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (!activeMask[index] || visited[index]) continue;
    let head = 0;
    let tail = 0;
    let componentSize = 0;
    queue[tail] = index;
    tail += 1;
    visited[index] = 1;
    while (head < tail) {
      const currentIndex = queue[head];
      head += 1;
      componentSize += 1;
      const x = currentIndex % width;
      const y = Math.floor(currentIndex / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const neighbourX = x + offsetX;
          const neighbourY = y + offsetY;
          if (neighbourX < 0 || neighbourX >= width || neighbourY < 0 || neighbourY >= height) continue;
          const neighbour = neighbourY * width + neighbourX;
          if (visited[neighbour] || !activeMask[neighbour]) continue;
          visited[neighbour] = 1;
          queue[tail] = neighbour;
          tail += 1;
        }
      }
    }
    largestActivePixels = Math.max(largestActivePixels, componentSize);
  }
  return {
    meanDifference: differenceSum / pixelCount,
    activeRatio: activePixels / pixelCount,
    largestActiveRatio: largestActivePixels / pixelCount,
  };
}

export function shouldTriggerMotion(metrics, options = {}) {
  if (!metrics || !Number.isFinite(metrics.meanDifference) || !Number.isFinite(metrics.activeRatio)) return false;
  const minMeanDifference = Number.isFinite(options.minMeanDifference)
    ? options.minMeanDifference
    : DEFAULT_OPTIONS.minMeanDifference;
  const maxMeanDifference = Number.isFinite(options.maxMeanDifference)
    ? options.maxMeanDifference
    : DEFAULT_OPTIONS.maxMeanDifference;
  const minActiveRatio = Number.isFinite(options.minActiveRatio)
    ? options.minActiveRatio
    : DEFAULT_OPTIONS.minActiveRatio;
  const minLargestActiveRatio = Number.isFinite(options.minLargestActiveRatio)
    ? options.minLargestActiveRatio
    : DEFAULT_OPTIONS.minLargestActiveRatio;
  const maxActiveRatio = Number.isFinite(options.maxActiveRatio)
    ? options.maxActiveRatio
    : DEFAULT_OPTIONS.maxActiveRatio;
  const largestActiveRatio = Number.isFinite(metrics.largestActiveRatio)
    ? metrics.largestActiveRatio
    : metrics.activeRatio;
  return metrics.meanDifference >= minMeanDifference
    && metrics.meanDifference <= maxMeanDifference
    && metrics.activeRatio >= minActiveRatio
    && largestActiveRatio >= minLargestActiveRatio
    && metrics.activeRatio <= maxActiveRatio;
}

function createCaptureElements(documentRef, width, height) {
  if (!documentRef?.createElement) return null;
  const video = documentRef.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute?.("aria-hidden", "true");
  video.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";

  const canvas = documentRef.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext?.("2d", { willReadFrequently: true }) ?? canvas.getContext?.("2d");
  if (!context) return null;
  documentRef.body?.appendChild?.(video);
  return { video, canvas, context };
}

export class CameraMotionDetector {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    documentRef = globalThis.document,
    createCaptureElements: createElements = (width, height) => createCaptureElements(documentRef, width, height),
    requestFrame = defaultRequestFrame,
    cancelFrame = defaultCancelFrame,
    onMotion,
    onState,
    now = defaultNow,
    cooldownMs = 750,
    rearmQuietFrames = 3,
    sampleIntervalMs = 50,
    sampleWidth = 64,
    sampleHeight = 48,
    scoringOptions = {},
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.createCaptureElements = createElements;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.onMotion = onMotion;
    this.onState = onState;
    this.now = typeof now === "function" ? now : defaultNow;
    this.cooldownMs = finitePositive(cooldownMs, 750);
    this.rearmQuietFrames = Math.max(1, Math.floor(finitePositive(rearmQuietFrames, 3)));
    this.sampleIntervalMs = finitePositive(sampleIntervalMs, 50);
    this.sampleWidth = Math.max(8, Math.floor(sampleWidth));
    this.sampleHeight = Math.max(8, Math.floor(sampleHeight));
    this.scoringOptions = { ...DEFAULT_OPTIONS, ...scoringOptions };
    this.stream = null;
    this.capture = null;
    this.frameHandle = null;
    this.previousFrame = null;
    this.focused = false;
    this.triggered = false;
    this.quietFrameCount = 0;
    this.cooldownUntil = 0;
    this.lastSampleAt = -Infinity;
    this.started = false;
    this.cameraGranted = false;
    this.suspended = false;
    this.destroyed = false;
  }

  async start() {
    if (this.destroyed) return { cameraGranted: false };
    if (this.started) return { cameraGranted: this.cameraGranted };
    if (!this.mediaDevices?.getUserMedia) {
      this.onState?.("unsupported");
      return { cameraGranted: false };
    }
    try {
      this.stream = await this.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      this.cameraGranted = true;
      this.started = true;
      this.capture = this.createCaptureElements(this.sampleWidth, this.sampleHeight);
      if (this.capture?.video) {
        this.capture.video.srcObject = this.stream;
        const playResult = this.capture.video.play?.();
        await playResult?.catch?.(() => {});
      }
      this.onState?.("ready");
      this.scheduleFrame();
      return { cameraGranted: true };
    } catch {
      this.onState?.("denied");
      this.stopStream();
      this.cameraGranted = false;
      this.started = false;
      this.capture?.video?.remove?.();
      this.capture = null;
      return { cameraGranted: false };
    }
  }

  setFocused(focused) {
    const next = Boolean(focused);
    if (next === this.focused) return;
    this.focused = next;
    this.previousFrame = null;
    this.triggered = false;
    this.quietFrameCount = 0;
    this.cooldownUntil = 0;
    this.lastSampleAt = -Infinity;
    this.onState?.(next ? "focused" : "idle");
  }

  ingestFrame(frame, width, height, timestamp = this.now()) {
    if (this.destroyed || !this.cameraGranted || this.suspended || !this.focused) return false;
    if (!this.previousFrame) {
      this.previousFrame = frame.slice?.() ?? Uint8Array.from(frame);
      return false;
    }
    const metrics = measureFrameMotion(this.previousFrame, frame, width, height, this.scoringOptions);
    this.previousFrame = frame.slice?.() ?? Uint8Array.from(frame);
    const qualifies = shouldTriggerMotion(metrics, this.scoringOptions);
    if (this.triggered) {
      if (timestamp < this.cooldownUntil || qualifies) {
        this.quietFrameCount = 0;
        return false;
      }
      this.quietFrameCount += 1;
      if (this.quietFrameCount >= this.rearmQuietFrames) {
        this.triggered = false;
        this.quietFrameCount = 0;
      }
      return false;
    }
    if (timestamp < this.cooldownUntil || !qualifies) return false;
    this.triggered = true;
    this.quietFrameCount = 0;
    this.cooldownUntil = timestamp + this.cooldownMs;
    this.onMotion?.({ metrics, timestamp });
    return true;
  }

  captureFrame() {
    if (this.destroyed || this.suspended || !this.capture?.video || !this.capture.context) return;
    const video = this.capture.video;
    if (video.readyState < 2) return;
    const timestamp = this.now();
    if (timestamp - this.lastSampleAt < this.sampleIntervalMs) return;
    this.lastSampleAt = timestamp;
    const { context } = this.capture;
    context.drawImage(video, 0, 0, this.sampleWidth, this.sampleHeight);
    const pixels = context.getImageData(0, 0, this.sampleWidth, this.sampleHeight).data;
    const grayscale = new Uint8Array(this.sampleWidth * this.sampleHeight);
    for (let source = 0, target = 0; target < grayscale.length; source += 4, target += 1) {
      grayscale[target] = Math.round(pixels[source] * 0.299 + pixels[source + 1] * 0.587 + pixels[source + 2] * 0.114);
    }
    this.ingestFrame(grayscale, this.sampleWidth, this.sampleHeight, timestamp);
  }

  scheduleFrame() {
    if (this.destroyed || this.suspended || !this.capture || this.frameHandle !== null) return;
    this.frameHandle = this.requestFrame(() => {
      this.frameHandle = null;
      this.captureFrame();
      this.scheduleFrame();
    });
  }

  suspend() {
    this.suspended = true;
    this.previousFrame = null;
    this.quietFrameCount = 0;
    this.lastSampleAt = -Infinity;
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.onState?.("suspended");
  }

  resume() {
    if (this.destroyed) return false;
    this.suspended = false;
    this.previousFrame = null;
    this.quietFrameCount = 0;
    this.lastSampleAt = -Infinity;
    this.scheduleFrame();
    return this.cameraGranted;
  }

  stopStream() {
    this.stream?.getTracks?.().forEach((track) => track.stop?.());
    this.stream = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
    this.stopStream();
    this.capture?.video?.pause?.();
    this.capture?.video?.remove?.();
    this.capture = null;
    this.previousFrame = null;
    this.onState?.("destroyed");
  }
}

export { CAMERA_CONSTRAINTS };
