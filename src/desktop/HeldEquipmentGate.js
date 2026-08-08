export class HeldEquipmentGate {
  constructor(options = {}) {
    this.options = {
      trackingConfidence: 0.62,
      grabEnter: 0.68,
      grabExit: 0.42,
      grabMs: 160,
      grabFrames: 3,
      releaseMs: 120,
      ...options,
    };
    this.reset();
  }

  reset() {
    this.armed = true;
    this.holding = false;
    this.grabAt = null;
    this.grabFrames = 0;
    this.releaseAt = null;
    this.lastFrameKey = null;
    return this;
  }

  suppressUntilRelease() {
    this.armed = false;
    this.holding = false;
    this.grabAt = null;
    this.grabFrames = 0;
    this.releaseAt = null;
    return this;
  }

  update(sample, now = 0) {
    const pose = sample?.gesturePose ?? sample?.pose;
    const confidence = Number.isFinite(sample?.trackingConfidence)
      ? sample.trackingConfidence
      : pose?.trackingConfidence;
    const modeEpoch = Number.isInteger(sample?.modeEpoch) ? sample.modeEpoch : pose?.modeEpoch;
    const seq = Number.isInteger(sample?.seq) ? sample.seq : pose?.seq;
    const frameKey = Number.isInteger(modeEpoch) && Number.isInteger(seq) ? `${modeEpoch}:${seq}` : null;
    const strength = Math.max(
      Number.isFinite(pose?.grabStrength) ? pose.grabStrength : 0,
      Number.isFinite(pose?.pinchStrength) ? pose.pinchStrength : 0,
    );
    const valid = sample?.state === "tracked"
      && sample?.fresh === true
      && Number.isFinite(confidence)
      && confidence >= this.options.trackingConfidence
      && pose?.handedness === "left"
      && Number.isFinite(strength);

    if (!valid || !frameKey || frameKey === this.lastFrameKey) {
      if (!valid) {
        this.grabAt = null;
        this.grabFrames = 0;
        this.releaseAt = null;
      }
      return null;
    }
    this.lastFrameKey = frameKey;

    if (!this.armed || this.holding) {
      if (strength <= this.options.grabExit) {
        this.releaseAt ??= now;
        if (now - this.releaseAt >= this.options.releaseMs) {
          this.armed = true;
          this.holding = false;
          this.releaseAt = null;
          return "release";
        }
      } else {
        this.releaseAt = null;
      }
      return null;
    }

    if (strength < this.options.grabEnter) {
      this.grabAt = null;
      this.grabFrames = 0;
      return null;
    }
    if (this.grabAt === null) {
      this.grabAt = now;
      this.grabFrames = 1;
    } else {
      this.grabFrames += 1;
    }
    if (this.grabFrames < this.options.grabFrames || now - this.grabAt < this.options.grabMs) return null;

    this.holding = true;
    this.armed = false;
    this.grabAt = null;
    this.grabFrames = 0;
    this.releaseAt = null;
    return "grab";
  }
}
