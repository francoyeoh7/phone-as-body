import { PhoneSession } from "./PhoneSession.js";
import { createDesktopUI } from "./ui.js";
import "./styles.css";

export class DesktopApp {
  constructor(root) {
    this.root = root;
    this.ui = null;
    this.phone = null;
    this.started = false;
    this.fallback = false;
  }

  mount() {
    this.ui = createDesktopUI(this.root);
    this.phone = new PhoneSession();
    this.phone.addEventListener("room", ({ detail }) => this.ui.setRoom(detail));
    this.phone.addEventListener("peer", ({ detail }) => this.ui.setConnected(detail.connected));
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
    await new Promise((resolve) => window.setTimeout(resolve, 280));
    this.ui.elements.sceneHost.querySelector(".scene-placeholder")?.classList.add("is-awake");
    this.ui.showLoading(false);
  }

  handlePhoneAction({ action }) {
    if (action === "pause") this.setPaused(true);
    if (action === "resume") this.setPaused(false);
  }

  setPaused(paused) {
    this.ui.showPause(paused);
  }

  destroy() {
    this.phone?.destroy();
  }
}
