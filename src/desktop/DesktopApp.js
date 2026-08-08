import { PhoneSession } from "./PhoneSession.js";
import { PlayerController } from "./PlayerController.js";
import { HorrorDirector } from "./HorrorDirector.js";
import { FoundPhoneDirector } from "./FoundPhoneDirector.js";
import { DoorDefenseDirector } from "./DoorDefenseDirector.js";
import { ShadowQuestDirector } from "./ShadowQuestDirector.js";
import { HandTrackingDirector } from "./HandTrackingDirector.js";
import { InventoryState } from "./InventoryState.js";
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
    this.handTracking = null;
    this.inventory = new InventoryState([{ id: "spare-fuse", enabled: true }]);
    this.inventoryOpen = false;
    this.fallbackHolding = false;
    this.fallbackKeyDown = false;
    this.destroyed = false;
    this.debugFrames = 0;
    this.debugShadowAutoplay = import.meta.env.DEV && new URLSearchParams(location.search).has("playShadow");
    this.debugShadowTriggered = false;
    this.lastFeedbackSequence = -1;
    this.currentTargetId = null;
    this.currentTargetEpoch = 0;
    this.handleStartClick = () => this.startGame(false);
    this.handleFallbackClick = () => this.startGame(true);
    this.handleVisibilityChange = () => {
      if (this.started && document.hidden) this.setPaused(true);
    };
    this.handlePageHide = () => this.destroy();
    this.handleFallbackKeyDown = this.handleFallbackKeyDown.bind(this);
    this.handleFallbackKeyUp = this.handleFallbackKeyUp.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handlePhoneRoom = this.handlePhoneRoom.bind(this);
    this.handlePhonePeer = this.handlePhonePeer.bind(this);
    this.handlePhoneActionEvent = this.handlePhoneActionEvent.bind(this);
    this.handlePhoneHand = this.handlePhoneHand.bind(this);
  }

  mount() {
    this.ui = createDesktopUI(this.root);
    this.phone = new PhoneSession();
    this.phone.addEventListener("room", this.handlePhoneRoom);
    this.phone.addEventListener("peer", this.handlePhonePeer);
    this.phone.addEventListener("action", this.handlePhoneActionEvent);
    this.phone.addEventListener("hand", this.handlePhoneHand);
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
      this.handTracking = new HandTrackingDirector({
        camera: this.experience.camera,
        sendControllerEvent: (event) => this.phone?.send(event),
        onGesture: (event) => this.handleHandGesture(event),
      });
      await this.handTracking.load();
      this.player = new PlayerController({
        ...this.experience,
        onInteract: (id, details) => this.handleInteraction(id, details),
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
        handTracking: this.handTracking,
      });
      this.doorDefense = new DoorDefenseDirector({
        experience: this.experience,
        player: this.player,
        story: this.director.story,
        ui: this.ui,
        audio: this.audio,
        sendControllerEvent: (event) => this.phone?.send(event),
        handTracking: this.handTracking,
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
      try {
        this.disposeRuntime();
      } catch (cleanupError) {
        console.error("Failed to clean up scene startup:", cleanupError);
      } finally {
        this.started = false;
        this.ui.showLoading(false);
        this.ui.showPairing(true);
        this.ui.elements.pairingStatus.innerHTML = "<span></span>3D 场景启动失败，请刷新重试";
      }
    }
  }

  handlePhoneAction(payload = {}) {
    if (this.destroyed) return;
    const { action, settings } = payload;
    if (action === "inventory-pointer") return this.handleInventoryPointer(payload);
    if (action === "gesture-presence") {
      return;
    }
    if (action === "task-hold") {
      if (payload.context === "door-defense") {
        this.doorDefense?.setFallbackHolding?.(payload.active, { explicit: true });
      }
      return;
    }
    if (action === "interact") this.player?.interact("touch");
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
    if (action === "voice-recording") this.ui.setVoiceRecording(payload.active === true);
    if (action === "pause") this.setPaused(true);
    if (action === "resume") this.setPaused(false);
  }

  canOpenInventory() {
    return Boolean(
      this.started
      && this.player
      && !this.fallback
      && !this.paused
      && !this.destroyed
      && !this.inventoryOpen
      && !this.doorDefense?.isCinematic?.()
      && !this.foundPhone?.isInspecting?.()
      && !this.shadowQuest?.isCinematic?.()
      && !this.handTracking?.owner
    );
  }

  handleInventoryPointer({ phase, dx, dy } = {}) {
    if (phase === "open") {
      if (!this.canOpenInventory()) return false;
      this.inventoryOpen = true;
      this.ui?.setInventory?.(this.inventory.snapshot());
      this.inventory.setHovered(this.ui?.inventoryItemAtCursor?.() ?? null);
      return true;
    }
    if (!this.inventoryOpen) return false;
    if (phase === "move") {
      const hoveredId = this.ui?.moveInventoryCursor?.(dx, dy) ?? null;
      this.inventory.setHovered(hoveredId);
      return true;
    }
    if (phase === "commit") {
      const hoveredId = this.ui?.inventoryItemAtCursor?.() ?? null;
      this.inventory.setHovered(hoveredId);
      if (hoveredId) this.inventory.equip(hoveredId);
      this.closeInventory();
      return true;
    }
    if (phase === "cancel") {
      this.closeInventory();
      return true;
    }
    return false;
  }

  closeInventory() {
    if (!this.inventoryOpen) return false;
    this.inventoryOpen = false;
    this.inventory.setHovered(null);
    this.ui?.closeInventory?.();
    return true;
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

  handleInteraction(id, details = {}) {
    if (
      this.inventoryOpen
      || this.doorDefense?.isCinematic()
      || this.foundPhone?.isInspecting()
      || this.shadowQuest?.isCinematic()
    ) return false;
    if (this.foundPhone?.handleInteraction(id, details)) return true;
    if (this.shadowQuest?.handleInteraction(id)) return true;
    return this.director?.handleInteraction(id) ?? false;
  }

  handleHandGesture(event) {
    if (
      event?.type !== "grab"
      || !this.currentTargetId
      || this.destroyed
      || this.paused
      || this.inventoryOpen
      || event?.targetId !== this.currentTargetId
      || event?.targetEpoch !== this.currentTargetEpoch
      || this.doorDefense?.isCinematic()
      || this.foundPhone?.isInspecting()
      || this.shadowQuest?.isCinematic()
    ) return false;
    this.player?.interact?.("hand");
    return true;
  }

  handleTargetFocus(target = {}) {
    const { id, focused } = target;
    const previousTargetId = this.currentTargetId;
    this.currentTargetId = focused ? id : null;
    this.currentTargetEpoch = Number.isInteger(target.epoch)
      ? target.epoch
      : this.currentTargetId !== previousTargetId ? this.currentTargetEpoch + 1 : this.currentTargetEpoch;
    this.ui?.setTargetFocused(Boolean(this.currentTargetId));
    this.handTracking?.setTarget?.(this.currentTargetId ? {
      id: this.currentTargetId,
      epoch: this.currentTargetEpoch,
      contactPoint: target.contactPoint ?? null,
      contactNormal: target.contactNormal ?? null,
      focusedAt: target.focusedAt ?? null,
    } : null);
    if (previousTargetId !== this.currentTargetId) {
      this.phone?.send({ type: "target-focus", id: this.currentTargetId });
    }
  }

  handlePhoneRoom({ detail }) {
    if (this.destroyed) return;
    this.ui?.setRoom(detail);
  }

  handlePhonePeer({ detail }) {
    if (this.destroyed) return;
    this.handlePeer(detail?.connected);
  }

  handlePhoneActionEvent({ detail }) {
    if (this.destroyed) return;
    this.handlePhoneAction(detail);
  }

  handlePhoneHand({ detail }) {
    if (this.destroyed) return;
    this.handTracking?.acceptFrame(detail);
  }

  handlePeer(connected) {
    if (this.destroyed) return;
    if (connected) {
      this.ui.setConnected(true);
      if (!this.started || this.fallback) return;
      this.ui.showPairing(false);
      this.phone?.send({ type: "target-focus", id: this.currentTargetId });
      this.setPaused(false);
      return;
    }

    let disconnectError = null;
    const runDisconnectStep = (step) => {
      try {
        step();
      } catch (error) {
        disconnectError ??= error;
      }
    };
    runDisconnectStep(() => this.ui.setConnected(false));
    runDisconnectStep(() => this.ui.setVoiceRecording?.(false));
    runDisconnectStep(() => this.closeInventory());
    if (this.started) {
      runDisconnectStep(() => this.releaseFallbackHold());
      runDisconnectStep(() => this.foundPhone?.release?.());
      runDisconnectStep(() => this.doorDefense?.abort?.());
      runDisconnectStep(() => this.shadowQuest?.abort?.());
      if (!this.fallback) {
        this.paused = true;
        runDisconnectStep(() => this.player?.setPaused(true));
        runDisconnectStep(() => this.ui.showPause(false));
        runDisconnectStep(() => this.ui.showPairing(true));
      }
    }
    if (disconnectError) throw disconnectError;
  }

  setPaused(paused, showOverlay = true) {
    this.paused = paused;
    let pauseError = null;
    const runPauseStep = (step) => {
      try {
        step();
      } catch (error) {
        pauseError ??= error;
      }
    };
    if (paused) {
      runPauseStep(() => this.ui.setVoiceRecording?.(false));
      runPauseStep(() => this.closeInventory());
      runPauseStep(() => this.handTracking?.setPaused(true));
      runPauseStep(() => this.releaseFallbackHold());
      runPauseStep(() => this.foundPhone?.release?.());
      runPauseStep(() => this.doorDefense?.abort?.());
      runPauseStep(() => this.shadowQuest?.abort?.());
    }
    if (!paused) runPauseStep(() => this.handTracking?.setPaused(false));
    runPauseStep(() => this.player?.setPaused(paused));
    runPauseStep(() => this.audio.setPaused(paused));
    runPauseStep(() => this.ui.showPause(showOverlay && paused));
    if (paused && document.pointerLockElement) runPauseStep(() => document.exitPointerLock?.());
    if (pauseError) throw pauseError;
  }

  tick(time) {
    const delta = Math.min(0.05, Math.max(0.001, (time - this.lastFrame) / 1000));
    this.debugFrames += 1;
    this.lastFrame = time;
    if (!this.paused) {
      this.elapsed += delta;
      const phoneInput = this.phone.currentInput();
      const gameplayInput = this.inventoryOpen ? {
        ...phoneInput,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
        clutch: false,
        crouch: false,
      } : { ...phoneInput, crouch: phoneInput.crouch === true };
      this.player.setControllerInput(gameplayInput, this.phone.connected);
      this.player.update(delta);
      this.handTracking?.update(delta);
      this.sendControlFeedback(phoneInput);
      this.experience.world.timestep = delta;
      this.experience.world.step();
      this.player.syncAfterPhysics();
      this.experience.update(delta, this.elapsed);
      this.foundPhone?.update(delta);
      if (!this.inventoryOpen) this.doorDefense?.update(delta);
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
      || this.fallbackKeyDown
    ) return;
    event.preventDefault?.();
    this.fallbackKeyDown = true;
    this.fallbackHolding = this.doorDefense?.setFallbackHolding(true) === true;
  }

  handleFallbackKeyUp(event) {
    if (event.code !== "Space" || !this.fallbackKeyDown) return;
    event.preventDefault?.();
    this.releaseFallbackHold();
  }

  handleWindowBlur() {
    this.releaseFallbackHold();
  }

  releaseFallbackHold() {
    if (!this.fallbackHolding && !this.fallbackKeyDown) return;
    this.fallbackHolding = false;
    this.fallbackKeyDown = false;
    this.doorDefense?.setFallbackHolding(false);
  }

  disposeRuntime() {
    let cleanupError = null;
    const runCleanup = (cleanup) => {
      try {
        cleanup();
      } catch (error) {
        cleanupError ??= error;
      }
    };
    runCleanup(() => this.foundPhone?.destroy());
    runCleanup(() => this.doorDefense?.destroy());
    runCleanup(() => this.handTracking?.destroy());
    runCleanup(() => this.shadowQuest?.destroy());
    runCleanup(() => this.player?.destroy());
    runCleanup(() => this.experience?.dispose());
    this.foundPhone = null;
    this.doorDefense = null;
    this.handTracking = null;
    this.shadowQuest = null;
    this.director = null;
    this.player = null;
    this.experience = null;
    if (cleanupError) throw cleanupError;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const phone = this.phone;
    let cleanupError = null;
    const runCleanup = (cleanup) => {
      try {
        cleanup();
      } catch (error) {
        cleanupError ??= error;
      }
    };
    runCleanup(() => cancelAnimationFrame(this.frame));
    runCleanup(() => this.releaseFallbackHold());
    runCleanup(() => this.closeInventory());
    runCleanup(() => this.ui?.elements?.startButton?.removeEventListener("click", this.handleStartClick));
    runCleanup(() => this.ui?.elements?.fallbackButton?.removeEventListener("click", this.handleFallbackClick));
    runCleanup(() => document.removeEventListener("visibilitychange", this.handleVisibilityChange));
    runCleanup(() => window.removeEventListener("keydown", this.handleFallbackKeyDown));
    runCleanup(() => window.removeEventListener("keyup", this.handleFallbackKeyUp));
    runCleanup(() => window.removeEventListener("blur", this.handleWindowBlur));
    runCleanup(() => window.removeEventListener("pagehide", this.handlePageHide));
    runCleanup(() => phone?.removeEventListener?.("room", this.handlePhoneRoom));
    runCleanup(() => phone?.removeEventListener?.("peer", this.handlePhonePeer));
    runCleanup(() => phone?.removeEventListener?.("action", this.handlePhoneActionEvent));
    runCleanup(() => phone?.removeEventListener?.("hand", this.handlePhoneHand));
    runCleanup(() => this.disposeRuntime());
    runCleanup(() => this.audio.dispose());
    runCleanup(() => phone?.destroy());
    if (this.phone === phone) this.phone = null;
    if (cleanupError) throw cleanupError;
  }
}
