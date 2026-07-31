import { PhoneSession } from "./PhoneSession.js";
import { PlayerController } from "./PlayerController.js";
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
  }

  mount() {
    this.ui = createDesktopUI(this.root);
    this.phone = new PhoneSession();
    this.phone.addEventListener("room", ({ detail }) => this.ui.setRoom(detail));
    this.phone.addEventListener("peer", ({ detail }) => this.handlePeer(detail.connected));
    this.phone.addEventListener("action", ({ detail }) => this.handlePhoneAction(detail));
    this.phone.start();

    this.ui.elements.startButton.addEventListener("click", () => this.startGame(false));
    this.ui.elements.fallbackButton.addEventListener("click", () => this.startGame(true));
    this.ui.elements.restartButton.addEventListener("click", () => location.reload());
    document.addEventListener("visibilitychange", () => {
      if (this.started && document.hidden) this.setPaused(true);
    });
    window.addEventListener("pagehide", () => this.destroy(), { once: true });
  }

  async startGame(fallback) {
    if (this.started) return;
    this.started = true;
    this.fallback = fallback;
    this.ui.showLoading(true);
    this.ui.showPairing(false);
    try {
      this.experience = await createScene(this.ui.elements.sceneHost);
      this.player = new PlayerController({
        ...this.experience,
        onInteract: (id) => this.handleInteraction(id),
        onAction: (action) => this.handlePhoneAction({ action }),
        onPrompt: (label) => this.ui.setPrompt(label),
      });
      this.player.setFallback(fallback);
      this.ui.showLoading(false);
      this.lastFrame = performance.now();
      this.frame = requestAnimationFrame((time) => this.tick(time));
    } catch (error) {
      console.error(error);
      this.started = false;
      this.ui.showLoading(false);
      this.ui.showPairing(true);
      this.ui.elements.pairingStatus.innerHTML = "<span></span>3D 场景启动失败，请刷新重试";
    }
  }

  handlePhoneAction({ action, settings }) {
    if (action === "interact") this.player?.interact();
    if (action === "flashlight" && this.experience) {
      this.experience.objects.flashlight.visible = !this.experience.objects.flashlight.visible;
    }
    if (action === "recenter") this.player?.recenter();
    if (action === "settings") {
      this.player?.setSettings(settings);
      this.ui.elements.reticle.hidden = settings?.reticle === false;
    }
    if (action === "pause") this.setPaused(true);
    if (action === "resume") this.setPaused(false);
  }

  handleInteraction(id) {
    this.root.dispatchEvent(new CustomEvent("game:interact", { detail: { id } }));
  }

  handlePeer(connected) {
    this.ui.setConnected(connected);
    if (!this.started || this.fallback) return;
    if (!connected) {
      this.paused = true;
      this.player?.setPaused(true);
      this.ui.showPause(false);
      this.ui.showPairing(true);
    } else {
      this.ui.showPairing(false);
      this.setPaused(false);
    }
  }

  setPaused(paused, showOverlay = true) {
    this.paused = paused;
    this.player?.setPaused(paused);
    this.ui.showPause(showOverlay && paused);
    if (paused && document.pointerLockElement) document.exitPointerLock?.();
  }

  tick(time) {
    const delta = Math.min(0.05, Math.max(0.001, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    if (!this.paused) {
      this.elapsed += delta;
      this.player.setControllerInput(this.phone.currentInput(), this.phone.connected);
      this.player.update(delta);
      this.experience.world.timestep = delta;
      this.experience.world.step();
      this.player.syncAfterPhysics();
      this.experience.update(delta, this.elapsed);
    }
    this.experience.renderer.render(this.experience.scene, this.experience.camera);
    this.frame = requestAnimationFrame((nextTime) => this.tick(nextTime));
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.player?.destroy();
    this.experience?.dispose();
    this.phone?.destroy();
  }
}
