import {
  createTrackedHandFrame,
  createHandStatusFrame,
  deriveHandFeatures,
  normalizeMediaPipeHandedness,
  normalizeCameraLandmarks,
  normalizeCameraWorldLandmarks,
  resolveCameraRotation,
} from "../shared/hand-pose.js";
import { createReachState, updateReachState } from "../shared/hand-reach.js";

const SAMPLE_INTERVAL_MS = 1000 / 15;
const LOST_AFTER_CONSECUTIVE_MISSES = 2;
const VIDEO_READY_TIMEOUT_MS = 3_000;

const defaultScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
};

function frontFacing(video) {
  return video?.srcObject?.getTracks?.()?.some((track) => track?.getSettings?.()?.facingMode === "user");
}

function cardinalRotation(value) {
  const normalized = ((Number(value) % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
}

function defaultScreenOrientation() {
  return cardinalRotation(globalThis.screen?.orientation?.angle ?? globalThis.window?.orientation ?? 0);
}

function trackRotation(video) {
  const explicitRotation = video?.cameraRotation ?? video?.videoRotation;
  if (Number.isFinite(explicitRotation)) return cardinalRotation(explicitRotation);
  const rotation = video?.srcObject?.getTracks?.()
    ?.map((track) => track?.getSettings?.()?.rotation)
    .find(Number.isFinite);
  return cardinalRotation(rotation ?? 0);
}

function candidateDistance(center, previous) {
  const prior = previous?.center;
  return prior ? Math.hypot(center[0] - prior[0], center[1] - prior[1]) : 0;
}

function canonicalLeftCategory(category, inputMirrored) {
  return {
    ...(category && typeof category === "object" ? category : {}),
    categoryName: inputMirrored ? "Left" : "Right",
  };
}

export function selectPhysicalLeftCandidate(result, previous, inputMirrored = true) {
  const landmarks = result?.landmarks ?? [];
  if (!landmarks.length) return null;
  let best = null;
  let bestScore = -Infinity;
  landmarks.forEach((points, index) => {
    const category = result?.handedness?.[index]?.[0];
    const detectedLabel = normalizeMediaPipeHandedness(category?.categoryName, inputMirrored);
    if (!previous && detectedLabel !== "left") return;
    const center = points?.[0] ? [points[0].x, points[0].y, points[0].z ?? 0] : [0, 0, 0];
    const distance = candidateDistance(center, previous);
    const confidence = Number.isFinite(category?.score) ? category.score : 0;
    const score = previous ? confidence * 0.35 - distance * 0.65 : confidence;
    if (score > bestScore) {
      bestScore = score;
      best = { index, label: "left", detectedLabel };
    }
  });
  return best;
}

export class MediaPipeHandTracker {
  constructor({
    getVideo = () => null,
    onFrame,
    onState,
    scheduler = defaultScheduler,
    workerFactory,
    worker,
    createImageBitmap: bitmapFactory = globalThis.createImageBitmap,
    OffscreenCanvas: OffscreenCanvasCtor = globalThis.OffscreenCanvas,
    loadModule = () => import("@mediapipe/tasks-vision"),
    landmarkerFactory = null,
    sampleIntervalMs = SAMPLE_INTERVAL_MS,
    getScreenOrientation = defaultScreenOrientation,
    inputMirrored = true,
  } = {}) {
    this.getVideo = getVideo;
    this.onFrame = onFrame;
    this.onState = onState;
    this.scheduler = { ...defaultScheduler, ...scheduler };
    const bundledWorkerFactory = typeof Worker === "function"
      ? () => new Worker(new URL("./hand-tracking.worker.js", import.meta.url), { type: "module" })
      : null;
    this.workerFactory = worker === false ? null : (workerFactory ?? bundledWorkerFactory);
    this.worker = worker && worker !== false ? worker : null;
    this.bitmapFactory = bitmapFactory;
    this.OffscreenCanvas = OffscreenCanvasCtor;
    this.loadModule = loadModule;
    this.landmarkerFactory = landmarkerFactory;
    this.sampleIntervalMs = sampleIntervalMs;
    this.getScreenOrientation = getScreenOrientation;
    this.inputMirrored = inputMirrored === true;
    this.modeEpoch = 0;
    this.seq = 0;
    this.active = false;
    this.destroyed = false;
    this.suspended = false;
    this.inferencePending = false;
    this.inferenceEpoch = null;
    this.workerReadyEpoch = null;
    this.initializing = false;
    this.landmarker = null;
    this.timer = null;
    this.videoFrameCallbackId = null;
    this.lastPresentedFrames = null;
    this.nextSampleDeadline = null;
    this.statusTimer = null;
    this.lastResultAt = -Infinity;
    this.lastState = null;
    this.lastLostAt = -Infinity;
    this.consecutiveMisses = 0;
    this.previous = null;
    this.reachState = createReachState();
    this.calibration = null;
    this.currentRotation = null;
    this.unavailableEpoch = null;
    this.videoUnavailableSince = null;
    this.workerFallbackEpoch = null;
    if (this.worker) this.bindWorker(this.worker);
  }

  bindWorker(worker) {
    worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    worker.onerror = () => { void this.fallbackToMainThread("worker-error", this.modeEpoch); };
  }

  canUseWorker() {
    return Boolean(
      this.bitmapFactory
      && this.OffscreenCanvas
      && (this.worker || this.workerFactory),
    );
  }

  createWorker() {
    if (this.worker) return this.worker;
    this.worker = this.workerFactory();
    this.bindWorker(this.worker);
    return this.worker;
  }

  isEpochActive(epoch) {
    return epoch === this.modeEpoch && this.active && !this.destroyed;
  }

  closeLandmarker() {
    this.landmarker?.close?.();
    this.landmarker = null;
  }

  disableWorker() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate?.();
    }
    this.worker = null;
    this.workerFactory = null;
    this.workerReadyEpoch = null;
  }

  finishInference(epoch) {
    if (this.inferenceEpoch !== epoch) return;
    this.inferencePending = false;
    this.inferenceEpoch = null;
    this.scheduleFromDeadline();
  }

  async setTask(task = {}) {
    if (this.destroyed) return;
    this.modeEpoch += 1;
    const epoch = this.modeEpoch;
    this.clearTimers();
    this.closeLandmarker();
    this.workerReadyEpoch = null;
    this.inferencePending = false;
    this.inferenceEpoch = null;
    this.active = Boolean(task.active);
    this.previous = null;
    this.reachState = createReachState();
    this.calibration = null;
    this.currentRotation = null;
    this.lastPresentedFrames = null;
    this.nextSampleDeadline = null;
    this.lastResultAt = this.scheduler.now();
    this.lastState = null;
    this.lastLostAt = -Infinity;
    this.consecutiveMisses = 0;
    this.unavailableEpoch = null;
    this.videoUnavailableSince = null;
    this.workerFallbackEpoch = null;
    if (!this.active) return;
    this.emitState("starting");
    if (frontFacing(this.getVideo())) return this.emitUnavailable("front-camera");
    if (this.canUseWorker()) {
      try {
        const worker = this.createWorker();
        this.initializing = true;
        const canvas = new this.OffscreenCanvas(1, 1);
        worker.postMessage({ type: "init", modeEpoch: epoch, canvas }, [canvas]);
        this.initializing = false;
      } catch (error) {
        this.initializing = false;
        await this.fallbackToMainThread(error?.message ?? "worker-init-failed", epoch);
      }
      return;
    }
    await this.initializeMainThread(epoch);
  }

  async initializeMainThread(epoch) {
    if (!this.isEpochActive(epoch)) return false;
    this.initializing = true;
    try {
      const module = await this.loadModule();
      if (!this.isEpochActive(epoch)) return;
      const fileset = await module.FilesetResolver.forVisionTasks("/assets/mediapipe/wasm");
      if (!this.isEpochActive(epoch)) return;
      const create = this.landmarkerFactory ?? module.HandLandmarker.createFromOptions.bind(module.HandLandmarker);
      const landmarker = await create(fileset, {
        baseOptions: { modelAssetPath: "/assets/mediapipe/hand_landmarker.task" },
        runningMode: "VIDEO", numHands: 1,
        minHandDetectionConfidence: 0.62, minHandPresenceConfidence: 0.58, minTrackingConfidence: 0.58,
      });
      if (!this.isEpochActive(epoch)) {
        landmarker?.close?.();
        return;
      }
      this.landmarker = landmarker;
      this.emitState("calibrating");
      this.resetSampleDeadline();
      this.schedule(0);
      return true;
    } catch (error) {
      if (this.isEpochActive(epoch)) this.emitUnavailable(error?.message ?? "init-failed");
      return false;
    } finally {
      if (this.modeEpoch === epoch) this.initializing = false;
    }
  }

  async fallbackToMainThread(_reason, epoch = this.modeEpoch) {
    if (!this.isEpochActive(epoch) || this.workerFallbackEpoch === epoch) return false;
    this.workerFallbackEpoch = epoch;
    this.clearTimers();
    this.inferencePending = false;
    this.inferenceEpoch = null;
    this.disableWorker();
    this.closeLandmarker();
    this.emitState("starting");
    this.resetSampleDeadline();
    return this.initializeMainThread(epoch);
  }

  schedule(delay = this.sampleIntervalMs) {
    if (!this.active || this.suspended || this.destroyed) return;
    if (this.worker && this.workerReadyEpoch !== this.modeEpoch) return;
    if (this.timer != null) this.scheduler.clearTimeout(this.timer);
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.requestPresentedFrame();
    }, delay);
  }

  requestPresentedFrame() {
    if (!this.active || this.suspended || this.destroyed) return;
    const video = this.getVideo();
    if (video?.readyState >= 2 && typeof video.requestVideoFrameCallback === "function") {
      this.videoFrameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        this.videoFrameCallbackId = null;
        void this.sample(metadata);
      });
      return;
    }
    void this.sample();
  }

  resetSampleDeadline(now = this.scheduler.now()) {
    this.nextSampleDeadline = now;
  }

  advanceSampleDeadline(now = this.scheduler.now()) {
    if (!Number.isFinite(this.nextSampleDeadline)) this.nextSampleDeadline = now;
    while (this.nextSampleDeadline <= now) this.nextSampleDeadline += this.sampleIntervalMs;
  }

  scheduleFromDeadline(now = this.scheduler.now()) {
    if (!this.active || this.suspended || this.destroyed) return;
    if (!Number.isFinite(this.nextSampleDeadline)) {
      this.nextSampleDeadline = now + this.sampleIntervalMs;
    }
    if (this.nextSampleDeadline <= now) {
      this.schedule(0);
      return;
    }
    this.schedule(this.nextSampleDeadline - now);
  }

  async sample(frameMetadata = null) {
    if (!this.active || this.suspended || this.destroyed || this.inferencePending) return;
    if (this.worker && this.workerReadyEpoch !== this.modeEpoch) return;
    const video = this.getVideo();
    if (frontFacing(video)) return this.emitUnavailable("front-camera");
    const sampleStartedAt = this.scheduler.now();
    this.advanceSampleDeadline(sampleStartedAt);
    const presentedFrames = frameMetadata?.presentedFrames;
    if (Number.isFinite(presentedFrames)) {
      if (Number.isFinite(this.lastPresentedFrames) && presentedFrames <= this.lastPresentedFrames) {
        this.scheduleFromDeadline(sampleStartedAt);
        return;
      }
      this.lastPresentedFrames = presentedFrames;
    }
    if (!video || video.readyState < 2) {
      const now = sampleStartedAt;
      this.videoUnavailableSince ??= now;
      if (now - this.videoUnavailableSince >= VIDEO_READY_TIMEOUT_MS) {
        return this.emitUnavailable("video-not-ready");
      }
      this.scheduleFromDeadline(now);
      return;
    }
    this.videoUnavailableSince = null;
    const capturedAt = sampleStartedAt;
    const epoch = this.modeEpoch;
    const rotation = this.resolveVideoRotation(video);
    this.inferencePending = true;
    this.inferenceEpoch = epoch;
    let awaitingWorkerResult = false;
    try {
      if (this.worker) {
        const bitmap = await this.bitmapFactory(video);
        if (!bitmap) throw new Error("bitmap-unavailable");
        if (!this.isEpochActive(epoch) || this.suspended) { bitmap.close?.(); return; }
        try {
          this.worker.postMessage({ type: "detect", bitmap, capturedAt, modeEpoch: epoch, rotation }, [bitmap]);
          awaitingWorkerResult = true;
        }
        catch (error) { bitmap.close?.(); throw error; }
      } else if (this.landmarker) {
        const result = this.landmarker.detectForVideo(video, capturedAt);
        this.handleResult({ type: "result", result, capturedAt, modeEpoch: this.modeEpoch, rotation });
      }
    } catch (error) {
      if (this.worker) await this.fallbackToMainThread(error?.message ?? "detect-failed", epoch);
      else this.emitUnavailable(error?.message ?? "detect-failed");
    } finally {
      if (!awaitingWorkerResult) this.finishInference(epoch);
    }
  }

  handleWorkerMessage(data) {
    if (!data) return;
    if (data.type === "ready") {
      if (this.isEpochActive(data.modeEpoch)) {
        this.workerReadyEpoch = data.modeEpoch;
        if (!this.suspended) {
          this.emitState("calibrating");
          this.resetSampleDeadline();
          this.schedule(0);
        }
      }
      return;
    }
    if (!this.isEpochActive(data.modeEpoch) || this.suspended) {
      this.finishInference(data.modeEpoch);
      return;
    }
    if (data.type === "unavailable" || data.type === "error") {
      this.inferencePending = false;
      this.inferenceEpoch = null;
      void this.fallbackToMainThread(data.reason ?? "worker-error", data.modeEpoch);
      return;
    }
    if (data.type === "result") this.handleResult(data);
    this.finishInference(data.modeEpoch);
  }

  resolveVideoRotation(video = this.getVideo()) {
    try {
      return resolveCameraRotation({
        videoWidth: video?.videoWidth,
        videoHeight: video?.videoHeight,
        trackRotation: trackRotation(video),
        screenAngle: cardinalRotation(this.getScreenOrientation?.() ?? 0),
      });
    } catch {
      return 0;
    }
  }

  handleResult({ result, capturedAt, rotation: capturedRotation }) {
    const candidate = selectPhysicalLeftCandidate(result, this.previous, this.inputMirrored);
    if (!candidate) { this.emitLostIfDue(capturedAt); return; }
    const rawHandedness = canonicalLeftCategory(
      result.handedness?.[candidate.index]?.[0],
      this.inputMirrored,
    );
    const rotation = [0, 90, 180, 270].includes(capturedRotation)
      ? capturedRotation
      : this.resolveVideoRotation();
    if (this.currentRotation !== null && this.currentRotation !== rotation) {
      this.previous = null;
      this.reachState = createReachState();
      this.calibration = null;
    }
    this.currentRotation = rotation;
    const rawLandmarks = result.landmarks[candidate.index];
    const rawWorldLandmarks = result.worldLandmarks?.[candidate.index];
    const sample = {
      landmarks: normalizeCameraLandmarks(rawLandmarks, rotation),
      worldLandmarks: rawWorldLandmarks
        ? normalizeCameraWorldLandmarks(rawWorldLandmarks, rotation)
        : normalizeCameraLandmarks(rawLandmarks, rotation),
      handedness: rawHandedness,
      capturedAt,
      inputMirrored: this.inputMirrored,
    };
    try {
      const pose = deriveHandFeatures(sample, this.previous, this.calibration);
      const reach = updateReachState(this.reachState, pose, capturedAt);
      this.reachState = reach.state;
      if (reach.entered && !this.calibration && pose.palmSpan > 0) {
        this.calibration = { palmSpan: pose.palmSpan };
      }
      const frame = createTrackedHandFrame({
        seq: this.seq++, capturedAt, modeEpoch: this.modeEpoch, sample, previous: this.previous,
        calibration: this.calibration, pose, reach,
      });
      this.previous = frame;
      this.lastResultAt = capturedAt;
      this.lastLostAt = -Infinity;
      this.consecutiveMisses = 0;
      this.emitState("tracked");
      this.onFrame?.(frame);
      this.clearStatusTimer();
    } catch { this.emitLostIfDue(capturedAt); }
  }

  emitLostIfDue(now) {
    if (this.lastState === "lost") return;
    this.consecutiveMisses += 1;
    if (this.consecutiveMisses < LOST_AFTER_CONSECUTIVE_MISSES) return;
    this.emitStatusFrame("lost", "no-hand", now);
    this.reachState = createReachState();
    this.calibration = null;
    this.previous = null;
    this.lastLostAt = now;
    this.clearStatusTimer();
  }

  emitStatusFrame(state, reason, capturedAt) {
    this.emitState(state);
    this.onFrame?.(createHandStatusFrame({ seq: this.seq++, capturedAt, modeEpoch: this.modeEpoch, state, reason }));
  }

  emitUnavailable(reason) {
    if (this.unavailableEpoch === this.modeEpoch) return;
    this.unavailableEpoch = this.modeEpoch;
    this.active = false;
    this.emitState("fallback");
    this.onFrame?.(createHandStatusFrame({ seq: this.seq++, capturedAt: this.scheduler.now(), modeEpoch: this.modeEpoch, state: "unavailable", reason }));
    this.clearTimers();
  }

  emitState(state) { this.lastState = state; this.onState?.(state); }

  clearStatusTimer() { if (this.statusTimer != null) this.scheduler.clearTimeout(this.statusTimer); this.statusTimer = null; }
  clearTimers() {
    if (this.timer != null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    if (this.videoFrameCallbackId != null) this.getVideo()?.cancelVideoFrameCallback?.(this.videoFrameCallbackId);
    this.videoFrameCallbackId = null;
    this.clearStatusTimer();
  }
  suspend() { this.suspended = true; this.videoUnavailableSince = null; this.clearTimers(); }
  resume() {
    this.suspended = false;
    this.videoUnavailableSince = null;
    this.consecutiveMisses = 0;
    if (this.active) {
      this.resetSampleDeadline();
      this.schedule(0);
    }
  }
  destroy() { this.destroyed = true; this.active = false; this.clearTimers(); this.closeLandmarker(); this.disableWorker(); }
}
