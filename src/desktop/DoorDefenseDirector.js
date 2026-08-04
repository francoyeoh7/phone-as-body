import * as THREE from "three";

const PHASE = Object.freeze({
  dormant: "dormant",
  intro: "intro",
  calibrating: "calibrating",
  awaiting: "awaiting",
  bracing: "bracing",
  failed: "failed",
  secured: "secured",
  returning: "returning",
  complete: "complete",
});

const ACQUIRE_DISTANCE = 2.35;
const DISTANCE_EPSILON = 1e-9;
const INTRO_SECONDS = 1.2;
const HOLD_SECONDS = 4;
const FAILURE_SECONDS = 0.7;
const RETURN_SECONDS = 1;
const DOOR_CONTEXT = "door-defense";
const PRESENCE_MODE_EVENT = Object.freeze({
  type: "gesture-mode",
  mode: "presence",
  context: DOOR_CONTEXT,
  baseline: "fresh",
});
const PULSE_MODE_EVENT = Object.freeze({
  type: "gesture-mode",
  mode: "pulse",
  context: null,
  baseline: "fresh",
});
const HAPTICS_ON_EVENT = Object.freeze({ type: "haptics", active: true, pattern: "brace" });
const HAPTICS_OFF_EVENT = Object.freeze({ type: "haptics", active: false, pattern: "brace" });
const UI_STATE = Object.freeze({
  intro: Object.freeze({ visible: true, progress: 0, status: "intro" }),
  calibrating: Object.freeze({ visible: true, progress: 0, status: "calibrating" }),
  awaiting: Object.freeze({ visible: true, progress: 0, status: "awaiting" }),
  failed: Object.freeze({ visible: true, progress: 0, status: "failed" }),
  secured: Object.freeze({ visible: false, progress: 0, status: "secured" }),
  dormant: Object.freeze({ visible: false, progress: 0, status: "dormant" }),
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (value) => {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
};

export class DoorDefenseDirector {
  constructor({
    experience,
    player,
    story,
    ui,
    audio,
    sendControllerEvent,
    onThreatStart,
    reducedMotion = false,
    isReducedMotion,
  }) {
    this.experience = experience;
    this.player = player;
    this.story = story;
    this.ui = ui;
    this.audio = audio;
    this.exitDoor = experience?.objects?.exitDoor;
    this.sendControllerEvent = typeof sendControllerEvent === "function" ? sendControllerEvent : () => {};
    this.onThreatStart = typeof onThreatStart === "function" ? onThreatStart : () => {};
    this.getReducedMotion = typeof isReducedMotion === "function"
      ? isReducedMotion
      : typeof reducedMotion === "function"
        ? reducedMotion
        : () => Boolean(reducedMotion);

    this.phase = PHASE.dormant;
    this.phaseElapsed = 0;
    this.holdElapsed = 0;
    this.savedPose = null;
    this.cinematic = false;
    this.destroyed = false;
    this.cleanupIssued = false;
    this.hapticsActive = false;
    this.acquisitionBlocked = false;
    this.retryNeedsInactive = false;

    this.originalPosition = new THREE.Vector3();
    this.originalTarget = new THREE.Vector3();
    this.bracePosition = new THREE.Vector3();
    this.braceTarget = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.cameraDirection = new THREE.Vector3();
    this.toTrigger = new THREE.Vector3();
    this.doorWorldPosition = new THREE.Vector3();
    this.fallbackPresenceEvent = { context: DOOR_CONTEXT, ready: true, active: false };

    this.handleStartZ = this.exitDoor?.handlePivot?.rotation?.z ?? 0;
    this.leafStartY = this.exitDoor?.leafPivot?.rotation?.y ?? 0;
    this.boltStartX = this.exitDoor?.lockBolt?.position?.x ?? 0;
    this.gapStartScaleX = this.exitDoor?.gapShadow?.scale?.x ?? 1;
    this.braceStartY = this.exitDoor?.braceRig?.position?.y ?? 0;
    this.braceStartZ = this.exitDoor?.braceRig?.position?.z ?? 0;

    this.resetVisuals();
  }

  isCinematic() {
    return this.cinematic;
  }

  update(delta) {
    if (this.destroyed || this.phase === PHASE.complete) return;
    const seconds = Number.isFinite(delta) ? Math.max(0, delta) : 0;

    if (this.phase === PHASE.dormant) {
      const withinTrigger = this.isWithinTriggerRange();
      if (this.acquisitionBlocked) {
        if (!withinTrigger) this.acquisitionBlocked = false;
        return;
      }
      if (this.canAcquire(withinTrigger)) {
        this.acquire();
        this.updateCamera(0, 0);
      }
      return;
    }

    if (this.phase === PHASE.intro) {
      this.updateIntro(seconds);
    } else if (this.phase === PHASE.calibrating || this.phase === PHASE.awaiting) {
      this.phaseElapsed += seconds;
      this.applyDoorAnimation();
      this.updateCamera(1, this.doorImpact());
    } else if (this.phase === PHASE.bracing) {
      this.updateBracing(seconds);
    } else if (this.phase === PHASE.failed) {
      this.updateFailure(seconds);
    } else if (this.phase === PHASE.secured) {
      this.beginReturn();
      this.updateReturn(seconds);
    } else if (this.phase === PHASE.returning) {
      this.updateReturn(seconds);
    }
  }

  isWithinTriggerRange() {
    if (!this.exitDoor?.triggerPosition || !this.experience?.camera) return false;
    this.toTrigger.copy(this.exitDoor.triggerPosition).sub(this.experience.camera.position);
    return this.toTrigger.lengthSq() <= ACQUIRE_DISTANCE * ACQUIRE_DISTANCE + DISTANCE_EPSILON;
  }

  canAcquire(withinTrigger = this.isWithinTriggerRange()) {
    const current = typeof this.story?.current === "function" ? this.story.current() : this.story?.current;
    if (current !== "reach-door") return false;
    return withinTrigger;
  }

  acquire() {
    this.savedPose = this.player.snapshotPose();
    this.originalPosition.set(
      this.savedPose.camera.x,
      this.savedPose.camera.y,
      this.savedPose.camera.z,
    );
    this.experience.camera.getWorldDirection(this.cameraDirection);
    this.originalTarget.copy(this.originalPosition).addScaledVector(this.cameraDirection, 5);

    this.bracePosition.copy(this.exitDoor.triggerPosition);
    this.bracePosition.y += 0.55;
    this.bracePosition.z -= 0.42;
    this.exitDoor.root.getWorldPosition(this.doorWorldPosition);
    this.braceTarget.copy(this.doorWorldPosition);
    this.braceTarget.y += 1.45;
    this.braceTarget.z += 0.1;

    this.phase = PHASE.intro;
    this.phaseElapsed = 0;
    this.holdElapsed = 0;
    this.cinematic = true;
    this.cleanupIssued = false;
    this.acquisitionBlocked = false;
    this.retryNeedsInactive = false;
    this.resetVisuals();
    this.player.beginCinematic();
    this.ui?.setPrompt?.(null);
    this.ui?.setDoorDefense?.(UI_STATE.intro);
    this.onThreatStart();
    this.audio?.cue?.("lock-twist");
    this.audio?.cue?.("door-rattle");
    this.audio?.cue?.("door-impact");
  }

  updateIntro(delta) {
    this.phaseElapsed = Math.min(INTRO_SECONDS, this.phaseElapsed + delta);
    const progress = smoothstep(this.phaseElapsed / INTRO_SECONDS);
    this.applyDoorAnimation();
    this.updateCamera(progress, this.doorImpact());
    if (this.phaseElapsed >= INTRO_SECONDS) this.startPresenceAttempt();
  }

  startPresenceAttempt(retryNeedsInactive = false) {
    this.phase = PHASE.calibrating;
    this.phaseElapsed = 0;
    this.holdElapsed = 0;
    this.retryNeedsInactive = retryNeedsInactive;
    this.exitDoor.braceRig.visible = false;
    this.ui?.setDoorDefense?.(UI_STATE.calibrating);
    this.sendControllerEvent(PRESENCE_MODE_EVENT);
  }

  handlePresence(event) {
    if (
      this.destroyed
      || !this.cinematic
      || event?.context !== DOOR_CONTEXT
      || event.ready !== true
    ) return false;

    if (event.active === true) {
      if (this.phase === PHASE.calibrating || this.phase === PHASE.awaiting) {
        if (this.retryNeedsInactive) return false;
        this.beginBracing();
        return true;
      }
      return this.phase === PHASE.bracing;
    }

    if (event.active !== false) return false;
    if (this.phase === PHASE.calibrating) {
      this.retryNeedsInactive = false;
      this.phase = PHASE.awaiting;
      this.phaseElapsed = 0;
      this.ui?.setDoorDefense?.(UI_STATE.awaiting);
      return true;
    }
    if (this.phase === PHASE.awaiting) {
      this.retryNeedsInactive = false;
      return true;
    }
    if (this.phase === PHASE.bracing) {
      this.fail();
      return true;
    }
    return false;
  }

  setFallbackHolding(active) {
    this.fallbackPresenceEvent.active = Boolean(active);
    return this.handlePresence(this.fallbackPresenceEvent);
  }

  beginBracing() {
    this.phase = PHASE.bracing;
    this.phaseElapsed = 0;
    this.holdElapsed = 0;
    this.exitDoor.braceRig.visible = true;
    this.ui?.setDoorDefense?.({ visible: true, progress: 0, status: "bracing" });
    this.setHaptics(true);
    this.audio?.cue?.("brace-strain");
    this.applyDoorAnimation();
  }

  updateBracing(delta) {
    const remaining = HOLD_SECONDS - this.holdElapsed;
    const consumed = Math.min(delta, remaining);
    this.phaseElapsed += consumed;
    this.holdElapsed += consumed;
    this.applyDoorAnimation();
    this.updateCamera(1, this.doorImpact());
    this.ui?.setDoorDefense?.({
      visible: true,
      progress: this.holdElapsed / HOLD_SECONDS,
      status: "bracing",
    });
    if (this.holdElapsed < HOLD_SECONDS) return;
    const surplus = delta - consumed;
    if (this.succeed() && surplus > 0) {
      this.beginReturn();
      this.updateReturn(surplus);
    }
  }

  fail() {
    if (this.phase !== PHASE.bracing) return;
    this.phase = PHASE.failed;
    this.phaseElapsed = 0;
    this.holdElapsed = 0;
    this.exitDoor.braceRig.visible = false;
    this.ui?.setDoorDefense?.(UI_STATE.failed);
    this.setHaptics(false);
    this.audio?.cue?.("door-impact");
    this.applyDoorAnimation();
  }

  updateFailure(delta) {
    this.phaseElapsed = Math.min(FAILURE_SECONDS, this.phaseElapsed + delta);
    this.applyDoorAnimation();
    this.updateCamera(1, this.doorImpact());
    if (this.phaseElapsed >= FAILURE_SECONDS) {
      this.resetDoorHardware();
      this.startPresenceAttempt(true);
    }
  }

  succeed() {
    if (this.phase !== PHASE.bracing) return false;
    const transition = this.story?.dispatch?.("door-defended");
    if (transition?.accepted !== true) {
      this.abort();
      return false;
    }
    this.phase = PHASE.secured;
    this.phaseElapsed = 0;
    this.holdElapsed = HOLD_SECONDS;
    this.exitDoor.braceRig.visible = false;
    this.audio?.cue?.("door-latch");
    this.setHaptics(false);
    this.ui?.setDoorDefense?.(UI_STATE.secured);
    this.ui?.setObjective?.(this.story?.label?.());
    this.applyDoorAnimation();
    return true;
  }

  beginReturn() {
    this.phase = PHASE.returning;
    this.phaseElapsed = 0;
  }

  updateReturn(delta) {
    this.phaseElapsed = Math.min(RETURN_SECONDS, this.phaseElapsed + delta);
    const progress = smoothstep(this.phaseElapsed / RETURN_SECONDS);
    this.cameraPosition.lerpVectors(this.bracePosition, this.originalPosition, progress);
    this.cameraTarget.lerpVectors(this.braceTarget, this.originalTarget, progress);
    this.player.setCinematicCamera(this.cameraPosition, this.cameraTarget);
    this.applyDoorAnimation();
    if (this.phaseElapsed >= RETURN_SECONDS) this.finish();
  }

  finish() {
    if (!this.cinematic) return;
    const pose = this.savedPose;
    this.setSecuredVisuals();
    this.player.restorePose(pose);
    this.player.endCinematic();
    this.savedPose = null;
    this.cinematic = false;
    this.phase = PHASE.complete;
    this.phaseElapsed = 0;
    this.cleanupIssued = true;
    this.sendPulseMode();
  }

  setHaptics(active) {
    if (this.hapticsActive === active) return;
    this.hapticsActive = active;
    this.sendControllerEvent(active ? HAPTICS_ON_EVENT : HAPTICS_OFF_EVENT);
  }

  sendPulseMode() {
    this.sendControllerEvent(PULSE_MODE_EVENT);
  }

  updateCamera(approachProgress, impact) {
    this.cameraPosition.lerpVectors(this.originalPosition, this.bracePosition, approachProgress);
    this.cameraTarget.lerpVectors(this.originalTarget, this.braceTarget, approachProgress);
    if (!this.getReducedMotion() && impact > 0) {
      this.cameraPosition.x += Math.sin(this.phaseElapsed * 31) * impact * 0.018;
      this.cameraPosition.y += Math.sin(this.phaseElapsed * 47) * impact * 0.012;
      this.cameraTarget.x -= Math.sin(this.phaseElapsed * 23) * impact * 0.012;
    }
    this.player.setCinematicCamera(this.cameraPosition, this.cameraTarget);
  }

  doorImpact() {
    if (this.phase === PHASE.intro) {
      return Math.abs(Math.sin((this.phaseElapsed / INTRO_SECONDS) * Math.PI * 3));
    }
    if (this.phase === PHASE.bracing || this.phase === PHASE.calibrating || this.phase === PHASE.awaiting) {
      return Math.pow(Math.max(0, Math.sin(this.phaseElapsed * 8)), 4);
    }
    if (this.phase === PHASE.failed) {
      return Math.sin(clamp01(this.phaseElapsed / FAILURE_SECONDS) * Math.PI);
    }
    return 0;
  }

  applyDoorAnimation() {
    const impact = this.doorImpact();
    let handleTwist = 0;
    let boltOffset = 0;
    let gap = impact * 0.018;

    if (this.phase === PHASE.intro) {
      const progress = smoothstep(this.phaseElapsed / INTRO_SECONDS);
      handleTwist = -0.5 * progress;
      boltOffset = -0.055 * progress;
    } else if (this.phase === PHASE.calibrating || this.phase === PHASE.awaiting) {
      handleTwist = -0.48;
      boltOffset = -0.055;
    } else if (this.phase === PHASE.bracing) {
      handleTwist = -0.38 - impact * 0.08;
      boltOffset = -0.05 - impact * 0.025;
      gap = 0.008 + impact * 0.024;
    } else if (this.phase === PHASE.failed) {
      const progress = clamp01(this.phaseElapsed / FAILURE_SECONDS);
      handleTwist = -0.62 * (1 - progress);
      boltOffset = -0.07 * (1 - progress);
      gap = Math.sin(progress * Math.PI) * 0.085;
    } else if (this.phase === PHASE.secured || this.phase === PHASE.returning || this.phase === PHASE.complete) {
      boltOffset = 0.08;
      gap = 0;
    }

    if (this.exitDoor?.handlePivot) this.exitDoor.handlePivot.rotation.z = this.handleStartZ + handleTwist;
    if (this.exitDoor?.lockBolt) this.exitDoor.lockBolt.position.x = this.boltStartX + boltOffset;
    if (this.exitDoor?.leafPivot) this.exitDoor.leafPivot.rotation.y = this.leafStartY + gap;
    if (this.exitDoor?.gapShadow) {
      this.exitDoor.gapShadow.scale.x = this.gapStartScaleX * (1 + Math.abs(gap) * 4 + impact * 0.05);
    }
    if (this.exitDoor?.braceRig) {
      this.exitDoor.braceRig.position.y = this.braceStartY + impact * 0.012;
      this.exitDoor.braceRig.position.z = this.braceStartZ + impact * 0.018;
    }
  }

  resetDoorHardware() {
    if (this.exitDoor?.handlePivot) this.exitDoor.handlePivot.rotation.z = this.handleStartZ;
    if (this.exitDoor?.leafPivot) this.exitDoor.leafPivot.rotation.y = this.leafStartY;
    if (this.exitDoor?.lockBolt) this.exitDoor.lockBolt.position.x = this.boltStartX;
    if (this.exitDoor?.gapShadow) this.exitDoor.gapShadow.scale.x = this.gapStartScaleX;
  }

  resetVisuals() {
    this.resetDoorHardware();
    if (!this.exitDoor?.braceRig) return;
    this.exitDoor.braceRig.visible = false;
    this.exitDoor.braceRig.position.y = this.braceStartY;
    this.exitDoor.braceRig.position.z = this.braceStartZ;
  }

  setSecuredVisuals() {
    this.resetVisuals();
    if (this.exitDoor?.lockBolt) this.exitDoor.lockBolt.position.x = this.boltStartX + 0.08;
  }

  abort() {
    if (!this.cinematic && this.cleanupIssued) return false;
    const pose = this.savedPose;
    const wasCinematic = this.cinematic;
    const preserveSecured = this.phase === PHASE.secured
      || this.phase === PHASE.returning
      || (typeof this.story?.current === "function" && this.story.current() === "secured");
    if (preserveSecured) this.setSecuredVisuals();
    else this.resetVisuals();
    if (wasCinematic) {
      this.player.restorePose(pose);
      this.player.endCinematic();
    }
    this.savedPose = null;
    this.cinematic = false;
    if (wasCinematic) this.acquisitionBlocked = true;
    this.phase = PHASE.dormant;
    this.phaseElapsed = 0;
    this.holdElapsed = 0;
    this.retryNeedsInactive = false;
    this.ui?.setDoorDefense?.(UI_STATE.dormant);
    this.setHaptics(false);
    this.sendPulseMode();
    this.cleanupIssued = true;
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.abort();
    this.destroyed = true;
  }
}
