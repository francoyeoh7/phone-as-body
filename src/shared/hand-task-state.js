const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export const HAND_TASK_DEFAULTS = Object.freeze({
  trackingEnter: 0.62,
  trackingExit: 0.48,
  actionEnter: 0.72,
  actionExit: 0.55,
  calibrationMs: 900,
  candidateMs: 220,
  releaseMs: 180,
  lossGraceMs: 250,
  trackingMs: 120,
});

export function scoreHandAction(action, pose = {}) {
  switch (action) {
    case "open": return clamp(pose.openness);
    case "fist": {
      const curls = Array.isArray(pose.curls) ? pose.curls : [];
      return curls.length ? clamp(curls.reduce((sum, value) => sum + value, 0) / curls.length) : 0;
    }
    case "grab": return clamp(pose.grabStrength);
    case "release": return clamp(1 - pose.grabStrength);
    case "brace": return Math.min(
      clamp(pose.openness),
      clamp(pose.palmFacing),
      clamp(1 - Math.max(0, pose.velocity ?? 0)),
    );
    default: return 0;
  }
}

const initial = () => ({
  context: null,
  requiredAction: null,
  phase: "untracked",
  enteredAt: 0,
  calibrated: false,
  calibrationProgress: 0,
  actionScore: 0,
  trackingConfidence: 0,
});

export class HandTaskStateMachine {
  constructor(options = {}) {
    this.defaults = { ...HAND_TASK_DEFAULTS, ...options };
    this.state = initial();
    this.trackingCandidateAt = null;
    this.calibrationAt = null;
    this.candidateAt = null;
    this.releaseAt = null;
    this.lossAt = null;
  }

  begin({ context = null, requiredAction = null, now = 0 } = {}) {
    this.reset();
    this.state.context = context;
    this.state.requiredAction = requiredAction;
    this.state.enteredAt = now;
    return this.snapshot();
  }

  reset() {
    this.state = initial();
    this.trackingCandidateAt = null;
    this.calibrationAt = null;
    this.candidateAt = null;
    this.releaseAt = null;
    this.lossAt = null;
    return this.snapshot();
  }

  snapshot() {
    return { ...this.state };
  }

  update(observation = {}, now = 0) {
    const pose = observation.pose ?? observation;
    const fresh = observation.fresh === true && observation.state === "tracked";
    const confidence = Number.isFinite(observation.trackingConfidence)
      ? observation.trackingConfidence
      : Number.isFinite(pose.trackingConfidence) ? pose.trackingConfidence : 0;
    const score = scoreHandAction(this.state.requiredAction, pose);
    this.state.trackingConfidence = confidence;
    this.state.actionScore = score;

    if (this.state.phase === "untracked") return this.updateUntracked(fresh, confidence, pose, now);
    if (this.state.phase === "failed") {
      if (fresh && confidence >= this.defaults.trackingExit) {
        this.state.phase = "tracking";
        this.state.enteredAt = now;
      }
      return this.snapshot();
    }
    if (["held", "unstable"].includes(this.state.phase)) return this.updateHeld(fresh, confidence, score, pose, now);
    if (this.state.phase === "tracking") return this.updateTracking(fresh, confidence, score, pose, now);
    if (this.state.phase === "candidate") return this.updateCandidate(fresh, confidence, score, now);
    if (this.state.phase === "confirmed") {
      if (this.validAction(fresh, confidence, score, this.defaults.actionEnter)) {
        this.state.phase = "held";
        this.state.enteredAt = now;
      } else {
        this.state.phase = "failed";
        this.state.enteredAt = now;
        this.candidateAt = null;
      }
      return this.snapshot();
    }
    return this.snapshot();
  }

  updateUntracked(fresh, confidence, pose, now) {
    if (fresh && confidence >= this.defaults.trackingEnter) {
      this.trackingCandidateAt ??= now;
      if (now - this.trackingCandidateAt >= this.defaults.trackingMs) {
        this.state.phase = "tracking";
        this.state.enteredAt = now;
        if (confidence >= 0.65 && clamp(pose.openness) >= 0.72 && clamp(pose.palmFacing) >= 0.45) {
          this.calibrationAt = now;
        }
      }
    } else {
      this.trackingCandidateAt = null;
    }
    return this.snapshot();
  }

  validAction(fresh, confidence, score, threshold) {
    return fresh && confidence >= this.defaults.trackingEnter && score >= threshold;
  }

  updateTracking(fresh, confidence, score, pose, now) {
    if (fresh && confidence < this.defaults.trackingExit) {
      this.state.phase = "untracked";
      this.state.enteredAt = now;
      this.state.calibrated = false;
      this.state.calibrationProgress = 0;
      this.calibrationAt = null;
      this.trackingCandidateAt = null;
      return this.snapshot();
    }
    const calibrationValid = fresh && confidence >= 0.65
      && clamp(pose.openness) >= 0.72 && clamp(pose.palmFacing) >= 0.45;
    if (!this.state.calibrated) {
      if (calibrationValid) {
        this.calibrationAt ??= now;
        this.state.calibrationProgress = clamp((now - this.calibrationAt) / this.defaults.calibrationMs);
        if (now - this.calibrationAt >= this.defaults.calibrationMs) {
          this.state.calibrated = true;
          this.state.calibrationProgress = 1;
        }
      } else {
        this.calibrationAt = null;
        this.state.calibrationProgress = 0;
      }
      return this.snapshot();
    }
    if (this.validAction(fresh, confidence, score, this.defaults.actionEnter)) {
      this.candidateAt ??= now;
      if (now - this.candidateAt >= this.defaults.candidateMs) {
        this.state.phase = "candidate";
        this.state.enteredAt = now;
      }
    } else {
      this.candidateAt = null;
    }
    return this.snapshot();
  }

  updateCandidate(fresh, confidence, score, now) {
    if (!this.validAction(fresh, confidence, score, this.defaults.actionEnter)) {
      this.candidateAt = null;
      this.state.phase = "failed";
      this.state.enteredAt = now;
      return this.snapshot();
    }
    this.state.phase = "confirmed";
    this.state.enteredAt = now;
    return this.snapshot();
  }

  updateHeld(fresh, confidence, score, pose, now) {
    const validHeld = fresh && confidence >= this.defaults.trackingExit && score >= this.defaults.actionExit;
    if (this.state.phase === "unstable") {
      if (validHeld) {
        this.state.phase = "held";
        this.state.enteredAt = now;
        this.lossAt = null;
      }
      return this.snapshot();
    }
    const releaseScore = scoreHandAction("release", pose);
    const releasing = this.state.requiredAction === "grab" && fresh
      && confidence >= this.defaults.trackingExit && releaseScore >= this.defaults.actionEnter;
    if (releasing) {
      this.releaseAt ??= now;
      if (now - this.releaseAt >= this.defaults.releaseMs) {
        this.state.phase = "success";
        this.state.enteredAt = now;
        return this.snapshot();
      }
    } else {
      this.releaseAt = null;
    }
    if (!validHeld) {
      this.lossAt ??= now;
      if (now - this.lossAt >= this.defaults.lossGraceMs) {
        this.state.phase = "unstable";
        this.state.enteredAt = now;
      }
      return this.snapshot();
    }
    this.lossAt = null;
    return this.snapshot();
  }
}
