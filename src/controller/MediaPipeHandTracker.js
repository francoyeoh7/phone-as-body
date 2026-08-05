import {
  createTrackedHandFrame,
  createHandStatusFrame,
  normalizeMediaPipeHandedness,
} from "../shared/hand-pose.js";

const SAMPLE_INTERVAL_MS = 1000 / 15;
const LOST_AFTER_MS = 250;
const STATUS_HEARTBEAT_MS = 500;

const defaultScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
};

function frontFacing(video) {
  return video?.srcObject?.getTracks?.()?.some((track) => track?.getSettings?.()?.facingMode === "user");
}

function pickCandidate(result, previous) {
  const landmarks = result?.landmarks ?? [];
  if (!landmarks.length) return null;
  let best = null;
  let bestScore = -Infinity;
  landmarks.forEach((points, index) => {
    const category = result?.handedness?.[index]?.[0];
    const label = normalizeMediaPipeHandedness(category?.categoryName, false);
    if (!label) return;
    const center = points?.[0] ? [points[0].x, points[0].y, points[0].z ?? 0] : [0, 0, 0];
    const prior = previous?.center;
    const distance = prior ? Math.hypot(center[0] - prior[0], center[1] - prior[1]) : 0;
    const labelBonus = previous?.handedness === label ? 1 : 0;
    const confidence = Number.isFinite(category?.score) ? category.score : 0;
    const score = previous ? labelBonus * 2 - distance + confidence * 0.01 : confidence;
    if (score > bestScore) {
      bestScore = score;
      best = { index, label };
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
    Worker: WorkerCtor = globalThis.Worker,
    loadModule = () => import("@mediapipe/tasks-vision"),
    landmarkerFactory = null,
    sampleIntervalMs = SAMPLE_INTERVAL_MS,
  } = {}) {
    this.getVideo = getVideo;
    this.onFrame = onFrame;
    this.onState = onState;
    this.scheduler = { ...defaultScheduler, ...scheduler };
    this.workerFactory = workerFactory;
    this.worker = worker ?? null;
    this.bitmapFactory = bitmapFactory;
    this.OffscreenCanvas = OffscreenCanvasCtor;
    this.Worker = WorkerCtor;
    this.loadModule = loadModule;
    this.landmarkerFactory = landmarkerFactory;
    this.sampleIntervalMs = sampleIntervalMs;
    this.modeEpoch = 0;
    this.seq = 0;
    this.active = false;
    this.destroyed = false;
    this.suspended = false;
    this.inferencePending = false;
    this.inferenceEpoch = null;
    this.initializing = false;
    this.landmarker = null;
    this.timer = null;
    this.statusTimer = null;
    this.lastResultAt = -Infinity;
    this.lastState = null;
    this.lastLostAt = -Infinity;
    this.previous = null;
    this.unavailableEpoch = null;
    if (this.worker) this.bindWorker(this.worker);
  }

  bindWorker(worker) {
    worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    worker.onerror = () => this.emitUnavailable("worker-error");
  }

  canUseWorker() {
    return Boolean(this.workerFactory || (this.Worker && this.bitmapFactory && this.OffscreenCanvas));
  }

  createWorker() {
    if (this.worker) return this.worker;
    if (this.workerFactory) this.worker = this.workerFactory();
    else this.worker = new this.Worker(new URL("./hand-tracking.worker.js", import.meta.url), { type: "module" });
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

  finishInference(epoch) {
    if (this.inferenceEpoch !== epoch) return;
    this.inferencePending = false;
    this.inferenceEpoch = null;
    this.schedule();
  }

  async setTask(task = {}) {
    if (this.destroyed) return;
    this.modeEpoch += 1;
    const epoch = this.modeEpoch;
    this.clearTimers();
    this.closeLandmarker();
    this.active = Boolean(task.active);
    this.previous = null;
    this.lastResultAt = this.scheduler.now();
    this.lastLostAt = -Infinity;
    this.unavailableEpoch = null;
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
        this.emitUnavailable(error?.message ?? "worker-init-failed");
      }
      return;
    }
    this.initializing = true;
    try {
      const module = await this.loadModule();
      if (!this.isEpochActive(epoch)) return;
      const fileset = await module.FilesetResolver.forVisionTasks("/assets/mediapipe/wasm");
      if (!this.isEpochActive(epoch)) return;
      const create = this.landmarkerFactory ?? module.HandLandmarker.createFromOptions.bind(module.HandLandmarker);
      const landmarker = await create(fileset, {
        baseOptions: { modelAssetPath: "/assets/mediapipe/hand_landmarker.task" },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.62, minHandPresenceConfidence: 0.58, minTrackingConfidence: 0.58,
      });
      if (!this.isEpochActive(epoch)) {
        landmarker?.close?.();
        return;
      }
      this.landmarker = landmarker;
      this.emitState("calibrating");
      this.schedule(0);
    } catch (error) {
      if (this.isEpochActive(epoch)) this.emitUnavailable(error?.message ?? "init-failed");
    } finally {
      if (this.modeEpoch === epoch) this.initializing = false;
    }
  }

  schedule(delay = this.sampleIntervalMs) {
    if (!this.active || this.suspended || this.destroyed) return;
    this.timer = this.scheduler.setTimeout(() => { this.timer = null; this.sample(); }, delay);
  }

  async sample() {
    if (!this.active || this.suspended || this.destroyed || this.inferencePending) return;
    const video = this.getVideo();
    if (!video || frontFacing(video) || video.readyState < 2) { this.schedule(); return; }
    const capturedAt = this.scheduler.now();
    const epoch = this.modeEpoch;
    this.inferencePending = true;
    this.inferenceEpoch = epoch;
    let awaitingWorkerResult = false;
    try {
      if (this.worker) {
        const bitmap = await this.bitmapFactory(video);
        if (!bitmap) throw new Error("bitmap-unavailable");
        if (!this.isEpochActive(epoch) || this.suspended) { bitmap.close?.(); return; }
        try {
          this.worker.postMessage({ type: "detect", bitmap, capturedAt, modeEpoch: epoch }, [bitmap]);
          awaitingWorkerResult = true;
        }
        catch (error) { bitmap.close?.(); throw error; }
      } else if (this.landmarker) {
        const result = this.landmarker.detectForVideo(video, capturedAt);
        this.handleResult({ type: "result", result, capturedAt, modeEpoch: this.modeEpoch });
      }
    } catch (error) {
      this.emitUnavailable(error?.message ?? "detect-failed");
    } finally {
      if (!awaitingWorkerResult) this.finishInference(epoch);
    }
  }

  handleWorkerMessage(data) {
    if (!data) return;
    if (data.type === "ready") {
      if (this.isEpochActive(data.modeEpoch) && !this.suspended) {
        this.emitState("calibrating");
        this.schedule(0);
      }
      return;
    }
    if (!this.isEpochActive(data.modeEpoch) || this.suspended) {
      this.finishInference(data.modeEpoch);
      return;
    }
    if (data.type === "unavailable" || data.type === "error") {
      this.finishInference(data.modeEpoch);
      this.emitUnavailable(data.reason ?? "worker-error");
      return;
    }
    if (data.type === "result") this.handleResult(data);
    this.finishInference(data.modeEpoch);
  }

  handleResult({ result, capturedAt }) {
    const candidate = pickCandidate(result, this.previous);
    if (!candidate) { this.emitLostIfDue(capturedAt); return; }
    const rawHandedness = result.handedness[candidate.index]?.[0];
    const center = result.landmarks[candidate.index]?.[0];
    const nearPrevious = this.previous?.center && center
      && Math.hypot(center.x - this.previous.center[0], center.y - this.previous.center[1]) < 0.15;
    const retainedLabel = nearPrevious && this.previous.handedness !== candidate.label
      ? (this.previous.handedness === "left" ? "Right" : "Left")
      : rawHandedness?.categoryName;
    const sample = {
      landmarks: result.landmarks[candidate.index],
      worldLandmarks: result.worldLandmarks?.[candidate.index] ?? result.landmarks[candidate.index],
      handedness: { ...rawHandedness, categoryName: retainedLabel },
      capturedAt,
      inputMirrored: false,
    };
    try {
      const frame = createTrackedHandFrame({ seq: this.seq++, capturedAt, modeEpoch: this.modeEpoch, sample, previous: this.previous });
      this.previous = frame;
      this.lastResultAt = capturedAt;
      this.lastLostAt = -Infinity;
      this.emitState("tracked");
      this.onFrame?.(frame);
      this.clearStatusTimer();
      this.scheduleStatus();
    } catch { this.emitLostIfDue(capturedAt); }
  }

  emitLostIfDue(now) {
    if (now - this.lastResultAt < LOST_AFTER_MS) { this.scheduleStatus(now); return; }
    if (now - this.lastLostAt < STATUS_HEARTBEAT_MS) { this.scheduleStatus(now); return; }
    this.emitStatusFrame("lost", "no-hand", now);
    this.lastLostAt = now;
    this.scheduleStatus(now);
  }

  scheduleStatus(now = this.scheduler.now()) {
    if (this.statusTimer != null || !this.active || this.suspended || this.destroyed) return;
    const dueAt = Number.isFinite(this.lastLostAt)
      ? this.lastLostAt + STATUS_HEARTBEAT_MS
      : this.lastResultAt + LOST_AFTER_MS;
    this.statusTimer = this.scheduler.setTimeout(() => {
      this.statusTimer = null;
      if (!this.active || this.suspended || this.destroyed) return;
      const heartbeatAt = this.scheduler.now();
      this.emitLostIfDue(heartbeatAt);
      this.scheduleStatus(heartbeatAt);
    }, Math.max(0, dueAt - now));
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
  clearTimers() { if (this.timer != null) this.scheduler.clearTimeout(this.timer); this.timer = null; this.clearStatusTimer(); }
  suspend() { this.suspended = true; this.clearTimers(); }
  resume() { this.suspended = false; if (this.active) this.schedule(0); }
  destroy() { this.destroyed = true; this.active = false; this.clearTimers(); this.closeLandmarker(); this.worker?.terminate?.(); this.worker = null; }
}
