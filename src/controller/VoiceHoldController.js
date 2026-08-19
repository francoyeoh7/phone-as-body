import { MAX_VOICE_CLIP_BYTES, MAX_VOICE_DURATION_MS } from "../shared/protocol.js";
import { PcmVoiceStreamer } from "./PcmVoiceStreamer.js";

const VOICE_DWELL_MS = 180;
const VOICE_SLOP_PX = 28;
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
    Blob = globalThis.Blob,
    ownership,
    isInRegion,
    onActive,
    onPressState,
    onClip,
    pcmStreamerFactory = ({ onFrame }) => new PcmVoiceStreamer({ onFrame }),
    onStreamFrame,
  }) {
    this.clock = clock;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.getUserMedia = getUserMedia;
    this.MediaRecorder = MediaRecorder;
    this.Blob = Blob;
    this.ownership = ownership;
    this.isInRegion = isInRegion;
    this.onActive = onActive;
    this.onPressState = onPressState;
    this.onClip = onClip;
    this.pcmStreamerFactory = pcmStreamerFactory;
    this.onStreamFrame = onStreamFrame;
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
      captureEstablished: false,
      dwellReady: false,
      dwellTimer: null,
      stopTimer: null,
      stream: null,
      recorder: null,
      chunks: [],
      active: false,
      stopping: false,
      discard: false,
      released: false,
      tracksStopped: false,
      finalized: false,
      inactiveNotified: false,
      startedAt: 0,
      durationMs: 0,
      completion: null,
      resolveCompletion: null,
      pcmStreamer: this.pcmStreamerFactory?.({ onFrame: this.onStreamFrame }) ?? null,
      pcmStopRequested: false,
    };
    attempt.completion = new Promise((resolve) => {
      attempt.resolveCompletion = resolve;
    });
    this.attempt = attempt;
    try {
      attempt.captureTarget?.setPointerCapture?.(event.pointerId);
      attempt.captureEstablished = Boolean(attempt.captureTarget?.setPointerCapture);
    } catch {
      // iOS and synthetic browser input can reject pointer capture even for a
      // valid press. Voice ownership still keeps other controls excluded.
      attempt.captureTarget = null;
    }
    this.onPressState?.("pressed");
    attempt.pcmStreamer?.prime?.();
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
    if (!attempt.active && (!this.isInRegion?.(event) || distance > VOICE_SLOP_PX)) {
      this.cancel({ discard: true });
      return false;
    }
    return true;
  }

  pointerLeave(event) {
    consumePointer(event);
    const attempt = this.currentAttempt(event?.pointerId);
    if (!attempt) return false;
    if (attempt.active || attempt.captureTarget?.hasPointerCapture?.(attempt.pointerId) === true) return true;
    this.cancel({ discard: true });
    return true;
  }

  pointerUp(event) {
    consumePointer(event);
    const attempt = this.currentAttempt(event?.pointerId);
    if (!attempt) return Promise.resolve(false);
    const captured = attempt.captureEstablished;
    if (!this.isInRegion?.(event) && !captured) return this.cancel({ discard: true });
    return attempt.active
      ? this.stopRecording(attempt, { discard: false })
      : this.cancel({ discard: true });
  }

  pointerCancel(event) {
    consumePointer(event);
    if (!this.currentAttempt(event?.pointerId)) return Promise.resolve(false);
    return this.cancel({ discard: true });
  }

  pointerCaptureLost(event) {
    consumePointer(event);
    const attempt = this.currentAttempt(event?.pointerId);
    if (!attempt) return false;
    // Some mobile browsers drop pointer capture while the finger is still
    // down. pointerup/pointercancel remain the authoritative end signals.
    return true;
  }

  cancel({ discard = true } = {}) {
    const attempt = this.attempt;
    if (!attempt) return Promise.resolve(false);
    attempt.discard ||= discard;
    if (attempt.active) return this.stopRecording(attempt, { discard });

    attempt.discard = true;
    this.stopPcm(attempt);
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
    if (!attempt
      || attempt.generation !== this.generation
      || attempt.pointerId !== pointerId
      || attempt.stopping) return null;
    if (!this.hasCurrentOwnership(attempt)) {
      this.cancel({ discard: true });
      return null;
    }
    return attempt;
  }

  receiveStream(attempt, stream) {
    if (!this.isCurrent(attempt) || !this.hasCurrentOwnership(attempt)) {
      stopStream(stream);
      if (this.attempt === attempt) {
        attempt.discard = true;
        this.detachAttempt(attempt);
        attempt.resolveCompletion(false);
      }
      return false;
    }
    attempt.stream = stream;
    this.commit(attempt);
    return true;
  }

  rejectAttempt(attempt) {
    if (this.attempt !== attempt) return false;
    return this.failAttempt(attempt);
  }

  commit(attempt) {
    if (!this.isCurrent(attempt)) return false;
    if (!this.hasCurrentOwnership(attempt)) {
      attempt.discard = true;
      this.detachAttempt(attempt);
      this.stopTracks(attempt);
      attempt.resolveCompletion(false);
      return false;
    }
    if (!attempt.dwellReady || !attempt.stream || attempt.active) return false;
    try {
      const recorder = new this.MediaRecorder(attempt.stream);
      attempt.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (data?.size > 0) attempt.chunks.push(data);
      };
      recorder.onstop = () => this.finalizeRecording(attempt);
      recorder.onerror = () => this.stopRecording(attempt, { discard: true });
      recorder.start(RECORDER_TIMESLICE_MS);
      if (attempt.pcmStreamer?.start) {
        Promise.resolve(attempt.pcmStreamer.start(attempt.stream)).catch(() => {});
      }
      attempt.active = true;
      attempt.startedAt = this.clock();
      attempt.stopTimer = this.setTimeout(() => {
        attempt.stopTimer = null;
        this.stopRecording(attempt, { discard: false });
      }, MAX_VOICE_DURATION_MS);
      this.onActive?.(true);
      this.onPressState?.("recording");
      return true;
    } catch {
      return this.failAttempt(attempt);
    }
  }

  stopRecording(attempt, { discard }) {
    attempt.discard ||= discard;
    if (attempt.finalized) return attempt.completion;
    if (attempt.stopping) return attempt.completion;
    attempt.stopping = true;
    attempt.durationMs = Math.min(MAX_VOICE_DURATION_MS, Math.max(1, this.clock() - attempt.startedAt));
    this.releaseAttempt(attempt);
    this.notifyInactive(attempt);
    if (attempt.pcmStreamer && !attempt.pcmStopRequested) {
      attempt.pcmStopRequested = true;
      Promise.resolve(attempt.pcmStreamer.stop?.()).catch(() => {});
    }
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
      const clipBlob = new this.Blob(attempt.chunks, { type: mimeType });
      if (!attempt.discard && clipBlob.size > 0 && clipBlob.size <= MAX_VOICE_CLIP_BYTES) {
        const data = await clipBlob.arrayBuffer();
        if (!attempt.discard && this.isCurrent(attempt) && this.hasCurrentOwnership(attempt)) {
          this.onClip?.({
            version: 1,
            seq: this.clipSequence++,
            durationMs: attempt.durationMs,
            mimeType,
            data,
          });
        }
      }
    } finally {
      this.stopTracks(attempt);
      this.clearAttempt(attempt);
      attempt.resolveCompletion(true);
    }
  }

  detachAttempt(attempt, { notifyIdle = true } = {}) {
    if (!attempt.active && notifyIdle) this.onPressState?.("idle");
    this.releaseAttempt(attempt);
    this.clearAttempt(attempt);
  }

  failAttempt(attempt) {
    attempt.discard = true;
    this.onPressState?.("error");
    this.stopPcm(attempt);
    this.detachAttempt(attempt, { notifyIdle: false });
    this.stopTracks(attempt);
    attempt.resolveCompletion(false);
    const generation = this.generation;
    this.setTimeout(() => {
      if (!this.attempt && this.generation === generation) this.onPressState?.("idle");
    }, 420);
    return false;
  }

  releaseAttempt(attempt) {
    if (attempt.dwellTimer !== null) this.clearTimeout(attempt.dwellTimer);
    if (attempt.stopTimer !== null) this.clearTimeout(attempt.stopTimer);
    attempt.dwellTimer = null;
    attempt.stopTimer = null;
    this.releaseOwnership(attempt);
  }

  clearAttempt(attempt) {
    if (this.attempt === attempt) {
      this.attempt = null;
      this.generation += 1;
    }
  }

  isCurrent(attempt) {
    return this.attempt === attempt && attempt.generation === this.generation;
  }

  hasCurrentOwnership(attempt) {
    return this.ownership?.generation === attempt.ownershipGeneration;
  }

  releaseOwnership(attempt) {
    if (attempt.released) return;
    attempt.released = true;
    this.ownership?.release?.("voice", attempt.pointerId, attempt.ownershipGeneration);
    try {
      if (attempt.captureTarget?.hasPointerCapture?.(attempt.pointerId) !== false) {
        attempt.captureTarget?.releasePointerCapture?.(attempt.pointerId);
      }
    } catch { /* capture was already lost */ }
  }

  notifyInactive(attempt) {
    if (!attempt.active || attempt.inactiveNotified) return;
    attempt.inactiveNotified = true;
    this.onActive?.(false);
    this.onPressState?.("idle");
  }

  stopTracks(attempt) {
    if (!attempt.stream || attempt.tracksStopped) return;
    attempt.tracksStopped = true;
    stopStream(attempt.stream);
  }

  stopPcm(attempt) {
    if (!attempt?.pcmStreamer || attempt.pcmStopRequested) return;
    attempt.pcmStopRequested = true;
    Promise.resolve(attempt.pcmStreamer.stop?.()).catch(() => {});
  }
}
