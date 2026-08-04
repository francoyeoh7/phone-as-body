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
    let vibrated = false;
    try {
      vibrated = this.vibrate?.(BRACE_PATTERN) === true;
    } catch {
      vibrated = false;
    }
    if (!vibrated) this.onFallbackPulse?.();
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
    try {
      this.vibrate?.(0);
    } catch {
      // The visual/audio fallback has already replaced unsupported vibration.
    }
  }
}
