import {
  createIcons,
  Crosshair,
  RotateCcw,
  Settings,
  Wifi,
  X,
} from "lucide";
import { isRoomCode } from "../shared/protocol.js";
import { BraceHaptics } from "./BraceHaptics.js";
import { CameraMotionDetector } from "./CameraMotionDetector.js";
import { ControllerSocket } from "./ControllerSocket.js";
import { MotionController } from "./MotionController.js";
import { MotionDiagnostics } from "./MotionDiagnostics.js";
import { VirtualJoystick } from "./VirtualJoystick.js";
import "./styles.css";

const icons = { Crosshair, RotateCcw, Settings, Wifi, X };

const defaultSettings = {
  sensitivity: 1,
  smoothing: 0.18,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("corridor617-settings"));
    const sensitivity = Number(saved?.sensitivity);
    const smoothing = Number(saved?.smoothing);
    const legacySettings = saved && ["invertY", "reticle", "reducedMotion", "subtitles"].some((key) => key in saved);
    return {
      sensitivity: Number.isFinite(sensitivity) ? Math.min(1.6, Math.max(0.6, sensitivity)) : defaultSettings.sensitivity,
      smoothing: !legacySettings && Number.isFinite(smoothing)
        ? Math.min(1, Math.max(0, smoothing))
        : defaultSettings.smoothing,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function pulse(pattern = 12) {
  navigator.vibrate?.(pattern);
}

function zeroViewDelta() {
  return { yaw: 0, pitch: 0 };
}

export class ControllerApp {
  constructor(root) {
    this.root = root;
    const parameters = new URLSearchParams(location.search);
    this.room = parameters.get("room") ?? "";
    this.preview = import.meta.env.DEV && parameters.has("preview");
    this.move = { x: 0, y: 0 };
    this.viewDelta = zeroViewDelta();
    this.viewEngaged = false;
    this.settings = loadSettings();
    this.audioContext = null;
    this.paused = false;
    this.motionEnabled = false;
    this.cameraEnabled = false;
    this.cameraMotion = null;
    this.connectionState = "connecting";
    this.hapticsActive = false;
    this.destroyed = false;
    this.touchFallback = false;
    this.requiresContinue = false;
    this.bfcacheSuspended = false;
    this.lifecycleGeneration = 0;
    this.calibrationTimer = null;
    this.diagnostics = null;
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);
    this.handlePageShow = this.handlePageShow.bind(this);
  }

  mount() {
    this.root.innerHTML = `
      <main class="controller-shell">
        <header class="controller-header">
          <div class="connection-state" data-status="connecting">
            <span class="status-dot"></span>
            <i data-lucide="wifi"></i>
            <span id="connection-label">正在连接</span>
          </div>
          <strong class="room-code">${this.room || "------"}</strong>
        </header>

        <section class="play-surface" aria-label="游戏控制器">
          <div class="utility-controls">
            <button class="icon-button" id="settings" aria-label="设置"><i data-lucide="settings"></i></button>
          </div>

          <aside class="motion-diagnostics" id="motion-diagnostics" aria-label="体感诊断">
            <div class="aim-plot" aria-hidden="true">
              <span class="plot-axis plot-axis-x"></span>
              <span class="plot-axis plot-axis-y"></span>
              <span class="physical-aim-dot"></span>
              <span class="output-aim-dot"></span>
            </div>
          </aside>

          <div class="joystick-base" aria-hidden="true">
            <div class="joystick-ring"></div><div class="joystick-thumb"></div>
          </div>
        </section>

        <div class="permission-panel" id="permission-panel">
          <div class="permission-mark"><i data-lucide="rotate-ccw"></i></div>
          <p class="eyebrow">CORRIDOR 617</p>
          <h1 id="permission-title">连接电脑</h1>
          <p id="permission-copy">请从电脑屏幕扫描二维码进入。</p>
          <button class="primary-button" id="enable-motion" disabled>允许并开始</button>
        </div>

        <div class="pause-menu" id="settings-menu" hidden>
          <div class="pause-heading">
            <div><p class="eyebrow">控制设置</p><h2>设置</h2></div>
            <button class="icon-button" id="resume" aria-label="关闭设置"><i data-lucide="x"></i></button>
          </div>
          <label>体感灵敏度 <output id="sensitivity-value">${this.settings.sensitivity.toFixed(1)}</output>
            <input id="sensitivity" type="range" min="0.6" max="1.6" step="0.1" value="${this.settings.sensitivity}">
          </label>
          <label>转向平滑 <output id="smoothing-value">${Math.round(this.settings.smoothing * 100)}%</output>
            <input id="smoothing" type="range" min="0" max="1" step="0.01" value="${this.settings.smoothing}">
          </label>
          <button class="secondary-button" id="recenter" type="button"><i data-lucide="crosshair"></i><span>重新校准方向</span></button>
        </div>
      </main>`;

    createIcons({ icons, attrs: { "stroke-width": 1.8 } });
    this.cacheElements();
    this.bindControls();
    if (this.preview) {
      this.updateConnection("joined");
      this.permissionPanel.hidden = true;
    } else {
      this.connect();
    }
  }

  cacheElements() {
    this.status = this.root.querySelector(".connection-state");
    this.connectionLabel = this.root.querySelector("#connection-label");
    this.permissionPanel = this.root.querySelector("#permission-panel");
    this.permissionTitle = this.root.querySelector("#permission-title");
    this.permissionCopy = this.root.querySelector("#permission-copy");
    this.enableMotion = this.root.querySelector("#enable-motion");
    this.pauseMenu = this.root.querySelector("#settings-menu");
    this.playSurface = this.root.querySelector(".play-surface");
    this.diagnostics = new MotionDiagnostics(this.root.querySelector("#motion-diagnostics"));
  }

  bindControls() {
    this.joystick = new VirtualJoystick(this.playSurface, {
      onChange: (move) => {
        this.move = move;
        this.diagnostics.updateJoystick(move);
        this.sendInput({ immediate: true });
      },
      onEngagementChange: (engaged) => this.handleJoystickEngagement(engaged),
      onTap: () => {
        pulse();
        this.socket?.sendAction("interact");
      },
      onIgnoreTarget: (target) => Boolean(target?.closest?.("button, input, .pause-menu, .permission-panel")),
    });
    this.motion = new MotionController({
      onSample: (viewDelta) => this.handleMotionSample(viewDelta),
      onTelemetry: (telemetry) => this.diagnostics.updateSensor(telemetry),
      onState: (state) => this.handleMotionState(state),
    });
    this.haptics = new BraceHaptics();
    this.cameraMotion = new CameraMotionDetector({
      onPulse: () => this.handleCameraMotion(),
      onPresence: (presence) => this.handleCameraPresence(presence),
      onState: (state) => this.handleCameraState(state),
    });

    this.enableMotion.addEventListener("click", () => this.enableSensors());
    this.root.querySelector("#recenter").addEventListener("click", () => {
      pulse([10, 30, 10]);
      this.motion.reset();
      this.socket?.sendAction("recenter");
    });
    this.root.querySelector("#settings").addEventListener("click", () => this.setPaused(true));
    this.root.querySelector("#resume").addEventListener("click", () => this.setPaused(false));
    this.bindSettings();
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
  }

  connect() {
    if (!isRoomCode(this.room)) {
      this.updateConnection("invalid-room");
      return;
    }
    this.socket = new ControllerSocket({
      room: this.room,
      onStatus: (status) => this.updateConnection(status),
      onEvent: (event) => this.handleDesktopEvent(event),
      onTelemetry: (telemetry) => this.diagnostics.updateNetwork(telemetry),
    });
    this.socket.connect();
  }

  updateConnection(state) {
    const labels = {
      connecting: "正在连接",
      joined: "已连接",
      disconnected: "重新连接中",
      "connect-error": "网络不可用",
      "room-not-found": "房间已失效",
      "join-failed": "连接失败",
      replaced: "控制器已被替换",
      "session-ended": "电脑端已关闭",
      "invalid-room": "房间码无效",
    };
    this.connectionState = state;
    this.status.dataset.status = state;
    if (state === "joined" && !this.paused && !this.requiresContinue && !this.destroyed) {
      this.hapticsActive = true;
    } else if (state !== "joined") {
      this.hapticsActive = false;
      this.haptics?.stop();
    }
    if (state !== "joined") this.cameraMotion?.setFocused(false);
    this.connectionLabel.textContent = labels[state] ?? "等待连接";
    if (state === "joined") {
      this.permissionTitle.textContent = "启用手机控制";
      this.permissionCopy.textContent = "需要动作与前置摄像头权限；画面仅在本机分析。";
      this.enableMotion.disabled = false;
    } else if (["replaced", "session-ended", "invalid-room", "room-not-found"].includes(state)) {
      this.permissionPanel.hidden = false;
      this.permissionTitle.textContent = labels[state];
      this.permissionCopy.textContent = "请回到电脑端重新扫描二维码。";
      this.enableMotion.disabled = true;
    }
  }

  async enableSensors() {
    if (this.requiresContinue) {
      await this.continueAfterVisibility();
      return;
    }
    if (this.touchFallback) {
      this.continueWithTouchControls();
      return;
    }
    if (this.motionEnabled) {
      this.permissionPanel.hidden = true;
      this.socket?.sendAction("recenter");
      this.socket?.sendAction("resume");
      this.enableMotion.textContent = "允许并开始";
      pulse([15, 35, 15]);
      return;
    }
    this.enableMotion.disabled = true;
    this.permissionTitle.textContent = "正在校准";
    this.permissionCopy.textContent = "请保持当前姿势片刻；相机画面仅在本机分析。";
    this.ensureAudioContext();
    const [motionResult, cameraResult] = await Promise.all([
      Promise.resolve(this.motion.requestPermission()).catch(() => ({ motionGranted: false })),
      Promise.resolve(this.cameraMotion?.start?.()).catch(() => ({ cameraGranted: false })),
    ]);
    const { motionGranted } = motionResult ?? {};
    this.cameraEnabled = Boolean(cameraResult?.cameraGranted);
    if (!motionGranted) {
      this.enableMotion.disabled = false;
      return;
    }
    if (!this.cameraEnabled) {
      this.permissionCopy.textContent = "前置摄像头未启用，仍可使用短触操作。";
    }
    this.motionEnabled = true;
    this.calibrationTimer = window.setTimeout(() => {
      this.calibrationTimer = null;
      this.motion.reset();
      this.socket?.sendAction("recenter");
      this.socket?.sendAction("settings", { settings: this.settings });
      this.permissionPanel.hidden = true;
      pulse([15, 35, 15]);
    }, 420);
  }

  continueWithTouchControls() {
    this.touchFallback = false;
    this.permissionPanel.hidden = true;
    this.enableMotion.textContent = "允许并开始";
    this.motion.reset();
    this.socket?.sendAction("recenter");
    this.socket?.sendAction("resume");
    this.socket?.sendAction("settings", { settings: this.settings });
  }

  async continueAfterVisibility() {
    const generation = this.lifecycleGeneration;
    this.enableMotion.disabled = true;
    this.permissionTitle.textContent = "正在恢复";
    this.permissionCopy.textContent = "请保持当前姿势片刻。";
    await this.motion.resume();
    if (!this.isLifecycleCurrent(generation)) return;
    this.cameraMotion?.resume?.();
    this.motion.reset();
    this.viewDelta = zeroViewDelta();
    this.sendInput();
    this.socket?.sendAction("resume");
    this.socket?.sendAction("recenter");
    this.requiresContinue = false;
    this.hapticsActive = this.connectionState === "joined" && !this.destroyed;
    this.touchFallback = false;
    this.enableMotion.textContent = "允许并开始";
    this.permissionPanel.hidden = true;
  }

  handleMotionState(state) {
    const messages = {
      insecure: ["需要安全连接", "请使用电脑二维码提供的 HTTPS 地址。"],
      unsupported: ["无法启用体感", "请使用支持方向传感器的 Safari 或 Chrome。"],
      denied: ["体感权限未开启", "请在浏览器设置中允许动作与方向访问。"],
      reorienting: ["正在适配方向", "保持手机稳定。"],
    };
    if (state === "waiting" && this.motionEnabled && !this.requiresContinue) {
      this.motion.reset();
      this.socket?.sendAction("recenter");
      this.permissionPanel.hidden = true;
      return;
    }
    if (state === "reorienting") {
      this.viewEngaged = false;
      this.viewDelta = zeroViewDelta();
      this.socket?.clearPendingViewDelta?.();
      this.joystick?.reset();
      this.sendInput({ includeViewDelta: true, immediate: true });
      this.diagnostics?.updateEngagement(false);
      if (this.playSurface) this.playSurface.dataset.clutch = "off";
    }
    if (!messages[state]) return;
    this.permissionPanel.hidden = false;
    [this.permissionTitle.textContent, this.permissionCopy.textContent] = messages[state];
    this.enableMotion.disabled = state === "reorienting";
  }

  handleCameraState(state) {
    if (state === "denied" && this.motionEnabled && !this.requiresContinue) {
      this.permissionCopy.textContent = "前置摄像头不可用，仍可使用短触操作继续探索。";
    }
  }

  handleCameraMotion() {
    pulse([10, 24, 10]);
    this.socket?.sendAction("interact");
  }

  handleCameraPresence({ ready, active, context }) {
    this.socket?.sendAction("gesture-presence", { ready, active, context });
  }

  handleVisibility() {
    if (document.hidden) {
      this.suspendForBackground();
      return;
    }
    if (!this.motionEnabled || this.paused) return;
    this.showContinuePrompt();
  }

  suspendForBackground() {
    this.lifecycleGeneration += 1;
    this.hapticsActive = false;
    this.move = { x: 0, y: 0 };
    this.viewDelta = zeroViewDelta();
    this.viewEngaged = false;
    this.socket?.clearPendingViewDelta?.();
    this.joystick?.reset();
    this.sendInput({ includeViewDelta: true, immediate: true });
    this.motion?.suspend();
    this.cameraMotion?.suspend();
    this.haptics?.stop();
    this.socket?.sendAction("pause");
  }

  showContinuePrompt() {
    this.requiresContinue = true;
    this.touchFallback = false;
    this.permissionPanel.hidden = false;
    this.permissionTitle.textContent = "控制已暂停";
    this.permissionCopy.textContent = "继续前请重新确认手机方向。";
    this.enableMotion.textContent = "继续";
    this.enableMotion.disabled = false;
  }

  handlePageHide(event) {
    if (event?.persisted) {
      this.bfcacheSuspended = true;
      this.suspendForBackground();
      return;
    }
    this.destroy();
  }

  handlePageShow(event) {
    if (!this.bfcacheSuspended && !event?.persisted) return;
    this.bfcacheSuspended = false;
    if (this.motionEnabled && !this.paused) this.showContinuePrompt();
  }

  handleMotionSample(viewDelta) {
    this.viewDelta = viewDelta;
    this.diagnostics?.updateMotion(viewDelta);
    this.sendInput({ includeViewDelta: true, immediate: true });
  }

  handleJoystickEngagement(engaged) {
    this.viewDelta = zeroViewDelta();
    this.viewEngaged = Boolean(engaged);
    let active = false;
    if (engaged) {
      active = this.motion?.engage?.() === true;
      this.viewEngaged = active;
    } else {
      this.socket?.clearPendingViewDelta?.();
      this.motion?.disengage?.();
    }
    this.diagnostics?.updateEngagement(Boolean(active));
    if (this.playSurface) this.playSurface.dataset.clutch = active ? "on" : "off";
    this.sendInput({ includeViewDelta: true, immediate: true });
  }

  sendInput({ includeViewDelta = false, immediate = false } = {}) {
    const input = { move: this.move, clutch: this.viewEngaged };
    if (includeViewDelta) input.viewDelta = this.viewDelta;
    this.socket?.setInput(input, { immediate });
  }

  isLifecycleCurrent(generation) {
    return generation === this.lifecycleGeneration
      && !this.paused
      && (typeof document === "undefined" || !document.hidden);
  }

  async setPaused(paused) {
    this.paused = paused;
    this.pauseMenu.hidden = !paused;
    if (paused) {
      this.lifecycleGeneration += 1;
      this.hapticsActive = false;
      this.move = { x: 0, y: 0 };
      this.viewDelta = zeroViewDelta();
      this.viewEngaged = false;
      this.socket?.clearPendingViewDelta?.();
      this.joystick?.reset();
      this.sendInput();
      this.motion?.suspend();
      this.cameraMotion?.suspend();
      this.haptics?.stop();
      this.socket?.sendAction("pause");
      pulse();
      return;
    }

    this.hapticsActive = this.connectionState === "joined" && !this.destroyed;
    const generation = this.lifecycleGeneration;
    if (this.motionEnabled) {
      this.motion.resumeSensors();
      if (!this.isLifecycleCurrent(generation)) return;
      this.motion.reset();
      this.cameraMotion?.resume?.();
      this.viewDelta = zeroViewDelta();
      this.socket?.clearPendingViewDelta?.();
      this.sendInput();
    }
    this.socket?.sendAction("resume");
    pulse();
  }

  bindSettings() {
    const inputs = ["sensitivity", "smoothing"];
    for (const key of inputs) {
      this.root.querySelector(`#${key}`).addEventListener("input", (event) => {
        this.settings[key] = event.target.type === "checkbox" ? event.target.checked : Number(event.target.value);
        this.root.querySelector("#sensitivity-value").textContent = this.settings.sensitivity.toFixed(1);
        this.root.querySelector("#smoothing-value").textContent = `${Math.round(this.settings.smoothing * 100)}%`;
        localStorage.setItem("corridor617-settings", JSON.stringify(this.settings));
        this.socket?.sendAction("settings", { settings: this.settings });
      });
    }
  }

  handleDesktopEvent(event) {
    if (event.type === "target-focus") {
      this.cameraMotion?.setFocused(Boolean(event.id));
      return;
    }
    if (event.type === "control-feedback") {
      this.socket?.markApplied(event);
      return;
    }
    if (event.type === "gesture-mode") {
      this.cameraMotion?.setMode({ mode: event.mode, context: event.context, baseline: event.baseline });
      return;
    }
    if (event.type === "haptics") {
      if (!event.active || event.pattern !== "brace") this.haptics?.stop();
      else if (this.hapticsActive) this.haptics?.start();
    }
  }

  ensureAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && !this.audioContext) this.audioContext = new AudioContext();
    this.audioContext?.resume();
  }

  destroy() {
    this.lifecycleGeneration += 1;
    this.destroyed = true;
    this.hapticsActive = false;
    this.haptics?.stop();
    window.clearTimeout(this.calibrationTimer);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    this.joystick?.destroy();
    this.motion?.destroy();
    this.cameraMotion?.destroy();
    this.diagnostics?.destroy();
    this.socket?.destroy();
    this.audioContext?.close();
  }
}
