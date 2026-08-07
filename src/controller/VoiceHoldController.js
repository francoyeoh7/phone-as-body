import { MAX_VOICE_CLIP_BYTES, MAX_VOICE_DURATION_MS } from "../shared/protocol.js";

const VOICE_DWELL_MS = 420;
const VOICE_SLOP_PX = 14;
const RECORDER_TIMESLICE_MS = 250;

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function consumePointer(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

export class VoiceHoldController {
  constructor({
    clock = () => performance.now(),
    setTimeout = (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout = (timer) => window.clearTimeout(timer),
    getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    MediaRecorder = globalThis.MediaRecorder,
    ownership,
    isInRegion,
    onActive,
    onClip,
  }) {
    this.clock = clock;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.getUserMedia = getUserMedia;
    this.MediaRecorder = MediaRecorder;
    this.ownership = ownership;
    this.isInRegion = isInRegion;
    this.onActive = onActive;
    this.onClip = onClip;
    this.attempt = null;
    this.generation = 0;
    this.clipSequence = 0;
    this.pendingPermission = Promise.resolve();
    this.pendingRecording = Promise.resolve();
  }

  pointerDown(event) {
    consumePointer(event);
    if (this.attempt || !this.isInRegion?.(event)) return false;
    if (!this.ownership?.claimVoice?.(event.pointerId)) return false;

    const attempt = {
      generation: ++this.generation,
      ownershipGeneration: this.ownership.generation,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      captureTarget: event.currentTarget ?? null,
      dwellReady: false,
      dwellTimer: null,
      stopTimer: null,
      stream: null,
      recorder: null,
      chunks: [],
      active: false,
      discard: false,
      released: false,
      tracksStopped: false,
      finalized: false,
      inactiveNotified: false,
      startedAt: 0,
      durationMs: 0,
      completion: null,
      resolveCompletion: null,
    };
    attempt.completion = new Promise((resolve) => {
      attempt.resolveCompletion = resolve;
    });
    this.attempt = attempt;
    attempt.captureTarget?.setPointerCapture?.(event.pointerId);
    attempt.dwellTimer = this.setTimeout(() => {
      attempt.dwellTimer = null;
      attempt.dwellReady = true;
      this.commit(attempt);
    }, VOICE_DWELL_MS);

    let permission;
    try {
      permission = this.getUserMedia({ audio: true });
    } catch (error) {
      permission = Promise.reject(error);
    }
    this.pendingPermission = Promise.resolve(permission)
      .then((stream) => this.receiveStream(attempt, stream))
      .catch(() => this.rejectAttempt(attempt));
    return true;
  }

  pointerMove(event) {
    consumePointer(event);
    const attempt = this.currentAttempt(event?.pointerId);
    if (!attempt) return false;
    const distance = Math.hypot(event.clientX - attempt.startX, event.clientY - attempt.startY);
    if (!this.isInRegion?.(event) || (!attempt.active && distance > VOICE_SLOP_PX)) {
      this.cancel({ discard: true });
      return false;
    }
    return true;
  }

  pointerLeave(event) {
    consumePointer(event);
    if (!this.currentAttempt(event?.pointerId)) return false;
    this.cancel({ discard: true });
    return true;
  }

  pointerUp(event) {
    consumePointer(event);
    const attempt = this.currentAttempt(event?.pointerId);
    if (!attempt) return Promise.resolve(false);
    return attempt.active
      ? this.stopRecording(attempt, { discard: false })
      : this.cancel({ discard: true });
  }

  pointerCancel(event) {
    consumePointer(event);
    if (!this.currentAttempt(event?.pointerId)) return Promise.resolve(false);
    return this.cancel({ discard: true });
  }

  cancel({ discard = true } = {}) {
    const attempt = this.attempt;
    if (!attempt) return Promise.resolve(false);
    if (attempt.active) return this.stopRecording(attempt, { discard });

    attempt.discard = true;
    this.detachAttempt(attempt);
    this.stopTracks(attempt);
    attempt.resolveCompletion(false);
    return attempt.completion;
  }

  flushPendingPermission() {
    return this.pendingPermission;
  }

  flushPendingRecording() {
    return this.pendingRecording;
  }

  currentAttempt(pointerId) {
    const attempt = this.attempt;
    return attempt
      && attempt.generation === this.generation
      && attempt.pointerId === pointerId
      ? attempt
      : null;
  }

  receiveStream(attempt, stream) {
    if (this.attempt !== attempt || attempt.generation !== this.generation) {
      stopStream(stream);
      return false;
    }
    attempt.stream = stream;
    this.commit(attempt);
    return true;
  }

  rejectAttempt(attempt) {
    if (this.attempt !== attempt) return false;
    attempt.discard = true;
    this.detachAttempt(attempt);
    attempt.resolveCompletion(false);
    return false;
  }

  commit(attempt) {
    if (this.attempt !== attempt || !attempt.dwellReady || !attempt.stream || attempt.active) return false;
    try {
      const recorder = new this.MediaRecorder(attempt.stream);
      attempt.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (data?.size > 0) attempt.chunks.push(data);
      };
      recorder.onstop = () => this.finalizeRecording(attempt);
      recorder.onerror = () => this.stopRecording(attempt, { discard: true });
      recorder.start(RECORDER_TIMESLICE_MS);
      attempt.active = true;
      attempt.startedAt = this.clock();
      attempt.stopTimer = this.setTimeout(() => {
        attempt.stopTimer = null;
        this.stopRecording(attempt, { discard: false });
      }, MAX_VOICE_DURATION_MS);
      this.onActive?.(true);
      return true;
    } catch {
      attempt.discard = true;
      this.detachAttempt(attempt);
      this.stopTracks(attempt);
      attempt.resolveCompletion(false);
      return false;
    }
  }

  stopRecording(attempt, { discard }) {
    if (attempt.finalized) return attempt.completion;
    attempt.discard ||= discard;
    attempt.durationMs = Math.min(MAX_VOICE_DURATION_MS, Math.max(1, this.clock() - attempt.startedAt));
    this.detachAttempt(attempt);
    this.notifyInactive(attempt);
    this.pendingRecording = attempt.completion;
    try {
      if (attempt.recorder?.state === "inactive") {
        this.finalizeRecording(attempt);
      } else {
        attempt.recorder?.stop();
      }
    } catch {
      attempt.discard = true;
      this.finalizeRecording(attempt);
    }
    return attempt.completion;
  }

  async finalizeRecording(attempt) {
    if (attempt.finalized) return;
    attempt.finalized = true;
    try {
      const mimeType = attempt.recorder?.mimeType || attempt.chunks[0]?.type || "audio/webm";
      const clipBlob = new Blob(attempt.chunks, { type: mimeType });
      if (!attempt.discard && clipBlob.size > 0 && clipBlob.size <= MAX_VOICE_CLIP_BYTES) {
        const data = await clipBlob.arrayBuffer();
        this.onClip?.({
          version: 1,
          seq: this.clipSequence++,
          durationMs: attempt.durationMs,
          mimeType,
          data,
        });
      }
    } finally {
      this.stopTracks(attempt);
      attempt.resolveCompletion(true);
    }
  }

  detachAttempt(attempt) {
    if (attempt.dwellTimer !== null) this.clearTimeout(attempt.dwellTimer);
    if (attempt.stopTimer !== null) this.clearTimeout(attempt.stopTimer);
    attempt.dwellTimer = null;
    attempt.stopTimer = null;
    this.releaseOwnership(attempt);
    if (this.attempt === attempt) {
      this.attempt = null;
      this.generation += 1;
    }
  }

  releaseOwnership(attempt) {
    if (attempt.released) return;
    attempt.released = true;
    this.ownership?.release?.("voice", attempt.pointerId, attempt.ownershipGeneration);
    if (attempt.captureTarget?.hasPointerCapture?.(attempt.pointerId) !== false) {
      attempt.captureTarget?.releasePointerCapture?.(attempt.pointerId);
    }
  }

  notifyInactive(attempt) {
    if (!attempt.active || attempt.inactiveNotified) return;
    attempt.inactiveNotified = true;
    this.onActive?.(false);
  }

  stopTracks(attempt) {
    if (!attempt.stream || attempt.tracksStopped) return;
    attempt.tracksStopped = true;
    stopStream(attempt.stream);
  }
}
