const PHONE_ID = "found-phone";
const PRESENCE_READY_TIMEOUT_SECONDS = 3;

export class FoundPhoneDirector {
  constructor({ experience, player, audio, sendControllerEvent, handTracking = null }) {
    this.foundPhone = experience?.objects?.foundPhone;
    this.player = player;
    this.audio = audio;
    this.sendControllerEvent = typeof sendControllerEvent === "function" ? sendControllerEvent : () => {};
    this.handTracking = handTracking;
    this.inspecting = false;
    this.presencePending = false;
    this.presenceWaitElapsed = 0;
    this.destroyed = false;
    this.heldConfirmed = false;
    this.handFallbackActivated = false;
  }

  handleInteraction(id) {
    if (
      id !== PHONE_ID ||
      this.destroyed ||
      this.inspecting ||
      !this.foundPhone?.enabled ||
      typeof this.foundPhone.setHeld !== "function"
    ) return false;

    const hasHandCoordinator = typeof this.handTracking?.beginTask === "function";
    if (hasHandCoordinator
      && !this.handTracking.beginTask({ context: PHONE_ID, requiredAction: "grab" })) return false;

    this.inspecting = true;
    this.presencePending = true;
    this.presenceWaitElapsed = 0;
    this.player.beginCinematic();
    this.heldConfirmed = false;
    this.handFallbackActivated = false;
    if (!hasHandCoordinator || this.handTracking?.usesFallback?.(PHONE_ID)) this.activateFallback();
    return true;
  }

  activateFallback() {
    if (this.handFallbackActivated || !this.inspecting) return;
    this.handFallbackActivated = true;
    this.foundPhone.setHeld(true);
    this.heldConfirmed = true;
    this.audio.cue("phone-pickup");
    this.sendControllerEvent({ type: "gesture-mode", mode: "presence", context: PHONE_ID, baseline: "retained" });
    this.sendControllerEvent({ type: "found-phone-ui", active: true });
  }

  handlePresence(event) {
    if (this.handTracking && !this.handTracking.usesFallback(PHONE_ID)) return false;
    if (
      !this.inspecting ||
      event?.context !== PHONE_ID ||
      event.ready !== true
    ) return false;

    this.presencePending = false;
    if (event.active !== false) return false;
    return this.release();
  }

  update(delta) {
    if (!this.inspecting) return;
    if (this.handTracking?.usesFallback?.(PHONE_ID)) this.activateFallback();
    if (this.handTracking && !this.handTracking.usesFallback(PHONE_ID)) {
      const state = this.handTracking.snapshot(PHONE_ID);
      if (state?.phase === "held" && !this.heldConfirmed) {
        this.heldConfirmed = true;
        this.presencePending = false;
        this.foundPhone.setHeld(true);
        this.audio.cue("phone-pickup");
        this.sendControllerEvent({ type: "found-phone-ui", active: true });
      } else if (state?.phase === "success" && this.heldConfirmed) {
        this.release();
      }
      return;
    }
    if (!this.presencePending) return;
    const seconds = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    this.presenceWaitElapsed += seconds;
    if (this.presenceWaitElapsed >= PRESENCE_READY_TIMEOUT_SECONDS) this.release();
  }

  isInspecting() {
    return this.inspecting;
  }

  release() {
    if (!this.inspecting) return false;

    this.inspecting = false;
    this.presencePending = false;
    this.presenceWaitElapsed = 0;
    this.foundPhone?.setHeld?.(false);
    this.handTracking?.endTask?.(PHONE_ID);
    this.player.endCinematic();
    this.sendControllerEvent({ type: "found-phone-ui", active: false });
    this.sendControllerEvent({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
    this.audio.cue("phone-release");
    return true;
  }

  destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    if (this.inspecting) {
      this.release();
      return;
    }

    this.foundPhone?.setHeld?.(false);
    this.handTracking?.endTask?.(PHONE_ID);
    this.sendControllerEvent({ type: "found-phone-ui", active: false });
    this.sendControllerEvent({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
  }
}
