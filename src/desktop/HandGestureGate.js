export class HandGestureGate {
  constructor(options = {}) {
    this.options = {
      trackingConfidence: 0.62,
      grabEnter: 0.72,
      grabExit: 0.55,
      candidateMs: 220,
      releaseMs: 180,
      cooldownMs: 500,
      ...options,
    };
    this.lastTriggerAt = -Infinity;
    this.reset();
  }

  reset({ requireRelease = false } = {}) {
    this.armed = !requireRelease;
    this.candidateAt = null;
    this.releaseAt = null;
    return this;
  }

  update(sample, now = 0) {
    const confidence = Number.isFinite(sample?.trackingConfidence)
      ? sample.trackingConfidence
      : sample?.pose?.trackingConfidence;
    const strength = sample?.pose?.grabStrength;
    const valid = sample?.state === "tracked"
      && sample?.fresh === true
      && Number.isFinite(confidence)
      && confidence >= this.options.trackingConfidence
      && Number.isFinite(strength);
    if (!valid) {
      this.candidateAt = null;
      this.releaseAt = null;
      return false;
    }

    if (!this.armed) {
      if (strength <= this.options.grabExit) {
        this.releaseAt ??= now;
        if (now - this.releaseAt >= this.options.releaseMs) {
          this.armed = true;
          this.releaseAt = null;
        }
      } else {
        this.releaseAt = null;
      }
      return false;
    }

    if (strength < this.options.grabEnter) {
      this.candidateAt = null;
      return false;
    }
    this.candidateAt ??= now;
    if (now - this.candidateAt < this.options.candidateMs
      || now - this.lastTriggerAt < this.options.cooldownMs) return false;

    this.lastTriggerAt = now;
    this.candidateAt = null;
    this.armed = false;
    this.releaseAt = null;
    return true;
  }
}
