import * as THREE from "three";
import { createObjectiveState } from "../shared/objectives.js";

export class HorrorDirector {
  constructor({ experience, ui, phone, audio, onComplete }) {
    this.experience = experience;
    this.ui = ui;
    this.phone = phone;
    this.audio = audio;
    this.onComplete = onComplete;
    this.story = createObjectiveState();
    this.elapsed = 0;
    this.messageAt = Infinity;
    this.messageSent = false;
    this.silhouetteArmed = false;
    this.silhouetteShownAt = Infinity;
    this.silhouetteVanished = false;
    this.powerSequenceAt = Infinity;
    this.poweredLightCount = 0;
    this.pursuitAt = Infinity;
    this.pursuitActive = false;
    this.completionAt = Infinity;
    this.lightningAt = 3.5;
    this.subtitleUntil = 0;
    this.settings = { subtitles: true, reducedMotion: false };
    this.direction = new THREE.Vector3();
    this.toSilhouette = new THREE.Vector3();
    this.ui.setObjective(this.story.label());
  }

  setSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    if (!this.settings.subtitles) this.ui.setSubtitle(null, false);
  }

  handleInteraction(id) {
    if (id === "fuse") return this.collectFuse();
    if (id === "panel") return this.restorePower();
    if (id === "elevator") return this.enterElevator();
    return false;
  }

  collectFuse() {
    const transition = this.story.dispatch("fuse-collected");
    if (!transition.accepted) return false;
    const { fuse, ceilingLights, silhouette } = this.experience.objects;
    fuse.enabled = false;
    fuse.root.visible = false;
    ceilingLights[2].intensity = 0;
    this.ui.setPrompt(null);
    this.ui.setObjective(this.story.label());
    this.showSubtitle("保险丝还是温的。", 2.2);
    this.audio.cue("pickup");
    this.messageAt = this.elapsed + 1.1;
    this.silhouetteArmed = true;
    silhouette.position.set(
      this.experience.camera.position.x + 0.4,
      0,
      Math.min(1.8, this.experience.camera.position.z + 6.2),
    );
    return true;
  }

  restorePower() {
    const transition = this.story.dispatch("panel-used");
    if (!transition.accepted) {
      this.audio.cue("locked");
      this.showSubtitle(this.story.current() === "find-fuse" ? "配电箱里少了一个保险丝。" : "电源已经恢复。", 2.1);
      return false;
    }
    const { panel, elevator, ceilingLights } = this.experience.objects;
    panel.lamp.material.color.setHex(0x7da468);
    panel.lamp.material.emissive.setHex(0x577e46);
    elevator.root.visible = true;
    for (const light of ceilingLights) light.intensity = 0;
    this.powerSequenceAt = this.elapsed + 0.2;
    this.pursuitAt = this.elapsed + 4.2;
    this.ui.setObjective(this.story.label());
    this.showSubtitle("电梯恢复供电。远处有什么东西动了。", 3.2);
    this.audio.cue("power");
    return true;
  }

  enterElevator() {
    const transition = this.story.dispatch("elevator-entered");
    if (!transition.accepted) return false;
    this.experience.objects.elevator.enabled = false;
    this.pursuitActive = false;
    this.experience.objects.silhouette.visible = false;
    this.ui.setPrompt(null);
    this.ui.setObjective(this.story.label());
    this.showSubtitle("门正在关闭。", 2.2);
    this.audio.cue("elevator");
    this.completionAt = this.elapsed + 2.35;
    return true;
  }

  showSubtitle(text, seconds) {
    if (!this.settings.subtitles) return;
    this.ui.setSubtitle(text, true);
    this.subtitleUntil = this.elapsed + seconds;
  }

  update(delta, elapsed) {
    this.elapsed = elapsed;
    if (elapsed >= this.subtitleUntil) this.ui.setSubtitle(null, false);
    this.updatePrivateMessage();
    this.updateSilhouette(delta);
    this.updatePowerSequence();
    this.updatePursuit(delta);
    this.updateElevator(delta);
    this.updateStorm(delta);
    if (elapsed >= this.completionAt) {
      this.completionAt = Infinity;
      this.onComplete?.();
    }
  }

  updatePrivateMessage() {
    if (this.messageSent || this.elapsed < this.messageAt) return;
    this.messageSent = true;
    this.phone.send({ type: "private-message", text: "别回头" });
  }

  updateSilhouette() {
    if (!this.silhouetteArmed || this.silhouetteVanished) return;
    const { camera, objects } = this.experience;
    camera.getWorldDirection(this.direction);
    this.toSilhouette.copy(objects.silhouette.position).sub(camera.position).normalize();
    const alignment = this.direction.dot(this.toSilhouette);
    if (!objects.silhouette.visible && alignment > 0.7) {
      objects.silhouette.visible = true;
      this.silhouetteShownAt = this.elapsed;
    }
    if (
      objects.silhouette.visible &&
      objects.flashlight.visible &&
      alignment > 0.9 &&
      this.elapsed - this.silhouetteShownAt > 0.62
    ) {
      objects.silhouette.visible = false;
      this.silhouetteVanished = true;
      this.silhouetteArmed = false;
      this.audio.cue("stinger");
      this.showSubtitle("走廊里只剩下你的呼吸。", 2.4);
    }
  }

  updatePowerSequence() {
    if (this.elapsed < this.powerSequenceAt) return;
    const lights = this.experience.objects.ceilingLights;
    if (this.poweredLightCount < lights.length) {
      const index = lights.length - 1 - this.poweredLightCount;
      lights[index].intensity = 1.05;
      this.poweredLightCount += 1;
      this.powerSequenceAt = this.elapsed + 0.22;
    } else {
      this.powerSequenceAt = Infinity;
    }
  }

  updatePursuit(delta) {
    const { silhouette } = this.experience.objects;
    const camera = this.experience.camera;
    if (!this.pursuitActive && this.elapsed >= this.pursuitAt) {
      this.pursuitActive = true;
      this.pursuitAt = Infinity;
      silhouette.position.set(camera.position.x, 0, Math.min(2.1, camera.position.z + 8));
      silhouette.visible = true;
      this.audio.cue("stinger");
    }
    if (!this.pursuitActive) return;
    const target = new THREE.Vector3(camera.position.x, 0, camera.position.z + 1.8);
    const direction = target.sub(silhouette.position);
    const distance = direction.length();
    if (distance > 1.9) silhouette.position.addScaledVector(direction.normalize(), delta * 0.72);
  }

  updateElevator(delta) {
    const doors = this.experience.objects.elevatorDoors.children;
    if (doors.length < 2) return;
    const escaped = this.story.current() === "escaped";
    const leftTarget = escaped ? -0.58 : this.story.current() === "reach-elevator" ? -1.18 : -0.58;
    const rightTarget = -leftTarget;
    const alpha = 1 - Math.exp(-delta * (escaped ? 2.5 : 3.8));
    doors[0].position.x += (leftTarget - doors[0].position.x) * alpha;
    doors[1].position.x += (rightTarget - doors[1].position.x) * alpha;
  }

  updateStorm(delta) {
    const light = this.experience.objects.stormLight;
    if (this.elapsed >= this.lightningAt) {
      light.intensity = this.settings.reducedMotion ? 0.65 : 2.8;
      this.audio.cue("thunder");
      this.lightningAt = this.elapsed + 7 + Math.random() * 7;
    }
    light.intensity += (0 - light.intensity) * Math.min(1, delta * 7);
  }
}
