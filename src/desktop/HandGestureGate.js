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
      gapMs: 120,
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
    this.lastValidAt = null;
    this.strengthSamples = [];
    return this;
  }

  clearCandidate({ clearStrength = true } = {}) {
    this.candidateAt = null;
    this.candidateFrames = 0;
    if (clearStrength) this.strengthSamples = [];
  }

  medianStrength(rawStrength) {
    this.strengthSamples.push(rawStrength);
    if (this.strengthSamples.length > 3) this.strengthSamples.shift();
    const sorted = [...this.strengthSamples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  update(sample, now = 0, target = null) {
    const pose = sample?.gesturePose ?? sample?.pose;
    const confidence = Number.isFinite(sample?.trackingConfidence)
      ? sample.trackingConfidence
      : pose?.trackingConfidence;
    const grabStrength = pose?.grabStrength;
    const pinchStrength = pose?.pinchStrength;
    const modeEpoch = Number.isInteger(sample?.modeEpoch) ? sample.modeEpoch : pose?.modeEpoch;
    const seq = Number.isInteger(sample?.seq) ? sample.seq : pose?.seq;
    const frameKey = Number.isInteger(modeEpoch) && Number.isInteger(seq) ? `${modeEpoch}:${seq}` : null;
    const targetId = typeof target?.id === "string" && target.id.length > 0 ? target.id : null;
    const focusStable = targetId !== null
      && target?.focused !== false
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
    const semanticEligible = pose?.handedness === "left" && pose?.reachEligible === true;
    const valid = sample?.state === "tracked"
      && sample?.fresh === true
      && Number.isFinite(confidence)
      && confidence >= this.options.trackingConfidence
      && semanticEligible
      && focusStable
      && Number.isFinite(rawStrength);
    if (!valid) {
      this.releaseAt = null;
      const transientGap = targetId !== null
        && focusStable
        && semanticEligible
        && this.candidateAt !== null
        && this.lastValidAt !== null
        && now - this.lastValidAt <= this.options.gapMs;
      if (!transientGap) this.clearCandidate();
      return false;
    }
    if (!frameKey || frameKey === this.lastFrameKey) return false;
    this.lastFrameKey = frameKey;
    this.lastValidAt = now;
    const strength = this.medianStrength(rawStrength);

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
      this.clearCandidate({ clearStrength: false });
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
    this.clearCandidate();
    this.armed = false;
    this.releaseAt = null;
    return true;
  }
}
