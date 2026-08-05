export class HandGestureGate {
  constructor(options = {}) {
    this.options = {
      trackingConfidence: 0.62,
      grabEnter: 0.72,
      grabExit: 0.55,
      candidateMs: 220,
      candidateFrames: 3,
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
    this.candidateFrames = 0;
    this.releaseAt = null;
    this.lastFrameKey = null;
    return this;
  }

  update(sample, now = 0) {
    const confidence = Number.isFinite(sample?.trackingConfidence)
      ? sample.trackingConfidence
      : sample?.pose?.trackingConfidence;
    const strength = sample?.pose?.grabStrength;
    const modeEpoch = Number.isInteger(sample?.modeEpoch) ? sample.modeEpoch : sample?.pose?.modeEpoch;
    const seq = Number.isInteger(sample?.seq) ? sample.seq : sample?.pose?.seq;
    const frameKey = Number.isInteger(modeEpoch) && Number.isInteger(seq) ? `${modeEpoch}:${seq}` : null;
    const valid = sample?.state === "tracked"
      && sample?.fresh === true
      && Number.isFinite(confidence)
      && confidence >= this.options.trackingConfidence
      && Number.isFinite(strength);
    if (!valid) {
      this.candidateAt = null;
      this.candidateFrames = 0;
      this.releaseAt = null;
      return false;
    }
    if (!frameKey || frameKey === this.lastFrameKey) return false;
    this.lastFrameKey = frameKey;

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
      this.candidateFrames = 0;
      return false;
    }
    if (this.candidateAt === null) {
      this.candidateAt = now;
      this.candidateFrames = 1;
    } else {
      this.candidateFrames += 1;
    }
    if (now - this.candidateAt < this.options.candidateMs
      || this.candidateFrames < this.options.candidateFrames
      || now - this.lastTriggerAt < this.options.cooldownMs) return false;

    this.lastTriggerAt = now;
    this.candidateAt = null;
    this.candidateFrames = 0;
    this.armed = false;
    this.releaseAt = null;
    return true;
  }
}
