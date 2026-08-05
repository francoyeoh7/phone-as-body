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
    const score = labelBonus * 2 - distance;
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
    this.initializing = false;
    this.landmarker = null;
    this.timer = null;
    this.statusTimer = null;
    this.lastResultAt = -Infinity;
    this.lastState = null;
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

  async setTask(task = {}) {
    this.modeEpoch += 1;
    const epoch = this.modeEpoch;
    this.clearTimers();
    this.active = Boolean(task.active);
    this.previous = null;
    this.lastResultAt = this.scheduler.now();
    this.inferencePending = false;
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
    try {
      const module = await this.loadModule();
      if (epoch !== this.modeEpoch || !this.active) return;
      const fileset = await module.FilesetResolver.forVisionTasks("/assets/mediapipe/wasm");
      const create = this.landmarkerFactory ?? module.HandLandmarker.createFromOptions.bind(module.HandLandmarker);
      this.landmarker = await create(fileset, {
        baseOptions: { modelAssetPath: "/assets/mediapipe/hand_landmarker.task" },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.62, minHandPresenceConfidence: 0.58, minTrackingConfidence: 0.58,
      });
      this.emitState("calibrating");
      this.schedule(0);
    } catch (error) {
      this.emitUnavailable(error?.message ?? "init-failed");
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
    this.inferencePending = true;
    let awaitingWorkerResult = false;
    try {
      if (this.worker) {
        const bitmap = await this.bitmapFactory(video);
        if (!bitmap) throw new Error("bitmap-unavailable");
        if (!this.active || this.modeEpoch < 1) { bitmap.close?.(); return; }
        try {
          this.worker.postMessage({ type: "detect", bitmap, capturedAt, modeEpoch: this.modeEpoch }, [bitmap]);
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
      if (!awaitingWorkerResult) {
        this.inferencePending = false;
        this.schedule();
      }
    }
  }

  handleWorkerMessage(data) {
    if (!data || data.modeEpoch !== this.modeEpoch || !this.active) return;
    if (data.type === "ready") { this.emitState("calibrating"); this.schedule(0); return; }
    if (data.type === "unavailable") { this.emitUnavailable(data.reason); return; }
    if (data.type === "result") this.handleResult(data);
    this.inferencePending = false;
    this.schedule();
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
      this.emitState("tracked");
      this.onFrame?.(frame);
      this.clearStatusTimer();
      this.scheduleStatus();
    } catch { this.emitLostIfDue(capturedAt); }
  }

  emitLostIfDue(now) {
    if (now - this.lastResultAt < LOST_AFTER_MS) { this.scheduleStatus(); return; }
    this.emitStatusFrame("lost", "no-hand", now);
    this.scheduleStatus();
  }

  scheduleStatus() {
    this.clearStatusTimer();
    this.statusTimer = this.scheduler.setTimeout(() => {
      if (!this.active || this.suspended || this.destroyed) return;
      const now = this.scheduler.now();
      if (now - this.lastResultAt >= LOST_AFTER_MS) this.emitStatusFrame("lost", "no-hand", now);
      this.scheduleStatus();
    }, this.lastState === "lost" ? STATUS_HEARTBEAT_MS : LOST_AFTER_MS);
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
  destroy() { this.destroyed = true; this.active = false; this.clearTimers(); this.landmarker?.close?.(); this.landmarker = null; this.worker?.terminate?.(); this.worker = null; }
}
