import { PhoneSession } from "./PhoneSession.js";
import { PlayerController } from "./PlayerController.js";
import { HorrorDirector } from "./HorrorDirector.js";
import { FoundPhoneDirector } from "./FoundPhoneDirector.js";
import { DoorDefenseDirector } from "./DoorDefenseDirector.js";
import { ShadowQuestDirector } from "./ShadowQuestDirector.js";
import { createGameAudio } from "./audio.js";
import { createScene } from "./create-scene.js";
import { createDesktopUI } from "./ui.js";
import "./styles.css";

export class DesktopApp {
  constructor(root) {
    this.root = root;
    this.ui = null;
    this.phone = null;
    this.started = false;
    this.fallback = false;
    this.paused = false;
    this.experience = null;
    this.player = null;
    this.frame = null;
    this.lastFrame = 0;
    this.elapsed = 0;
    this.audio = createGameAudio();
    this.director = null;
    this.foundPhone = null;
    this.doorDefense = null;
    this.shadowQuest = null;
    this.fallbackHolding = false;
    this.destroyed = false;
    this.debugFrames = 0;
    this.debugShadowAutoplay = import.meta.env.DEV && new URLSearchParams(location.search).has("playShadow");
    this.debugShadowTriggered = false;
    this.lastFeedbackSequence = -1;
    this.currentTargetId = null;
    this.handleStartClick = () => this.startGame(false);
    this.handleFallbackClick = () => this.startGame(true);
    this.handleVisibilityChange = () => {
      if (this.started && document.hidden) this.setPaused(true);
    };
    this.handlePageHide = () => this.destroy();
    this.handleFallbackKeyDown = this.handleFallbackKeyDown.bind(this);
    this.handleFallbackKeyUp = this.handleFallbackKeyUp.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
  }

  mount() {
    this.ui = createDesktopUI(this.root);
    this.phone = new PhoneSession();
    this.phone.addEventListener("room", ({ detail }) => this.ui.setRoom(detail));
    this.phone.addEventListener("peer", ({ detail }) => this.handlePeer(detail.connected));
    this.phone.addEventListener("action", ({ detail }) => this.handlePhoneAction(detail));
    this.phone.start();

    this.ui.elements.startButton.addEventListener("click", this.handleStartClick);
    this.ui.elements.fallbackButton.addEventListener("click", this.handleFallbackClick);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("keydown", this.handleFallbackKeyDown);
    window.addEventListener("keyup", this.handleFallbackKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
    window.addEventListener("pagehide", this.handlePageHide, { once: true });
  }

  async startGame(fallback) {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.fallback = fallback;
    this.audio.start();
    this.ui.showLoading(true);
    this.ui.showPairing(false);
    try {
      const experience = await createScene(this.ui.elements.sceneHost);
      if (this.destroyed) {
        experience.dispose();
        return;
      }
      this.experience = experience;
      this.player = new PlayerController({
        ...this.experience,
        onInteract: (id) => this.handleInteraction(id),
        onAction: (action) => this.handlePhoneAction({ action }),
        onPrompt: (label) => this.ui.setPrompt(label),
        onTarget: (target) => this.handleTargetFocus(target),
      });
      this.player.setFallback(fallback);
      this.director = new HorrorDirector({
        experience: this.experience,
        ui: this.ui,
        audio: this.audio,
      });
      this.foundPhone = new FoundPhoneDirector({
        experience: this.experience,
        player: this.player,
        audio: this.audio,
        sendControllerEvent: (event) => this.phone?.send(event),
      });
      this.doorDefense = new DoorDefenseDirector({
        experience: this.experience,
        player: this.player,
        story: this.director.story,
        ui: this.ui,
        audio: this.audio,
        sendControllerEvent: (event) => this.phone?.send(event),
        onThreatStart: () => this.director?.stopPursuit(),
        isReducedMotion: () => Boolean(
          this.director?.settings?.reducedMotion
          || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ),
      });
      this.shadowQuest = new ShadowQuestDirector({
        experience: this.experience,
        player: this.player,
        ui: this.ui,
        audio: this.audio,
      });
      this.applyDebugStart();
      this.ui.showLoading(false);
      this.lastFrame = performance.now();
      this.frame = requestAnimationFrame((time) => this.tick(time));
    } catch (error) {
      if (this.destroyed) return;
      console.error(error);
      this.disposeRuntime();
      this.started = false;
      this.ui.showLoading(false);
      this.ui.showPairing(true);
      this.ui.elements.pairingStatus.innerHTML = "<span></span>3D 场景启动失败，请刷新重试";
    }
  }

  handlePhoneAction(payload = {}) {
    const { action, settings } = payload;
    if (action === "gesture-presence") {
      if (payload.context === "found-phone") this.foundPhone?.handlePresence(payload);
      if (payload.context === "door-defense") this.doorDefense?.handlePresence(payload);
      return;
    }
    if (action === "interact") this.player?.interact();
    if (action === "flashlight" && this.experience) {
      this.experience.objects.flashlight.visible = !this.experience.objects.flashlight.visible;
      this.audio.cue("flashlight");
    }
    if (action === "recenter") this.player?.recenter();
    if (action === "settings") {
      this.player?.setSettings(settings);
      this.director?.setSettings(settings);
      this.ui.elements.reticle.hidden = settings?.reticle === false;
    }
    if (action === "pause") this.setPaused(true);
    if (action === "resume") this.setPaused(false);
  }

  applyDebugStart() {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("shadow")) return;
    const translation = { x: 0, y: 1.05, z: -14.4 };
    this.player.body.setTranslation?.(translation, true);
    this.player.body.setNextKinematicTranslation?.(translation);
    this.player.cameraYaw = Math.PI / 2;
    this.player.cameraPitch = 0;
    this.player.cameraRenderYaw = Math.PI / 2;
    this.player.cameraRenderPitch = 0;
    this.experience.camera.position.set(0, 1.6, -14.4);
    this.experience.camera.rotation.set(0, Math.PI / 2, 0, "YXZ");
  }

  handleInteraction(id) {
    if (
      this.doorDefense?.isCinematic()
      || this.foundPhone?.isInspecting()
      || this.shadowQuest?.isCinematic()
    ) return false;
    if (this.foundPhone?.handleInteraction(id)) return true;
    if (this.shadowQuest?.handleInteraction(id)) return true;
    return this.director?.handleInteraction(id) ?? false;
  }

  handleTargetFocus({ id, focused }) {
    this.currentTargetId = focused ? id : null;
    this.ui?.setTargetFocused(Boolean(this.currentTargetId));
    this.phone?.send({ type: "target-focus", id: this.currentTargetId });
  }

  handlePeer(connected) {
    this.ui.setConnected(connected);
    if (!this.started) return;
    if (!connected) {
      this.releaseFallbackHold();
      this.foundPhone?.release();
      this.doorDefense?.abort();
      this.shadowQuest?.abort();
      if (this.fallback) return;
      this.paused = true;
      this.player?.setPaused(true);
      this.ui.showPause(false);
      this.ui.showPairing(true);
    } else if (!this.fallback) {
      this.ui.showPairing(false);
      this.phone?.send({ type: "target-focus", id: this.currentTargetId });
      this.setPaused(false);
    }
  }

  setPaused(paused, showOverlay = true) {
    this.paused = paused;
    if (paused) this.releaseFallbackHold();
    this.player?.setPaused(paused);
    this.audio.setPaused(paused);
    this.ui.showPause(showOverlay && paused);
    if (paused && document.pointerLockElement) document.exitPointerLock?.();
  }

  tick(time) {
    const delta = Math.min(0.05, Math.max(0.001, (time - this.lastFrame) / 1000));
    this.debugFrames += 1;
    this.lastFrame = time;
    if (!this.paused) {
      this.elapsed += delta;
      const phoneInput = this.phone.currentInput();
      this.player.setControllerInput(phoneInput, this.phone.connected);
      this.player.update(delta);
      this.sendControlFeedback(phoneInput);
      this.experience.world.timestep = delta;
      this.experience.world.step();
      this.player.syncAfterPhysics();
      this.experience.update(delta, this.elapsed);
      this.doorDefense?.update(delta);
      this.shadowQuest?.update(delta, this.elapsed);
      if (this.debugShadowAutoplay && !this.debugShadowTriggered && this.shadowQuest?.isAvailable()) {
        this.debugShadowTriggered = this.shadowQuest.handleInteraction("shadow-window");
      }
      const cinematicOwned = this.doorDefense?.isCinematic()
        || this.foundPhone?.isInspecting()
        || this.shadowQuest?.isCinematic();
      if (!cinematicOwned) this.director?.update(delta, this.elapsed);
      this.audio.update(delta, Math.hypot(this.player.velocity.x, this.player.velocity.z));
      if (import.meta.env.DEV) {
        const position = this.player.body.translation();
        this.experience.renderer.domElement.dataset.debugState = JSON.stringify({
          x: Number(position.x.toFixed(2)),
          y: Number(position.y.toFixed(2)),
          z: Number(position.z.toFixed(2)),
          yaw: Number((this.player.cameraYaw / (Math.PI / 180)).toFixed(1)),
          pitch: Number((this.player.cameraPitch / (Math.PI / 180)).toFixed(1)),
          selected: this.player.selected?.id ?? null,
          objective: this.director?.story.current() ?? null,
          shadowQuest: this.shadowQuest?.complete ? "complete" : this.shadowQuest?.isCinematic() ? "cinematic" : this.shadowQuest?.isAvailable() ? "available" : "hidden",
          delta: Number(delta.toFixed(4)),
          vx: Number(this.player.velocity.x.toFixed(2)),
          vz: Number(this.player.velocity.z.toFixed(2)),
          frames: this.debugFrames,
        });
      }
    }
    this.experience.renderer.render(this.experience.scene, this.experience.camera);
    this.sampleDebugPixels();
    this.frame = requestAnimationFrame((nextTime) => this.tick(nextTime));
  }

  sampleDebugPixels() {
    if (!import.meta.env.DEV || this.debugFrames % 60 !== 0) return;
    const renderer = this.experience.renderer;
    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixel = new Uint8Array(4);
    const samples = [
      [0.25, 0.5],
      [0.5, 0.5],
      [0.75, 0.5],
    ].map(([x, y]) => {
      gl.readPixels(Math.floor(width * x), Math.floor(height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return Array.from(pixel);
    });
    renderer.domElement.dataset.debugPixels = JSON.stringify(samples);
  }

  sendControlFeedback(input) {
    const sequence = Number.isInteger(input?.seq) ? input.seq : -1;
    if (sequence < 0 || sequence <= this.lastFeedbackSequence || !this.player) return;
    this.lastFeedbackSequence = sequence;
    const radiansToDegrees = 180 / Math.PI;
    this.phone?.send({
      type: "control-feedback",
      seq: sequence,
      cameraYaw: Number((this.player.cameraYaw * radiansToDegrees).toFixed(2)),
      cameraPitch: Number((this.player.cameraPitch * radiansToDegrees).toFixed(2)),
    });
  }

  handleFallbackKeyDown(event) {
    if (
      event.code !== "Space"
      || event.repeat
      || !this.fallback
      || this.paused
      || this.destroyed
      || this.fallbackHolding
    ) return;
    event.preventDefault?.();
    this.fallbackHolding = this.doorDefense?.setFallbackHolding(true) === true;
  }

  handleFallbackKeyUp(event) {
    if (event.code !== "Space" || !this.fallbackHolding) return;
    event.preventDefault?.();
    this.releaseFallbackHold();
  }

  handleWindowBlur() {
    this.releaseFallbackHold();
  }

  releaseFallbackHold() {
    if (!this.fallbackHolding) return;
    this.fallbackHolding = false;
    this.doorDefense?.setFallbackHolding(false);
  }

  disposeRuntime() {
    this.foundPhone?.destroy();
    this.doorDefense?.destroy();
    this.shadowQuest?.destroy();
    this.player?.destroy();
    this.experience?.dispose();
    this.foundPhone = null;
    this.doorDefense = null;
    this.shadowQuest = null;
    this.director = null;
    this.player = null;
    this.experience = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.releaseFallbackHold();
    this.ui?.elements?.startButton?.removeEventListener("click", this.handleStartClick);
    this.ui?.elements?.fallbackButton?.removeEventListener("click", this.handleFallbackClick);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("keydown", this.handleFallbackKeyDown);
    window.removeEventListener("keyup", this.handleFallbackKeyUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    window.removeEventListener("pagehide", this.handlePageHide);
    this.disposeRuntime();
    this.audio.dispose();
    this.phone?.destroy();
  }
}
