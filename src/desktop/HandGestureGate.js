export class HandGestureGate {
  constructor(options = {}) {
    this.options = {
      trackingConfidence: 0.62,
      grabEnter: 0.64,
      grabExit: 0.46,
      candidateMs: 160,
      candidateFrames: 3,
      releaseMs: 180,
      cooldownMs: 500,
      targetStableMs: 100,
      strengthSmoothing: 0.5,
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
    this.smoothedStrength = null;
    return this;
  }

  update(sample, now = 0, target = null) {
    const confidence = Number.isFinite(sample?.trackingConfidence)
      ? sample.trackingConfidence
      : sample?.pose?.trackingConfidence;
    const grabStrength = sample?.pose?.grabStrength;
    const pinchStrength = sample?.pose?.pinchStrength;
    const modeEpoch = Number.isInteger(sample?.modeEpoch) ? sample.modeEpoch : sample?.pose?.modeEpoch;
    const seq = Number.isInteger(sample?.seq) ? sample.seq : sample?.pose?.seq;
    const frameKey = Number.isInteger(modeEpoch) && Number.isInteger(seq) ? `${modeEpoch}:${seq}` : null;
    const targetId = typeof target?.id === "string" && target.id.length > 0 ? target.id : null;
    const focusStable = targetId !== null
      && Number.isFinite(target?.focusedAt)
      && now - target.focusedAt >= this.options.targetStableMs;
    if (targetId !== this.targetId) {
      const hadTarget = Boolean(this.targetId);
      this.targetId = targetId;
      this.reset({ requireRelease: hadTarget });
    }
    const rawStrength = Math.max(
      Number.isFinite(grabStrength) ? grabStrength : 0,
      Number.isFinite(pinchStrength) ? pinchStrength : 0,
    );
    const valid = sample?.state === "tracked"
      && sample?.fresh === true
      && Number.isFinite(confidence)
      && confidence >= this.options.trackingConfidence
      && sample?.pose?.reachEligible === true
      && focusStable
      && Number.isFinite(rawStrength);
    if (!valid) {
      this.candidateAt = null;
      this.candidateFrames = 0;
      this.releaseAt = null;
      return false;
    }
    if (!frameKey || frameKey === this.lastFrameKey) return false;
    this.lastFrameKey = frameKey;
    this.smoothedStrength = this.smoothedStrength === null
      ? rawStrength
      : this.smoothedStrength + (rawStrength - this.smoothedStrength) * this.options.strengthSmoothing;
    const strength = this.smoothedStrength;

    if (!this.armed) {
      if (rawStrength <= this.options.grabExit) {
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
