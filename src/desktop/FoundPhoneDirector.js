const PHONE_ID = "found-phone";

export class FoundPhoneDirector {
  constructor({ experience, player, audio, sendControllerEvent }) {
    this.foundPhone = experience?.objects?.foundPhone;
    this.player = player;
    this.audio = audio;
    this.sendControllerEvent = typeof sendControllerEvent === "function" ? sendControllerEvent : () => {};
    this.inspecting = false;
    this.destroyed = false;
  }

  handleInteraction(id) {
    if (
      id !== PHONE_ID ||
      this.destroyed ||
      this.inspecting ||
      !this.foundPhone?.enabled ||
      typeof this.foundPhone.setHeld !== "function"
    ) return false;

    this.inspecting = true;
    this.player.beginCinematic();
    this.foundPhone.setHeld(true);
    this.audio.cue("phone-pickup");
    this.sendControllerEvent({
      type: "gesture-mode",
      mode: "presence",
      context: PHONE_ID,
      baseline: "retained",
    });
    this.sendControllerEvent({ type: "found-phone-ui", active: true });
    return true;
  }

  handlePresence(event) {
    if (
      !this.inspecting ||
      event?.context !== PHONE_ID ||
      event.ready !== true ||
      event.active !== false
    ) return false;

    return this.release();
  }

  isInspecting() {
    return this.inspecting;
  }

  release() {
    if (!this.inspecting) return false;

    this.inspecting = false;
    this.foundPhone?.setHeld?.(false);
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
    this.sendControllerEvent({ type: "found-phone-ui", active: false });
    this.sendControllerEvent({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
  }
}
