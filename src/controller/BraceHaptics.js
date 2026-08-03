const BRACE_PATTERN = [55, 35, 90];
const REPEAT_MS = 220;

export class BraceHaptics {
  constructor({
    vibrate = globalThis.navigator?.vibrate?.bind(globalThis.navigator),
    onFallbackPulse,
    setTimer = globalThis.setInterval,
    clearTimer = globalThis.clearInterval,
  } = {}) {
    this.vibrate = vibrate;
    this.onFallbackPulse = onFallbackPulse;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
  }

  pulse() {
    if (this.vibrate?.(BRACE_PATTERN) !== true) this.onFallbackPulse?.();
  }

  start() {
    if (this.timer !== null) return;
    this.pulse();
    this.timer = this.setTimer(() => this.pulse(), REPEAT_MS);
  }

  stop() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.vibrate?.(0);
  }
}
