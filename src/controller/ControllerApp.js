import {
  createIcons,
  Crosshair,
  Flashlight,
  Hand,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Wifi,
  X,
} from "lucide";
import { isRoomCode } from "../shared/protocol.js";
import { ControllerSocket } from "./ControllerSocket.js";
import { MotionController } from "./MotionController.js";
import { MotionDiagnostics } from "./MotionDiagnostics.js";
import { VirtualJoystick } from "./VirtualJoystick.js";
import "./styles.css";

const icons = { Crosshair, Flashlight, Hand, Pause, Play, RotateCcw, Settings, Wifi, X };

const defaultSettings = {
  sensitivity: 1,
  smoothing: 0.55,
  invertY: false,
  reticle: true,
  reducedMotion: false,
  subtitles: true,
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem("corridor617-settings")) };
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
    this.settings = loadSettings();
    this.audioContext = null;
    this.paused = false;
    this.motionEnabled = false;
    this.touchFallback = false;
    this.requiresContinue = false;
    this.bfcacheSuspended = false;
    this.lifecycleGeneration = 0;
    this.calibrationTimer = null;
    this.tapCandidate = null;
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
            <button class="icon-button" id="recenter" aria-label="重新校准方向"><i data-lucide="crosshair"></i></button>
            <button class="icon-button" id="pause" aria-label="暂停"><i data-lucide="pause"></i></button>
          </div>

          <aside class="motion-diagnostics" id="motion-diagnostics" aria-label="体感诊断">
            <div class="aim-plot" aria-hidden="true">
              <span class="plot-axis plot-axis-x"></span>
              <span class="plot-axis plot-axis-y"></span>
              <span class="physical-aim-dot"></span>
              <span class="output-aim-dot"></span>
            </div>
            <dl class="telemetry-grid">
              <dt>RAW αβγ</dt><dd data-telemetry="raw">0 / 0 / 0</dd>
              <dt>AIM Y/P</dt><dd data-telemetry="aim">0 / 0</dd>
              <dt>OUT Y/P</dt><dd data-telemetry="output">0 / 0</dd>
              <dt>ROLL/F</dt><dd data-telemetry="roll">0 / 0%</dd>
              <dt>STICK</dt><dd data-telemetry="joystick">0 / 0</dd>
              <dt>SEND</dt><dd data-telemetry="rates">0 / 0 Hz</dd>
              <dt>NET</dt><dd data-telemetry="network">connecting · -- ms</dd>
              <dt>APPLY</dt><dd data-telemetry="applied">-- ms</dd>
              <dt>CAM Y/P</dt><dd data-telemetry="camera">0 / 0</dd>
            </dl>
          </aside>

          <div class="joystick-zone" id="joystick" aria-label="移动摇杆">
            <div class="joystick-base"><div class="joystick-ring"></div><div class="joystick-thumb"></div></div>
          </div>

          <div class="action-zone">
            <button class="action-button flashlight-button is-active" id="flashlight" aria-label="开关手电筒">
              <i data-lucide="flashlight"></i>
            </button>
            <button class="action-button interact-button" id="interact" aria-label="交互">
              <i data-lucide="hand"></i>
            </button>
          </div>
        </section>

        <div class="permission-panel" id="permission-panel">
          <div class="permission-mark"><i data-lucide="rotate-ccw"></i></div>
          <p class="eyebrow">CORRIDOR 617</p>
          <h1 id="permission-title">连接电脑</h1>
          <p id="permission-copy">请从电脑屏幕扫描二维码进入。</p>
          <button class="primary-button" id="enable-motion" disabled>启用体感</button>
        </div>

        <div class="private-message" id="private-message" hidden>
          <button class="message-close" aria-label="关闭"><i data-lucide="x"></i></button>
          <p>未知号码</p>
          <strong id="message-text">别回头</strong>
        </div>

        <div class="pause-menu" id="pause-menu" hidden>
          <div class="pause-heading">
            <div><p class="eyebrow">控制设置</p><h2>暂停</h2></div>
            <button class="icon-button" id="resume" aria-label="继续"><i data-lucide="play"></i></button>
          </div>
          <label>体感灵敏度 <output id="sensitivity-value">${this.settings.sensitivity.toFixed(1)}</output>
            <input id="sensitivity" type="range" min="0.6" max="1.6" step="0.1" value="${this.settings.sensitivity}">
          </label>
          <label>稳定强度 <output id="smoothing-value">${Math.round(this.settings.smoothing * 100)}%</output>
            <input id="smoothing" type="range" min="0" max="1" step="0.05" value="${this.settings.smoothing}">
          </label>
          <label class="toggle-row">反转纵向 <input id="invertY" type="checkbox" ${this.settings.invertY ? "checked" : ""}><span></span></label>
          <label class="toggle-row">准星 <input id="reticle" type="checkbox" ${this.settings.reticle ? "checked" : ""}><span></span></label>
          <label class="toggle-row">减少动态效果 <input id="reducedMotion" type="checkbox" ${this.settings.reducedMotion ? "checked" : ""}><span></span></label>
          <label class="toggle-row">字幕 <input id="subtitles" type="checkbox" ${this.settings.subtitles ? "checked" : ""}><span></span></label>
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
    this.pauseMenu = this.root.querySelector("#pause-menu");
    this.messagePanel = this.root.querySelector("#private-message");
    this.playSurface = this.root.querySelector(".play-surface");
    this.diagnostics = new MotionDiagnostics(this.root.querySelector("#motion-diagnostics"));
  }

  bindControls() {
    this.joystick = new VirtualJoystick(this.root.querySelector("#joystick"), {
      onChange: (move) => {
        this.move = move;
        this.diagnostics.updateJoystick(move);
        this.sendInput({ immediate: true });
      },
    });
    this.motion = new MotionController({
      onSample: (viewDelta) => this.handleMotionSample(viewDelta),
      onTelemetry: (telemetry) => this.diagnostics.updateSensor(telemetry),
      onState: (state) => this.handleMotionState(state),
      onInteract: () => {
        pulse([18, 36, 18]);
        this.socket?.sendAction("interact");
      },
    });

    this.enableMotion.addEventListener("click", () => this.enableSensors());
    this.root.querySelector("#interact").addEventListener("pointerdown", () => {
      pulse();
      this.socket?.sendAction("interact");
    });
    this.playSurface.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, #joystick")) {
        this.tapCandidate = null;
        return;
      }
      this.tapCandidate = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      };
    });
    this.playSurface.addEventListener("pointerup", (event) => {
      const candidate = this.tapCandidate;
      this.tapCandidate = null;
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      if (event.target.closest("button, #joystick")) return;
      const distance = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
      if (distance <= 14 && performance.now() - candidate.time <= 450) {
        pulse();
        this.socket?.sendAction("interact");
      }
    });
    this.playSurface.addEventListener("pointercancel", () => { this.tapCandidate = null; });
    this.root.querySelector("#flashlight").addEventListener("click", (event) => {
      event.currentTarget.classList.toggle("is-active");
      pulse();
      this.socket?.sendAction("flashlight");
    });
    this.root.querySelector("#recenter").addEventListener("click", () => {
      pulse([10, 30, 10]);
      this.motion.reset();
      this.socket?.sendAction("recenter");
    });
    this.root.querySelector("#pause").addEventListener("click", () => this.setPaused(true));
    this.root.querySelector("#resume").addEventListener("click", () => this.setPaused(false));
    this.root.querySelector(".message-close").addEventListener("click", () => {
      this.messagePanel.hidden = true;
    });
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
    this.status.dataset.status = state;
    this.connectionLabel.textContent = labels[state] ?? "等待连接";
    if (state === "joined") {
      this.permissionTitle.textContent = "握稳手机";
      this.permissionCopy.textContent = "保持自然姿势，再启用体感。";
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
      this.enableMotion.textContent = "启用体感";
      pulse([15, 35, 15]);
      return;
    }
    this.enableMotion.disabled = true;
    this.permissionTitle.textContent = "正在校准";
    this.permissionCopy.textContent = "请保持当前姿势片刻。";
    this.ensureAudioContext();
    const { motionGranted } = await this.motion.requestPermission();
    if (!motionGranted) {
      this.enableMotion.disabled = false;
      return;
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
    this.enableMotion.textContent = "启用体感";
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
    this.motion.reset();
    this.viewDelta = zeroViewDelta();
    this.sendInput();
    this.socket?.sendAction("resume");
    this.socket?.sendAction("recenter");
    this.requiresContinue = false;
    this.touchFallback = false;
    this.enableMotion.textContent = "启用体感";
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
    if (!messages[state]) return;
    this.permissionPanel.hidden = false;
    [this.permissionTitle.textContent, this.permissionCopy.textContent] = messages[state];
    this.enableMotion.disabled = state === "reorienting";
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
    this.move = { x: 0, y: 0 };
    this.viewDelta = zeroViewDelta();
    this.sendInput();
    this.motion?.suspend();
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

  sendInput({ includeViewDelta = false, immediate = false } = {}) {
    const input = { move: this.move };
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
      this.move = { x: 0, y: 0 };
      this.viewDelta = zeroViewDelta();
      this.socket?.clearPendingViewDelta?.();
      this.sendInput();
      this.motion?.suspend();
      this.socket?.sendAction("pause");
      pulse();
      return;
    }

    const generation = this.lifecycleGeneration;
    if (this.motionEnabled) {
      this.motion.resumeSensors();
      if (!this.isLifecycleCurrent(generation)) return;
      this.motion.reset();
      this.viewDelta = zeroViewDelta();
      this.socket?.clearPendingViewDelta?.();
      this.sendInput();
    }
    this.socket?.sendAction("resume");
    pulse();
  }

  bindSettings() {
    const inputs = ["sensitivity", "smoothing", "invertY", "reticle", "reducedMotion", "subtitles"];
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
    if (event.type === "control-feedback") {
      this.socket?.markApplied(event);
      return;
    }
    if (event.type !== "private-message") return;
    this.root.querySelector("#message-text").textContent = event.text ?? "别回头";
    this.messagePanel.hidden = false;
    pulse([120, 80, 120, 80, 220]);
    this.playRingtone();
  }

  ensureAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && !this.audioContext) this.audioContext = new AudioContext();
    this.audioContext?.resume();
  }

  playRingtone() {
    this.ensureAudioContext();
    if (!this.audioContext) return;
    const start = this.audioContext.currentTime;
    for (let index = 0; index < 4; index += 1) {
      const oscillator = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = index % 2 === 0 ? 620 : 780;
      gain.gain.setValueAtTime(0.0001, start + index * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.16, start + index * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.16 + 0.13);
      oscillator.connect(gain).connect(this.audioContext.destination);
      oscillator.start(start + index * 0.16);
      oscillator.stop(start + index * 0.16 + 0.14);
    }
  }

  destroy() {
    this.lifecycleGeneration += 1;
    window.clearTimeout(this.calibrationTimer);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    this.joystick?.destroy();
    this.motion?.destroy();
    this.diagnostics?.destroy();
    this.socket?.destroy();
    this.audioContext?.close();
  }
}
