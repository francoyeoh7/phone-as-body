const PHONE_ID = "found-phone";
const PICKUP_COOLDOWN_SECONDS = 3;

export class FoundPhoneDirector {
  constructor({ experience, player, audio, sendControllerEvent, handTracking = null }) {
    this.foundPhone = experience?.objects?.foundPhone;
    this.player = player;
    this.audio = audio;
    this.sendControllerEvent = typeof sendControllerEvent === "function" ? sendControllerEvent : () => {};
    this.handTracking = handTracking;
    this.inspecting = false;
    this.heldConfirmed = false;
    this.cooldownRemaining = 0;
    this.destroyed = false;
  }

  handleInteraction(id, details = {}) {
    if (
      id !== PHONE_ID
      || details.source !== "hand"
      || this.destroyed
      || this.inspecting
      || this.cooldownRemaining > 0
      || !this.foundPhone?.enabled
      || typeof this.foundPhone.setHeld !== "function"
      || typeof this.handTracking?.beginTask !== "function"
    ) return false;

    if (!this.handTracking.beginTask({ context: PHONE_ID, requiredAction: "grab", preCalibrated: true })) return false;
    this.inspecting = true;
    this.heldConfirmed = false;
    this.player.beginCinematic();
    return true;
  }

  handlePresence() {
    return false;
  }

  update(delta) {
    const seconds = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    if (!this.inspecting) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - seconds);
      return;
    }
    const state = this.handTracking?.snapshot?.(PHONE_ID);
    if (state?.phase === "held") {
      this.confirmHeld();
      return;
    }
    if (["success", "unstable", "failed"].includes(state?.phase)) this.release(true);
  }

  confirmHeld() {
    if (this.heldConfirmed) return;
    this.heldConfirmed = true;
    this.foundPhone.setHeld(true);
    this.audio.cue("phone-pickup");
    this.sendControllerEvent({ type: "found-phone-ui", active: true });
  }

  isInspecting() {
    return this.inspecting;
  }

  release(startCooldown = true) {
    if (!this.inspecting) return false;
    this.inspecting = false;
    this.heldConfirmed = false;
    if (startCooldown) this.cooldownRemaining = PICKUP_COOLDOWN_SECONDS;
    this.foundPhone?.setHeld?.(false);
    this.handTracking?.endTask?.(PHONE_ID);
    this.player.endCinematic();
    this.sendControllerEvent({ type: "found-phone-ui", active: false });
    this.audio.cue("phone-release");
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.inspecting) this.release(false);
    else {
      this.foundPhone?.setHeld?.(false);
      this.sendControllerEvent({ type: "found-phone-ui", active: false });
    }
  }
}
