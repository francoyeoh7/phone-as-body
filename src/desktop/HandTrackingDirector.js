import { FirstPersonHand } from "./FirstPersonHand.js";
import { HandPoseStream } from "./HandPoseStream.js";
import { HandGestureGate } from "./HandGestureGate.js";
import { HeldEquipmentGate } from "./HeldEquipmentGate.js";
import { HandTaskStateMachine } from "../shared/hand-task-state.js";

const finitePoint = (value) => {
  const point = Array.isArray(value)
    ? value.slice(0, 3)
    : [value?.x, value?.y, value?.z];
  return point.length === 3 && point.every(Number.isFinite) ? point : null;
};

export class HandTrackingDirector {
  constructor(options = {}) {
    this.hand = options.hand ?? new FirstPersonHand({ camera: options.camera });
    this.sendControllerEvent = typeof options.sendControllerEvent === "function" ? options.sendControllerEvent : () => {};
    this.now = typeof options.now === "function" ? options.now : () => performance.now();
    this.stream = options.stream ?? new HandPoseStream();
    this.machine = options.machine ?? new HandTaskStateMachine();
    this.gestureGate = options.gestureGate ?? new HandGestureGate();
    this.equipmentGate = options.equipmentGate ?? new HeldEquipmentGate();
    this.getEquippedId = typeof options.getEquippedId === "function" ? options.getEquippedId : () => null;
    this.canPresentEquipment = typeof options.canPresentEquipment === "function" ? options.canPresentEquipment : () => true;
    this.onGesture = typeof options.onGesture === "function" ? options.onGesture : () => {};
    this.owner = null;
    this.lastAcceptedAt = null;
    this.lastSample = null;
    this.fallback = false;
    this.destroyed = false;
    this.paused = false;
    this.target = null;
    this.targetEpoch = 0;
  }

  setTarget(target = null) {
    const hadTarget = this.target !== null;
    const nextId = target?.id ?? null;
    const idChanged = (this.target?.id ?? null) !== nextId;
    let epoch = null;
    if (nextId) {
      epoch = Number.isInteger(target?.epoch) && target.epoch >= 0
        ? target.epoch
        : idChanged ? this.targetEpoch + 1 : this.target?.epoch ?? this.targetEpoch;
    }
    const next = nextId ? {
      id: nextId,
      epoch,
      contactPoint: finitePoint(target.contactPoint),
      contactNormal: finitePoint(target.contactNormal),
      focusedAt: Number.isFinite(target.focusedAt) ? target.focusedAt : null,
    } : null;
    const changed = idChanged || (this.target?.epoch ?? null) !== (next?.epoch ?? null);
    if (next) this.targetEpoch = next.epoch;
    else if (hadTarget) this.targetEpoch += 1;
    this.target = next;
    this.publishTargetContact(false);
    if (changed) this.gestureGate.reset({ requireRelease: hadTarget });
    if (next) this.suppressEquipment();
    return this.target;
  }

  publishTargetContact(engaged = false) {
    this.hand?.setTargetContact?.(this.target ? {
      point: this.target.contactPoint,
      normal: this.target.contactNormal,
      epoch: this.target.epoch,
      engaged: engaged === true,
    } : null);
  }

  beginTask({ context, requiredAction, preCalibrated = false, skipCalibration = false } = {}) {
    if (this.destroyed || this.paused || !context || (this.owner && this.owner !== context)) return false;
    if (this.owner === context) return true;
    this.owner = context;
    this.fallback = Boolean(this.hand?.fallback || this.lastSample?.state === "unavailable");
    this.machine.begin({ context, requiredAction, preCalibrated, skipCalibration, now: this.now() });
    this.gestureGate.reset({ requireRelease: true });
    this.suppressEquipment();
    this.hand?.setContext?.(context);
    this.hand?.setVisible?.(!this.fallback);
    this.sendControllerEvent({ type: "hand-task", active: true, context });
    return true;
  }

  endTask(context) {
    if (!this.owner || (context && context !== this.owner)) return false;
    const activeContext = this.owner;
    this.owner = null;
    this.machine.reset();
    this.gestureGate.reset({ requireRelease: true });
    this.suppressEquipment();
    this.publishTargetContact(false);
    this.hand?.setVisible?.(!this.hand?.fallback);
    this.hand?.setContext?.(null);
    this.sendControllerEvent({ type: "hand-task", active: false, context: activeContext });
    return true;
  }

  acceptFrame(frame) {
    if (this.destroyed || this.paused || !frame) return false;
    const receivedAt = Number.isFinite(frame.receivedAt) ? frame.receivedAt : this.now();
    const accepted = this.stream.accept({ ...frame, receivedAt });
    if (accepted) {
      this.lastAcceptedAt = receivedAt;
      if (frame.state === "tracked" && frame.trackingConfidence >= 0.62) {
        this.fallback = false;
        this.hand?.setVisible?.(!this.hand?.fallback);
      }
    }
    return accepted;
  }

  update(delta = 0) {
    if (this.destroyed || this.paused) return null;
    const now = this.now();
    const sample = this.stream.sample(now);
    this.lastSample = sample;
    if (this.hand?.fallback || sample?.state === "unavailable") {
      this.fallback = true;
    } else if (sample?.state === "tracked" && sample.fresh) {
      this.fallback = false;
      this.hand?.setVisible?.(true);
    }
    if (sample?.pose) {
      this.hand?.applyPose?.({ ...sample.pose, state: sample.state, opacity: sample.opacity }, delta);
    } else if (sample?.state === "lost" || sample?.state === "unavailable") {
      this.hand?.applyPose?.({ state: sample.state, opacity: 0 }, delta);
    }
    if (!this.owner) {
      if (!this.target?.id) {
        const equippedId = this.getEquippedId();
        if (!equippedId || !this.canPresentEquipment()) {
          this.suppressEquipment();
          return sample ? { sample, fallback: this.fallback } : null;
        }
        const equipmentAction = this.equipmentGate.update(sample, now);
        if (equipmentAction === "grab") this.hand?.setHolding?.(true);
        if (equipmentAction === "release") this.hand?.setHolding?.(false);
        return sample ? { sample, fallback: this.fallback, equipmentAction, equippedId } : null;
      }
      const triggered = this.gestureGate.update(sample, now, this.target);
      this.publishTargetContact(this.gestureGate.isContactCandidate?.(this.target.epoch) === true);
      if (triggered) {
        this.onGesture({
          type: "grab",
          at: now,
          pose: sample?.gesturePose ?? sample?.pose ?? null,
          targetId: this.target.id,
          targetEpoch: this.target.epoch,
        });
      }
      return sample ? { sample, fallback: this.fallback } : null;
    }
    const state = this.machine.update(sample ?? { state: "lost", fresh: false }, now);
    this.publishTargetContact(["candidate", "confirmed", "held"].includes(state.phase));
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
      target: this.target,
    };
  }

  usesFallback(context) {
    return Boolean(this.owner && (!context || context === this.owner) && this.fallback);
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.suppressEquipment();
    return this;
  }

  suppressEquipment() {
    this.equipmentGate?.suppressUntilRelease?.();
    this.hand?.setHolding?.(false);
  }

  async load({ signal } = {}) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    try {
      const loaded = await this.hand?.load?.({ signal });
      if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      if (this.destroyed) {
        this.hand?.destroy?.();
        return false;
      }
      if (loaded === false) this.fallback = true;
      else this.hand?.setVisible?.(true);
      return loaded !== false;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      this.fallback = true;
      return false;
    }
  }

  destroy() {
    if (this.destroyed) return;
    if (this.owner) this.endTask(this.owner);
    this.destroyed = true;
    this.suppressEquipment();
    this.hand?.destroy?.();
    this.owner = null;
  }
}
