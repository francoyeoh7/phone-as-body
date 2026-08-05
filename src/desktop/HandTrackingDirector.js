import { FirstPersonHand } from "./FirstPersonHand.js";
import { HandPoseStream } from "./HandPoseStream.js";
import { HandTaskStateMachine } from "../shared/hand-task-state.js";

const NO_FRAME_FALLBACK_MS = 1500;

export class HandTrackingDirector {
  constructor(options = {}) {
    this.hand = options.hand ?? new FirstPersonHand({ camera: options.camera });
    this.sendControllerEvent = typeof options.sendControllerEvent === "function" ? options.sendControllerEvent : () => {};
    this.now = typeof options.now === "function" ? options.now : () => performance.now();
    this.stream = options.stream ?? new HandPoseStream();
    this.machine = options.machine ?? new HandTaskStateMachine();
    this.owner = null;
    this.startedAt = 0;
    this.lastAcceptedAt = null;
    this.silenceElapsed = 0;
    this.lastSample = null;
    this.fallback = false;
    this.destroyed = false;
    this.paused = false;
  }

  beginTask({ context, requiredAction } = {}) {
    if (this.destroyed || this.paused || !context || (this.owner && this.owner !== context)) return false;
    if (this.owner === context) return true;
    this.owner = context;
    this.startedAt = this.now();
    this.lastAcceptedAt = null;
    this.silenceElapsed = 0;
    this.lastSample = null;
    this.fallback = Boolean(this.hand?.fallback || this.hand?.loaded === false && this.hand?.error);
    this.stream.reset();
    this.machine.begin({ context, requiredAction, now: this.startedAt });
    this.hand?.setContext?.(context);
    this.hand?.setVisible?.(!this.fallback);
    this.sendControllerEvent({ type: "hand-task", active: true, context });
    return true;
  }

  endTask(context) {
    if (!this.owner || (context && context !== this.owner)) return false;
    const activeContext = this.owner;
    this.owner = null;
    this.fallback = false;
    this.lastAcceptedAt = null;
    this.silenceElapsed = 0;
    this.lastSample = null;
    this.stream.reset();
    this.machine.reset();
    this.hand?.setVisible?.(false);
    this.hand?.setContext?.(null);
    this.sendControllerEvent({ type: "hand-task", active: false, context: activeContext });
    return true;
  }

  acceptFrame(frame) {
    if (this.destroyed || this.paused || !this.owner || !frame) return false;
    const receivedAt = Number.isFinite(frame.receivedAt) ? frame.receivedAt : this.now();
    const accepted = this.stream.accept({ ...frame, receivedAt });
    if (accepted) {
      this.lastAcceptedAt = receivedAt;
      this.silenceElapsed = 0;
    }
    return accepted;
  }

  update(delta = 0) {
    if (this.destroyed || this.paused || !this.owner) return null;
    const now = this.now();
    const seconds = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    this.silenceElapsed += seconds * 1000;
    const silenceSinceAccepted = this.lastAcceptedAt === null
      ? now - this.startedAt
      : now - this.lastAcceptedAt;
    if (!this.fallback && (this.hand?.fallback
      || this.silenceElapsed >= NO_FRAME_FALLBACK_MS
      || silenceSinceAccepted >= NO_FRAME_FALLBACK_MS)) {
      this.fallback = true;
      this.lastSample = null;
      this.hand?.setVisible?.(false);
    }
    if (this.fallback) return this.snapshot(this.owner);
    const sample = this.stream.sample(now);
    this.lastSample = sample;
    if (sample?.state === "unavailable") {
      this.fallback = true;
      this.hand?.setVisible?.(false);
      return this.snapshot(this.owner);
    }
    const state = this.machine.update(sample ?? { state: "lost", fresh: false }, now);
    if (sample?.pose) this.hand?.applyPose?.({ ...sample.pose, state: sample.state, opacity: sample.opacity }, delta);
    return { ...state, sample, fresh: sample?.fresh === true };
  }

  snapshot(context) {
    if (!this.owner || (context && context !== this.owner)) return null;
    const sample = this.lastSample;
    return {
      ...this.machine.snapshot(),
      context: this.owner,
      fallback: this.fallback,
      unavailable: this.fallback,
      sample,
      fresh: sample?.fresh === true,
    };
  }

  usesFallback(context) {
    return Boolean(this.owner && (!context || context === this.owner) && this.fallback);
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    return this;
  }

  async load() {
    try {
      const loaded = await this.hand?.load?.();
      if (loaded === false) this.fallback = true;
      return loaded !== false;
    } catch {
      this.fallback = true;
      return false;
    }
  }

  destroy() {
    if (this.destroyed) return;
    if (this.owner) this.endTask(this.owner);
    this.destroyed = true;
    this.hand?.destroy?.();
    this.owner = null;
  }
}
