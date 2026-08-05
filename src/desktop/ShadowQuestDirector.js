import * as THREE from "three";

const ACQUIRE_ALIGNMENT = 0.9;
const ASSIST_ALIGNMENT = 0.965;
const MAX_DISTANCE = 3.5;
const APPROACH_END = 1.15;
const FIGURE_START = 1.35;
const FIGURE_END = 3.9;
const RETURN_START = 5.15;
const COMPLETE_AT = 6.35;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (value) => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

export class ShadowQuestDirector {
  constructor({ experience, player, ui, audio }) {
    this.experience = experience;
    this.player = player;
    this.ui = ui;
    this.audio = audio;
    this.objects = experience.objects.shadowQuest;
    this.available = false;
    this.cinematic = false;
    this.complete = false;
    this.cinematicElapsed = 0;
    this.savedPose = null;
    this.direction = new THREE.Vector3();
    this.toTarget = new THREE.Vector3();
    this.taskWorld = new THREE.Vector3();
    const shadowAnchor = experience?.objects?.corridor?.anchors?.shadowWindow
      ?? this.objects?.anchors
      ?? null;
    this.peekPosition = new THREE.Vector3(...(
      shadowAnchor?.peekPosition ?? [-2.08, 1.92, -14.18]
    ));
    this.peekTarget = new THREE.Vector3(...(
      shadowAnchor?.peekTarget ?? [-6.6, 1.42, -13.45]
    ));
    this.figureStartPosition = new THREE.Vector3(...(
      shadowAnchor?.figure ?? [-6.62, 1.22, -16.4]
    ));
    this.originalPosition = new THREE.Vector3();
    this.originalTarget = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.objects.window.enabled = false;
    this.objects.taskPoint.visible = false;
    this.objects.shadowFigure.visible = false;
  }

  isAvailable() {
    return this.available;
  }

  isCinematic() {
    return this.cinematic;
  }

  update(delta) {
    if (this.complete) return;
    if (this.cinematic) {
      this.updateCinematic(delta);
      return;
    }
    this.updateDiscovery();
  }

  updateDiscovery() {
    const { camera } = this.experience;
    this.objects.taskPoint.getWorldPosition(this.taskWorld);
    this.toTarget.copy(this.taskWorld).sub(camera.position);
    const distance = this.toTarget.length();
    if (distance > 0) this.toTarget.multiplyScalar(1 / distance);
    camera.getWorldDirection(this.direction);
    const alignment = this.direction.dot(this.toTarget);
    const flashlightOn = this.experience.objects.flashlight.visible;
    this.available = flashlightOn && distance <= MAX_DISTANCE && alignment >= ACQUIRE_ALIGNMENT;
    this.objects.window.enabled = this.available;
    this.objects.taskPoint.visible = this.available;
    if (this.available && alignment >= ASSIST_ALIGNMENT) {
      this.player.setAimAssist(this.taskWorld, 0.22);
    } else {
      this.player.clearAimAssist();
    }
  }

  handleInteraction(id) {
    if (id !== "shadow-window" || !this.available || this.complete || this.cinematic) return false;
    this.startCinematic();
    return true;
  }

  startCinematic() {
    this.savedPose = this.player.snapshotPose();
    this.originalPosition.set(
      this.savedPose.camera.x,
      this.savedPose.camera.y,
      this.savedPose.camera.z,
    );
    this.originalTarget.set(0, 0, -5).applyEuler(new THREE.Euler(
      this.savedPose.cameraRenderPitch,
      this.savedPose.cameraRenderYaw,
      0,
      "YXZ",
    )).add(this.originalPosition);
    this.cinematicElapsed = 0;
    this.cinematic = true;
    this.available = false;
    this.objects.window.enabled = false;
    this.objects.taskPoint.visible = false;
    this.objects.shadowFigure.position.copy(this.figureStartPosition);
    this.objects.shadowFigure.material.opacity = 0.9;
    this.objects.shadowFigure.visible = false;
    this.objects.operatingDoor.position.z = 0;
    this.player.beginCinematic();
    this.player.clearAimAssist();
    this.ui.setPrompt(null);
    this.ui.setSubtitle("窗后有什么东西动了。", true);
    this.audio.cue("stinger");
  }

  updateCinematic(delta) {
    this.cinematicElapsed += delta;
    const time = this.cinematicElapsed;
    if (time < APPROACH_END) {
      const progress = smoothstep(time / APPROACH_END);
      this.cameraPosition.lerpVectors(this.originalPosition, this.peekPosition, progress);
      this.cameraTarget.lerpVectors(this.originalTarget, this.peekTarget, progress);
    } else if (time < RETURN_START) {
      this.cameraPosition.copy(this.peekPosition);
      this.cameraTarget.copy(this.peekTarget);
    } else {
      const progress = smoothstep((time - RETURN_START) / (COMPLETE_AT - RETURN_START));
      this.cameraPosition.lerpVectors(this.peekPosition, this.originalPosition, progress);
      this.cameraTarget.lerpVectors(this.peekTarget, this.originalTarget, progress);
    }
    this.player.setCinematicCamera(this.cameraPosition, this.cameraTarget);
    this.updateFigure(time);
    if (time >= COMPLETE_AT) this.finish();
  }

  updateFigure(time) {
    const figure = this.objects.shadowFigure;
    if (time < FIGURE_START) return;
    figure.visible = true;
    const progress = smoothstep((time - FIGURE_START) / (FIGURE_END - FIGURE_START));
    figure.position.copy(this.figureStartPosition);
    figure.position.z += progress * 3.68;
    if (time >= 2.55 && time < 3.45) {
      this.objects.operatingDoor.position.z = smoothstep((time - 2.55) / 0.9) * 0.86;
    } else if (time >= 3.45) {
      this.objects.operatingDoor.position.z = (1 - smoothstep((time - 3.45) / 0.85)) * 0.86;
    }
    if (time >= FIGURE_END) {
      figure.material.opacity = 1 - smoothstep((time - FIGURE_END) / 0.38);
    }
  }

  finish() {
    const pose = this.savedPose;
    this.objects.shadowFigure.visible = false;
    this.objects.operatingDoor.position.z = 0;
    this.objects.taskPoint.visible = false;
    this.objects.window.enabled = false;
    this.player.restorePose(pose);
    this.player.endCinematic();
    this.player.clearAimAssist();
    this.savedPose = null;
    this.cinematic = false;
    this.available = false;
    this.complete = true;
    this.ui.setSubtitle("手术室的门重新合上了。", true);
  }

  abort() {
    if (!this.cinematic) return;
    const pose = this.savedPose;
    this.objects.shadowFigure.visible = false;
    this.objects.operatingDoor.position.z = 0;
    this.objects.taskPoint.visible = false;
    this.objects.window.enabled = false;
    this.player.restorePose(pose);
    this.player.endCinematic();
    this.player.clearAimAssist();
    this.savedPose = null;
    this.cinematic = false;
    this.available = false;
    this.ui.setSubtitle(null, false);
  }

  destroy() {
    this.abort();
    this.player.clearAimAssist();
  }
}
