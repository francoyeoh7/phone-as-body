import * as THREE from "three";
import { KnockGestureDetector } from "./KnockGestureDetector.js";

const PHASES = Object.freeze({
  idle: "idle",
  align: "align",
  video: "video",
  hold: "hold",
  crack: "crack",
  grab: "grab",
  struggle: "struggle",
  fall: "fall",
  slam: "slam",
  complete: "complete",
});
const HOLD_AT = 0.5;
const CRACK_AT = 1.3;
const GRAB_AT = 2.0;
const FALL_AT = 6.2;
const SLAM_AT = 7.15;
const COMPLETE_AT = 8.05;
const ALIGN_AT = 0.42;
const VIDEO_MAX_SECONDS = 6.3;
const KNOCK_VIDEO_URL = "/assets/cinematics/village-knock-grab-v1.mp4";
const DOOR_OPEN = THREE.MathUtils.degToRad(18);
const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const smoothstep = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const clonePose = (value) => {
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  return value && typeof value === "object"
    ? Array.isArray(value) ? value.map(clonePose) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePose(item)]))
    : value;
};

function finiteVector(value, fallback = new THREE.Vector3()) {
  if (value?.isVector3 && value.toArray().every(Number.isFinite)) return value.clone();
  return fallback.clone();
}

export class KnockDoorDirector {
  constructor({ experience, player, handTracking = null, audio = null, ui = null, detector = null } = {}) {
    this.experience = experience;
    this.player = player;
    this.handTracking = handTracking;
    this.audio = audio;
    this.ui = ui;
    this.objects = experience?.objects?.knockDoor ?? null;
    this.bloodMark = this.objects?.bloodMark ?? null;
    this.detector = detector ?? new KnockGestureDetector();
    this.phase = PHASES.idle;
    this.elapsed = 0;
    this.cinematic = false;
    this.destroyed = false;
    this.savedPose = null;
    this.savedHandPose = null;
    this.originalPosition = new THREE.Vector3();
    this.originalTarget = new THREE.Vector3();
    this.alignedPosition = new THREE.Vector3();
    this.alignedTarget = new THREE.Vector3();
    this.fallPosition = new THREE.Vector3();
    this.fallTarget = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.doorWorld = new THREE.Vector3();
    this.doorNormal = new THREE.Vector3(0, 0, 1);
    this.pullPosition = new THREE.Vector3();
    this.pullTarget = new THREE.Vector3();
    this.restGrabPosition = new THREE.Vector3();
    this.pulse = new THREE.Vector3();
    this.presentation = "procedural";
    this.videoElement = null;
    this.videoStartedAt = 0;
    this.videoEndedHandler = null;
    this.videoErrorHandler = null;
    this.resetVisuals();
  }

  isCinematic() { return this.cinematic; }

  update(delta = 0, { focused = false } = {}) {
    if (this.destroyed || this.cinematic) {
      if (this.cinematic) this.updateCinematic(delta);
      return false;
    }
    const sample = this.handTracking?.lastSample;
    const now = Number.isFinite(sample?.receivedAt) ? sample.receivedAt : performance.now();
    if (this.detector.update(sample, { focused, now })) return this.startFromKnock();
    return false;
  }

  startFromKnock({ pose = null } = {}) {
    if (this.destroyed || this.cinematic || !this.player || !this.objects) return false;
    this.savedPose = this.player.snapshotPose?.() ?? null;
    if (!this.savedPose) return false;
    const camera = this.experience?.camera;
    if (!camera) return false;
    this.savedHandPose = clonePose(pose ?? this.handTracking?.lastSample?.gesturePose ?? this.handTracking?.lastSample?.pose ?? null);
    this.originalPosition.set(this.savedPose.camera.x, this.savedPose.camera.y, this.savedPose.camera.z);
    camera.getWorldDirection(this.direction);
    this.originalTarget.copy(this.originalPosition).addScaledVector(this.direction, 5);
    this.objects.root?.getWorldPosition?.(this.doorWorld);
    const doorQuaternion = this.objects.root?.getWorldQuaternion?.(new THREE.Quaternion()) ?? new THREE.Quaternion();
    this.doorNormal.set(0, 0, 1).applyQuaternion(doorQuaternion).normalize();
    if (this.doorNormal.lengthSq() < 0.5) this.doorNormal.set(0, 0, 1);
    this.alignedPosition.copy(this.doorWorld).addScaledVector(this.doorNormal, 1.62);
    this.alignedPosition.y = this.doorWorld.y + 1.55;
    this.alignedTarget.copy(this.doorWorld).add(new THREE.Vector3(0, 1.35, 0));
    this.fallPosition.copy(this.doorWorld).addScaledVector(this.doorNormal, 1.88);
    this.fallPosition.y = this.doorWorld.y + 0.58;
    this.fallTarget.copy(this.doorWorld).add(new THREE.Vector3(0, 1.58, 0));
    this.pullPosition.copy(this.alignedPosition);
    this.pullTarget.copy(this.alignedTarget);
    this.restGrabPosition.copy(
      this.objects.realGrabArm?.userData?.restPosition
      ?? this.objects.realGrabArm?.position
      ?? this.objects.grabArm?.position
      ?? new THREE.Vector3(0, 1.1, -0.42),
    );
    this.attachBloodMark();
    this.elapsed = 0;
    this.presentation = "procedural";
    this.videoElement = null;
    try {
      this.videoElement = this.ui?.prepareKnockVideo?.(KNOCK_VIDEO_URL) ?? null;
    } catch {
      this.videoElement = null;
    }
    if (this.videoElement?.addEventListener) {
      this.presentation = "video-pending";
      this.videoEndedHandler = () => {
        if (this.cinematic && this.presentation === "video") this.finish();
      };
      this.videoErrorHandler = () => this.useProceduralFallback();
      this.videoElement.addEventListener("ended", this.videoEndedHandler);
      this.videoElement.addEventListener("error", this.videoErrorHandler);
    }
    this.phase = this.presentation === "video-pending" ? PHASES.align : PHASES.hold;
    this.cinematic = true;
    this.resetVisuals();
    this.player.beginCinematic?.();
    this.handTracking?.setCinematicPose?.(clonePose(this.savedHandPose ?? {}));
    this.ui?.setPrompt?.(null);
    this.ui?.setSubtitle?.("门缝里伸出一只手，抓住了你的手腕。", true);
    this.audio?.cue?.("door-rattle");
    return true;
  }

  updateCinematic(delta = 0) {
    this.elapsed += Math.max(0, Number(delta) || 0);
    if (this.presentation === "video-pending" || this.presentation === "video") {
      if (this.presentation === "video-pending") {
        this.phase = PHASES.align;
        if (this.elapsed < ALIGN_AT) {
          this.applyAlignmentCamera(this.elapsed);
          return;
        }
        this.beginVideoPlayback();
      }
      if (this.presentation === "video") {
        this.phase = PHASES.video;
        this.cameraPosition.copy(this.alignedPosition);
        this.cameraTarget.copy(this.alignedTarget);
        this.player.setCinematicCamera?.(this.cameraPosition, this.cameraTarget);
        if (this.elapsed - this.videoStartedAt >= VIDEO_MAX_SECONDS) this.finish();
      }
      return;
    }
    const time = this.elapsed;
    if (time < HOLD_AT) this.phase = PHASES.hold;
    else if (time < CRACK_AT) this.phase = PHASES.crack;
    else if (time < GRAB_AT) this.phase = PHASES.grab;
    else if (time < FALL_AT) this.phase = PHASES.struggle;
    else if (time < SLAM_AT) this.phase = PHASES.fall;
    else if (time < COMPLETE_AT) this.phase = PHASES.slam;
    else { this.finish(); return; }
    this.applyDoor(time);
    this.applyGrabArm(time);
    this.applyPlayerHand(time);
    this.applyCamera(time);
  }

  applyAlignmentCamera(time) {
    const progress = smoothstep(time / ALIGN_AT);
    this.cameraPosition.lerpVectors(this.originalPosition, this.alignedPosition, progress);
    this.cameraTarget.lerpVectors(this.originalTarget, this.alignedTarget, progress);
    this.player.setCinematicCamera?.(this.cameraPosition, this.cameraTarget);
  }

  beginVideoPlayback() {
    if (this.presentation !== "video-pending") return false;
    this.presentation = "video";
    this.phase = PHASES.video;
    this.videoStartedAt = this.elapsed;
    let playback;
    try {
      playback = this.ui?.playKnockVideo?.();
    } catch {
      this.useProceduralFallback();
      return false;
    }
    Promise.resolve(playback).catch(() => this.useProceduralFallback());
    return true;
  }

  useProceduralFallback() {
    if (!this.cinematic) return false;
    this.releaseVideo();
    this.presentation = "procedural";
    this.elapsed = CRACK_AT;
    this.phase = PHASES.crack;
    return true;
  }

  releaseVideo() {
    const video = this.videoElement;
    if (video?.removeEventListener) {
      if (this.videoEndedHandler) video.removeEventListener("ended", this.videoEndedHandler);
      if (this.videoErrorHandler) video.removeEventListener("error", this.videoErrorHandler);
    }
    this.videoEndedHandler = null;
    this.videoErrorHandler = null;
    if (video) this.ui?.releaseKnockVideo?.();
    this.videoElement = null;
  }

  applyDoor(time) {
    const leaf = this.objects?.leafPivot;
    if (!leaf?.rotation) return;
    let angle = 0;
    if (time < HOLD_AT) angle = 0;
    else if (time < SLAM_AT) angle = DOOR_OPEN * smoothstep((time - HOLD_AT) / (CRACK_AT - HOLD_AT));
    else angle = DOOR_OPEN * (1 - smoothstep((time - SLAM_AT) / ((COMPLETE_AT - SLAM_AT) * 0.88)));
    leaf.rotation.y = angle;
    if (this.objects?.rightLeafPivot?.rotation) this.objects.rightLeafPivot.rotation.y = -angle;
    if (this.objects?.gapLight) this.objects.gapLight.visible = time >= HOLD_AT && time < COMPLETE_AT;
  }

  applyGrabArm(time) {
    const arm = this.objects?.realGrabArm ?? this.objects?.grabArm;
    if (!arm) return;
    if (this.objects?.realGrabArm && this.objects?.grabArm) this.objects.grabArm.visible = false;
    if (time < CRACK_AT || time >= SLAM_AT) {
      arm.visible = false;
      return;
    }
    arm.visible = true;
    const startZ = arm.userData?.restPosition?.z ?? this.restGrabPosition.z;
    const reachZ = startZ + 0.78;
    if (time < GRAB_AT) {
      const reach = smoothstep((time - CRACK_AT) / (GRAB_AT - CRACK_AT));
      arm.position.z = THREE.MathUtils.lerp(startZ, reachZ, reach);
      this.setArmRootMotion(arm, -0.06 * reach, 0.04 * reach);
      this.animateRealisticArm(arm, 0.2 + reach * 0.7, 0);
    } else if (time < FALL_AT) {
      const tug = Math.sin((time - GRAB_AT) * Math.PI * 2 / 1.05);
      arm.position.z = reachZ + tug * 0.16;
      this.setArmRootMotion(arm, -0.12 + tug * 0.11, tug * 0.08);
      this.animateRealisticArm(arm, 0.88 + Math.max(0, -tug) * 0.1, tug);
    } else {
      const release = smoothstep((time - FALL_AT) / (SLAM_AT - FALL_AT));
      arm.position.z = THREE.MathUtils.lerp(reachZ, startZ, release);
      this.setArmRootMotion(arm, THREE.MathUtils.lerp(-0.12, 0, release), 0);
      this.animateRealisticArm(arm, THREE.MathUtils.lerp(0.9, 0.15, release), 0);
    }
  }

  setArmRootMotion(arm, roll = 0, pitch = 0) {
    const rest = arm?.userData?.restRotation;
    if (rest?.isEuler) arm.rotation.copy(rest);
    else arm.rotation.set(0, 0, 0);
    arm.rotation.z += roll;
    arm.rotation.x += pitch;
  }

  animateRealisticArm(arm, clench = 0, tug = 0) {
    for (const pose of arm?.userData?.grabFingerPoses ?? []) {
      pose.bone.quaternion.copy(pose.open).slerp(pose.closed, clamp01(clench)).normalize();
    }
    const forearm = arm?.getObjectByName?.("forearmL");
    const hand = arm?.getObjectByName?.("handL");
    if (forearm) forearm.rotation.z += tug * 0.075;
    if (hand) {
      hand.rotation.z -= clench * 0.08;
      hand.rotation.y += tug * 0.1;
    }
  }

  applyPlayerHand(time) {
    const base = clonePose(this.savedHandPose ?? {});
    if (time < CRACK_AT) {
      base.cinematicOffset = [0, 0, 0];
      base.cinematicCurls = [0.18, 0.18, 0.18, 0.18, 0.18];
    } else if (time < GRAB_AT) {
      const reach = smoothstep((time - CRACK_AT) / (GRAB_AT - CRACK_AT));
      base.cinematicOffset = [0.56 * reach, 0.16 * reach, -0.04 * reach];
      const clench = 0.22 + 0.34 * reach;
      base.cinematicCurls = [clench, clench, clench, clench, clench];
    } else if (time < FALL_AT) {
      const tug = Math.sin((time - GRAB_AT) * Math.PI * 2 / 1.05);
      base.cinematicOffset = [0.52 + tug * 0.055, 0.14 + Math.abs(tug) * 0.05, -0.1 - tug * 0.16];
      const clench = 0.68 + (tug < 0 ? 0.24 : 0.05);
      base.cinematicCurls = [clench, clench, clench, clench, clench];
    } else {
      const fall = smoothstep((time - FALL_AT) / (SLAM_AT - FALL_AT));
      base.cinematicOffset = [0.12 - fall * 0.2, 0.04 - fall * 0.42, -0.1 + fall * 0.2];
      const open = 0.88 - fall * 0.28;
      base.cinematicCurls = [open, open, open, open, open];
    }
    this.handTracking?.setCinematicPose?.(base);
  }

  applyCamera(time) {
    if (!this.experience?.camera) return;
    if (time < HOLD_AT) {
      this.cameraPosition.copy(this.originalPosition);
      this.cameraTarget.copy(this.originalTarget);
    } else if (time < CRACK_AT) {
      const progress = smoothstep((time - HOLD_AT) / (CRACK_AT - HOLD_AT));
      this.cameraPosition.lerpVectors(this.originalPosition, this.alignedPosition, progress);
      this.cameraTarget.lerpVectors(this.originalTarget, this.alignedTarget, progress);
    } else if (time < GRAB_AT) {
      this.cameraPosition.copy(this.alignedPosition);
      this.cameraTarget.copy(this.alignedTarget);
    } else if (time < FALL_AT) {
      const tug = Math.sin((time - GRAB_AT) * Math.PI * 2 / 1.05);
      const depth = 0.12 + tug * 0.22;
      this.cameraPosition.copy(this.alignedPosition).addScaledVector(this.doorNormal, depth);
      this.cameraPosition.x += tug * 0.075;
      this.cameraPosition.y += Math.abs(tug) * 0.045;
      this.cameraTarget.copy(this.alignedTarget).addScaledVector(this.doorNormal, depth * 0.45);
      this.cameraTarget.x += tug * 0.06;
    } else if (time < SLAM_AT) {
      const fall = smoothstep((time - FALL_AT) / (SLAM_AT - FALL_AT));
      this.cameraPosition.lerpVectors(this.alignedPosition, this.fallPosition, fall);
      this.cameraTarget.lerpVectors(this.alignedTarget, this.fallTarget, fall);
    } else {
      const slam = smoothstep((time - SLAM_AT) / (COMPLETE_AT - SLAM_AT));
      this.cameraPosition.copy(this.fallPosition);
      this.cameraTarget.copy(this.fallTarget);
      this.cameraTarget.x += Math.sin(slam * Math.PI) * 0.025;
    }
    this.player.setCinematicCamera?.(this.cameraPosition, this.cameraTarget);
  }

  finish() {
    if (!this.cinematic) return false;
    this.cinematic = false;
    this.phase = PHASES.complete;
    this.releaseVideo();
    this.resetVisuals({ keepBlood: true });
    if (this.bloodMark) this.bloodMark.visible = true;
    this.handTracking?.clearCinematicPose?.();
    const restoredHandPose = clonePose(this.savedHandPose ?? {});
    restoredHandPose.cinematicOffset = [0, 0, 0];
    this.handTracking?.hand?.applyPose?.({
      ...restoredHandPose,
      state: "tracked",
      opacity: 1,
      trackingConfidence: 1,
    }, 0.35);
    this.player.restorePose?.(this.savedPose);
    this.player.endCinematic?.();
    this.ui?.setSubtitle?.("你挣脱了门内的手，手腕上留下了血色污渍。", true);
    this.audio?.cue?.("door-impact");
    return true;
  }

  abort() {
    if (!this.cinematic) return false;
    this.cinematic = false;
    this.phase = PHASES.idle;
    this.elapsed = 0;
    this.releaseVideo();
    this.handTracking?.clearCinematicPose?.();
    this.resetVisuals();
    this.player.restorePose?.(this.savedPose);
    this.player.endCinematic?.();
    return true;
  }

  resetVisuals({ keepBlood = false } = {}) {
    if (this.objects?.leafPivot?.rotation) this.objects.leafPivot.rotation.y = 0;
    if (this.objects?.rightLeafPivot?.rotation) this.objects.rightLeafPivot.rotation.y = 0;
    if (this.objects?.gapLight) this.objects.gapLight.visible = false;
    if (this.objects?.grabArm) {
      this.objects.grabArm.visible = false;
      if (this.restGrabPosition.lengthSq() > 0) this.objects.grabArm.position.copy(this.restGrabPosition);
      this.objects.grabArm.rotation.set(0, 0, 0);
    }
    if (this.objects?.realGrabArm) this.objects.realGrabArm.visible = false;
    this.objects?.resetArmPose?.();
    if (this.bloodMark && !keepBlood) this.bloodMark.visible = false;
  }

  attachBloodMark() {
    const hand = this.handTracking?.hand;
    const anchor = hand?.getWristAnchor?.() ?? hand?.presentationBones?.handL ?? hand?.bones?.wrist ?? hand?.root;
    if (!this.bloodMark || !anchor) return;
    this.bloodMark.removeFromParent();
    anchor.add(this.bloodMark);
    this.bloodMark.position.set(0.015, 0.012, 0.018);
    this.bloodMark.rotation.set(-0.12, 0.18, -0.08);
    this.bloodMark.scale.setScalar(0.62);
    this.bloodMark.visible = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.abort();
    this.destroyed = true;
    this.objects = null;
  }
}

export { PHASES as KNOCK_PHASES, KNOCK_VIDEO_URL };
