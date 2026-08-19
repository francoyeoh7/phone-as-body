import {
  createIcons,
  Crosshair,
  ChevronLeft,
  ChevronRight,
  Mic,
  Presentation,
  RotateCcw,
  Settings,
  X,
} from "lucide";
import { MAX_VOICE_CLIP_BYTES, isRoomCode } from "../shared/protocol.js";
import { BraceHaptics } from "./BraceHaptics.js";
import { CameraMotionDetector } from "./CameraMotionDetector.js";
import { MediaPipeHandTracker } from "./MediaPipeHandTracker.js";
import { ControllerSocket } from "./ControllerSocket.js";
import { FoundPhoneUI } from "./FoundPhoneUI.js";
import { InventoryEdgeController } from "./InventoryEdgeController.js";
import { MotionController } from "./MotionController.js";
import { MotionDiagnostics } from "./MotionDiagnostics.js";
import { PointerOwnership } from "./PointerOwnership.js";
import { pcm16FramesToWav } from "./PcmVoiceStreamer.js";
import { VirtualJoystick } from "./VirtualJoystick.js";
import { VoiceHoldController } from "./VoiceHoldController.js";
import { BrowserVoiceRecognizer } from "./BrowserVoiceRecognizer.js";
import "./styles.css";

const icons = { ChevronLeft, ChevronRight, Crosshair, Mic, Presentation, RotateCcw, Settings, X };

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

export function controllerShellMarkup(_room, settings = defaultSettings) {
  return `
    <main class="controller-shell">
      <section class="play-surface" aria-label="游戏控制器">
        <div class="utility-controls">
          <button class="icon-button" id="settings" aria-label="设置"><i data-lucide="settings"></i></button>
        </div>

        <div class="inventory-edge" id="inventory-edge" aria-hidden="true"></div>

        <aside class="motion-diagnostics" id="motion-diagnostics" aria-hidden="true" hidden>
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

      <button class="voice-hold" id="voice-hold" type="button" aria-label="按住录音" data-active="false" data-state="idle">
        <i data-lucide="mic"></i>
        <span class="voice-copy">
          <strong id="voice-label">按住说话</strong>
          <small id="voice-status" aria-live="polite">松开发送</small>
        </span>
      </button>

      <div class="permission-panel" id="permission-panel">
        <div class="permission-mark"><i data-lucide="rotate-ccw"></i></div>
        <p class="eyebrow">手机即身体</p>
        <h1 id="permission-title">连接电脑</h1>
        <p id="permission-copy">请从电脑屏幕扫描二维码进入。</p>
        <button class="primary-button" id="enable-motion" disabled>允许并开始</button>
      </div>

      <div class="pause-menu" id="settings-menu" hidden>
        <div class="pause-heading">
          <div><p class="eyebrow">控制设置</p><h2>设置</h2></div>
          <button class="icon-button" id="resume" aria-label="关闭设置"><i data-lucide="x"></i></button>
        </div>
        <label>体感灵敏度 <output id="sensitivity-value">${settings.sensitivity.toFixed(1)}</output>
          <input id="sensitivity" type="range" min="0.6" max="1.6" step="0.1" value="${settings.sensitivity}">
        </label>
        <label>转向平滑 <output id="smoothing-value">${Math.round(settings.smoothing * 100)}%</output>
          <input id="smoothing" type="range" min="0" max="1" step="0.01" value="${settings.smoothing}">
        </label>
        <button class="secondary-button" id="recenter" type="button"><i data-lucide="crosshair"></i><span>重新校准方向</span></button>
        <button class="secondary-button presentation-launch" id="presentation-open" type="button"><i data-lucide="presentation"></i><span>PPT</span></button>
      </div>

      <section class="presentation-controls" id="presentation-controls" hidden aria-label="PPT 控制">
        <button class="presentation-control" id="presentation-prev" type="button" aria-label="上一页"><i data-lucide="chevron-left"></i></button>
        <span id="presentation-controller-page" aria-live="polite">1 / 1</span>
        <button class="presentation-control" id="presentation-next" type="button" aria-label="下一页"><i data-lucide="chevron-right"></i></button>
        <button class="presentation-control presentation-exit" id="presentation-close" type="button" aria-label="退出 PPT"><i data-lucide="x"></i></button>
      </section>
    </main>

    <section class="found-phone-ui" id="found-phone-ui" aria-label="拾获的手机" hidden>
      <div class="found-phone-chassis">
        <div class="found-phone-speaker" aria-hidden="true"></div>
        <header class="found-phone-header">
          <span class="found-phone-status">617</span>
          <span data-phone-page aria-live="polite"></span>
        </header>
        <div class="found-phone-content" aria-live="polite">
          <p class="found-phone-kind">已恢复资料</p>
          <h2 data-phone-title></h2>
          <p data-phone-body></p>
        </div>
        <footer class="found-phone-footer">
          <button class="found-phone-nav" data-phone-previous type="button" aria-label="上一页"><i data-lucide="chevron-left"></i></button>
          <span>向左或向右翻阅</span>
          <button class="found-phone-nav" data-phone-next type="button" aria-label="下一页"><i data-lucide="chevron-right"></i></button>
        </footer>
      </div>
    </section>`;
}

export class ControllerApp {
  constructor(root) {
    this.root = root;
    const parameters = new URLSearchParams(location.search);
    this.room = parameters.get("room") ?? "";
    this.preview = import.meta.env.DEV && parameters.has("preview");
    this.move = { x: 0, y: 0 };
    this.crouching = false;
    this.viewDelta = zeroViewDelta();
    this.viewEngaged = false;
    this.settings = loadSettings();
    this.audioContext = null;
    this.paused = false;
    this.motionEnabled = false;
    this.cameraEnabled = false;
    this.handTaskContext = null;
    this.handTrackingState = "idle";
    this.presentationActive = false;
    this.doorFallbackHolding = false;
    this.voiceRecognizer = null;
    this.voiceRecognitionStarted = false;
    this.fetchImpl = globalThis.fetch?.bind(globalThis) ?? null;
    this.voicePcmFrames = [];
    this.voicePcmBytes = 0;
    this.voicePcmTranscriptPromise = null;
    this.pointerOwners = new PointerOwnership();
    this.gameplayClaimGeneration = null;
    this.cameraMotion = null;
    this.handTracker = null;
    this.connectionState = "connecting";
    this.hapticsActive = false;
    this.foreground = true;
    this.destroyed = false;
    this.requiresContinue = false;
    this.bfcacheSuspended = false;
    this.lifecycleGeneration = 0;
    this.calibrationTimer = null;
    this.braceFallbackTimer = null;
    this.diagnostics = null;
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);
    this.handlePageShow = this.handlePageShow.bind(this);
  }

  mount() {
    this.root.innerHTML = controllerShellMarkup(this.room, this.settings);

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
    this.inventoryRegion = this.root.querySelector("#inventory-edge");
    this.voiceRegion = this.root.querySelector("#voice-hold");
    this.voiceLabel = this.root.querySelector("#voice-label");
    this.voiceStatus = this.root.querySelector("#voice-status");
    this.presentationControls = this.root.querySelector("#presentation-controls");
    this.presentationPage = this.root.querySelector("#presentation-controller-page");
    this.presentationPrevious = this.root.querySelector("#presentation-prev");
    this.presentationNext = this.root.querySelector("#presentation-next");
    this.presentationClose = this.root.querySelector("#presentation-close");
    this.foundPhoneUI = new FoundPhoneUI(this.root.querySelector("#found-phone-ui"));
    this.diagnostics = new MotionDiagnostics(this.root.querySelector("#motion-diagnostics"));
  }

  bindControls() {
    this.joystick = new VirtualJoystick(this.playSurface, {
      onChange: (move) => {
        if (this.usesDoorFallbackHold()) {
          this.move = { x: 0, y: 0 };
          return;
        }
        this.move = move;
        this.diagnostics.updateJoystick(move);
        this.sendInput({ immediate: true });
      },
      onEngagementChange: (engaged) => this.handleJoystickEngagement(engaged),
      canStart: (event) => this.claimGameplayPointer(event),
      onReset: (pointerId) => this.releaseGameplayPointer(pointerId),
      isBottomPoint: (point) => this.isBottomPoint(point),
      isCrouching: () => this.crouching,
      onCrouchChange: (active) => this.handleCrouchChange(active),
      onTap: () => {
        pulse();
        this.socket?.sendAction("interact");
      },
      onIgnoreTarget: (target) => Boolean(target?.closest?.("button, input, .pause-menu, .permission-panel, .found-phone-ui, .voice-hold")),
    });
    this.motion = new MotionController({
      onSample: (viewDelta) => this.handleMotionSample(viewDelta),
      onTelemetry: (telemetry) => this.diagnostics.updateSensor(telemetry),
      onState: (state) => this.handleMotionState(state),
    });
    this.haptics = new BraceHaptics({ onFallbackPulse: () => this.pulseBraceFallback() });
    this.cameraMotion = new CameraMotionDetector({
      onPulse: () => this.handleCameraMotion(),
      onPresence: (presence) => this.handleCameraPresence(presence),
      onState: (state) => this.handleCameraState(state),
    });
    this.handTracker = new MediaPipeHandTracker({
      getVideo: () => this.cameraMotion?.getVideoElement?.() ?? null,
      onFrame: (frame) => this.socket?.sendHandFrame?.(frame),
      onState: (state) => this.handleHandTrackingState(state),
      inputMirrored: true,
    });
    this.voiceHold = new VoiceHoldController({
      ownership: this.pointerOwners,
      isInRegion: (event) => this.isVoicePoint(event),
      onActive: (active) => this.handleVoiceActive(active),
      onPressState: (state) => this.handleVoicePressState(state),
      onClip: (clip) => this.handleVoiceClip(clip),
      onStreamFrame: (frame) => this.handleVoiceStreamFrame(frame),
    });
    this.voiceRecognizer = new BrowserVoiceRecognizer({
      onResult: (result) => this.handleBrowserVoiceResult(result),
      onError: (error) => this.handleVoiceRecognitionError(error),
    });
    this.voicePointerHandlers = {
      pointerdown: (event) => this.voiceHold.pointerDown(event),
      pointermove: (event) => this.voiceHold.pointerMove(event),
      pointerleave: (event) => this.voiceHold.pointerLeave(event),
      pointerup: (event) => this.voiceHold.pointerUp(event),
      pointercancel: (event) => this.voiceHold.pointerCancel(event),
      lostpointercapture: (event) => this.voiceHold.pointerCaptureLost(event),
    };
    for (const [type, handler] of Object.entries(this.voicePointerHandlers)) {
      this.voiceRegion.addEventListener(type, handler);
    }
    this.inventoryEdge = new InventoryEdgeController(this.inventoryRegion, {
      ownership: this.pointerOwners,
      canOpen: () => this.canOpenInventory(),
      onClaim: () => this.handleInventoryClaim(),
      onOpen: (detail) => this.sendInventoryPointer("open", detail),
      onMove: (delta) => this.sendInventoryPointer("move", delta),
      onCommit: () => this.sendInventoryPointer("commit"),
      onCancel: () => this.sendInventoryPointer("cancel"),
      onRelease: () => this.handleInventoryRelease(),
    });
    this.bindInventoryPointerCapture();

    this.enableMotion.addEventListener("click", () => this.enableSensors());
    this.root.querySelector("#recenter").addEventListener("click", () => {
      pulse([10, 30, 10]);
      this.motion.reset();
      this.socket?.sendAction("recenter");
    });
    this.root.querySelector("#settings").addEventListener("click", () => this.setPaused(true));
    this.root.querySelector("#resume").addEventListener("click", () => this.setPaused(false));
    this.root.querySelector("#presentation-open").addEventListener("click", () => {
      pulse([12, 24, 12]);
      this.setPaused(false);
      this.setPresentationControls({ active: true, index: 0, total: 13 });
      this.socket?.sendAction("presentation-open", { source: "settings" });
    });
    this.presentationPrevious.addEventListener("click", () => {
      pulse(8);
      this.socket?.sendAction("presentation-prev");
    });
    this.presentationNext.addEventListener("click", () => {
      pulse(8);
      this.socket?.sendAction("presentation-next");
    });
    this.presentationClose.addEventListener("click", () => {
      pulse([12, 24, 12]);
      this.setPresentationControls({ active: false });
      this.socket?.sendAction("presentation-close");
    });
    this.bindSettings();
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
  }

  bindInventoryPointerCapture() {
    this.inventoryPointerHandlers = {
      pointerdown: (event) => this.inventoryEdge.pointerDown(event),
      pointermove: (event) => this.inventoryEdge.pointerMove(event),
      pointerup: (event) => this.inventoryEdge.pointerUp(event),
      pointercancel: (event) => this.inventoryEdge.pointerCancel(event),
      lostpointercapture: (event) => this.inventoryEdge.pointerCaptureLost(event),
    };
    for (const [type, handler] of Object.entries(this.inventoryPointerHandlers)) {
      this.root.addEventListener(type, handler, true);
    }
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
      "invalid-room": "请扫描电脑端二维码",
    };
    this.connectionState = state;
    if (this.status) this.status.dataset.status = state;
    if (state === "joined" && this.foreground && !this.paused && !this.requiresContinue && !this.destroyed) {
      this.hapticsActive = true;
    } else if (state !== "joined") {
      this.hapticsActive = false;
      this.haptics?.stop();
      this.foundPhoneUI?.setActive(false);
    }
    if (state !== "joined") {
      this.cancelTransientControls(`connection:${state}`);
      this.cameraMotion?.setMode({ mode: "pulse", context: null, baseline: "fresh" });
      this.cameraMotion?.setFocused(false);
    }
    if (this.connectionLabel) this.connectionLabel.textContent = labels[state] ?? "等待连接";
    if (state === "joined") {
      this.permissionTitle.textContent = "启用手机控制";
      this.permissionCopy.textContent = "需要动作与后置摄像头权限；画面仅在本机分析。";
      this.enableMotion.disabled = false;
      if (!this.motionEnabled) {
        this.hapticsActive = false;
        this.permissionPanel.hidden = false;
        this.socket?.sendAction("pause");
      }
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
    if (this.motionEnabled) {
      this.permissionPanel.hidden = true;
      this.socket?.sendAction("recenter");
      this.socket?.sendAction("resume");
      this.enableMotion.textContent = "允许并开始";
      pulse([15, 35, 15]);
      return;
    }
    this.enableMotion.disabled = true;
    const generation = this.lifecycleGeneration;
    this.permissionTitle.textContent = "正在校准";
    this.permissionCopy.textContent = "请保持当前姿势片刻；相机画面仅在本机分析。";
    this.ensureAudioContext();
    const [motionResult, cameraResult] = await Promise.all([
      Promise.resolve(this.motion.requestPermission()).catch(() => ({ motionGranted: false })),
      Promise.resolve(this.cameraMotion?.start?.()).catch(() => ({ cameraGranted: false })),
    ]);
    const { motionGranted } = motionResult ?? {};
    if (this.destroyed) return;
    if (generation !== this.lifecycleGeneration) {
      this.cameraMotion?.suspend?.();
      this.handTracker?.suspend?.();
      this.permissionPanel.hidden = false;
      this.permissionTitle.textContent = "控制已暂停";
      this.permissionCopy.textContent = "返回页面后，请重新确认动作与后置摄像头权限。";
      this.enableMotion.textContent = "重新启用";
      this.enableMotion.disabled = false;
      return;
    }
    this.cameraEnabled = Boolean(cameraResult?.cameraGranted);
    if (!motionGranted) {
      this.cameraMotion?.suspend?.();
      this.handTracker?.suspend?.();
      this.motionEnabled = false;
      this.hapticsActive = false;
      this.permissionPanel.hidden = false;
      this.permissionTitle.textContent = "必须启用陀螺仪";
      this.permissionCopy.textContent = "请允许动作与方向访问后重新授权；未授权时无法进入游戏。";
      this.enableMotion.textContent = "重新授权";
      this.enableMotion.disabled = false;
      this.socket?.sendAction("pause");
      return;
    }
    if (!this.cameraEnabled) {
      this.handTrackingState = "fallback";
      this.permissionCopy.textContent = "后置摄像头未启用，仍可使用短触操作。";
    }
    this.motionEnabled = true;
    this.foreground = true;
    this.hapticsActive = this.connectionState === "joined" && !this.destroyed;
    this.socket?.sendAction("resume");
    if (this.cameraEnabled) {
      this.cameraMotion?.resume?.();
      Promise.resolve(this.handTracker?.setTask?.({ active: true })).catch(() => {});
    }
    this.handTracker?.resume?.();
    this.calibrationTimer = window.setTimeout(() => {
      this.calibrationTimer = null;
      this.motion.reset();
      this.socket?.sendAction("recenter");
      this.socket?.sendAction("settings", { settings: this.settings });
      this.permissionPanel.hidden = true;
      pulse([15, 35, 15]);
    }, 420);
  }

  async continueAfterVisibility() {
    const generation = this.lifecycleGeneration;
    this.enableMotion.disabled = true;
    this.permissionTitle.textContent = "正在恢复";
    this.permissionCopy.textContent = "请保持当前姿势片刻。";
    await this.motion.resume();
    if (!this.isLifecycleCurrent(generation)) return;
    this.cameraMotion?.resume?.();
    this.handTracker?.resume?.();
    this.motion.reset();
    this.viewDelta = zeroViewDelta();
    this.sendInput();
    this.socket?.sendAction("resume");
    this.socket?.sendAction("recenter");
    this.requiresContinue = false;
    this.foreground = true;
    this.hapticsActive = this.connectionState === "joined" && !this.destroyed;
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
      this.cancelTransientControls("motion:reorienting");
    }
    if (!messages[state]) return;
    this.permissionPanel.hidden = false;
    [this.permissionTitle.textContent, this.permissionCopy.textContent] = messages[state];
    this.enableMotion.disabled = state === "reorienting";
  }

  handleCameraState(state) {
    if (state === "capture-error") this.cancelTransientControls("camera:capture-error");
    if (state === "denied" && this.motionEnabled && !this.requiresContinue) {
      this.permissionCopy.textContent = "后置摄像头不可用，仍可使用短触操作继续探索。";
    }
  }

  handleHandTrackingState(state) {
    this.handTrackingState = state;
    if (this.usesDoorFallbackHold()) this.clearCrouch({ immediate: true });
    if (this.playSurface) this.playSurface.dataset.hand = state;
  }

  handleCameraMotion() {
    // Pixel motion is diagnostic only. Semantic interactions come from hand poses or touch.
  }

  handleCameraPresence() {}

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
    this.foreground = false;
    this.hapticsActive = false;
    this.cancelTransientControls("background");
    this.motion?.suspend();
    this.cameraMotion?.suspend();
    this.handTracker?.suspend?.();
    this.haptics?.stop();
    this.foundPhoneUI?.setActive(false);
    this.socket?.sendAction("pause");
  }

  showContinuePrompt() {
    this.requiresContinue = true;
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
    if (this.usesDoorFallbackHold()) {
      this.clearCrouch({ immediate: true });
      this.viewEngaged = false;
      this.doorFallbackHolding = Boolean(engaged);
      this.socket?.sendAction("task-hold", {
        context: "door-defense",
        active: this.doorFallbackHolding,
      });
      return;
    }
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

  usesDoorFallbackHold() {
    return this.doorFallbackHolding || (this.handTaskContext === "door-defense"
      && (!this.cameraEnabled || this.handTrackingState === "fallback"));
  }

  claimGameplayPointer(event) {
    if (!this.pointerOwners?.claimGameplay?.(event.pointerId)) return false;
    this.gameplayClaimGeneration = this.pointerOwners.generation;
    return true;
  }

  releaseGameplayPointer(pointerId) {
    const generation = this.gameplayClaimGeneration;
    this.gameplayClaimGeneration = null;
    if (Number.isInteger(generation)) this.pointerOwners?.release?.("gameplay", pointerId, generation);
  }

  cancelPointerOwnership() {
    (this.inventoryEdge ?? this.inventoryOrb)?.cancel?.();
    this.voiceHold?.cancel({ discard: true });
    this.gameplayClaimGeneration = null;
    this.pointerOwners?.cancelAll?.();
  }

  cancelTransientControls(reason = "unspecified") {
    this.lastTransientCancelReason = reason;
    this.cancelPointerOwnership();
    this.move = { x: 0, y: 0 };
    this.clearCrouch();
    this.viewDelta = zeroViewDelta();
    this.viewEngaged = false;
    this.socket?.clearPendingViewDelta?.();
    this.motion?.disengage?.();
    this.joystick?.reset?.();
    this.diagnostics?.updateEngagement?.(false);
    if (this.playSurface) this.playSurface.dataset.clutch = "off";
    window.clearTimeout(this.calibrationTimer);
    window.clearTimeout(this.braceFallbackTimer);
    this.calibrationTimer = null;
    this.braceFallbackTimer = null;
    this.playSurface?.classList?.remove?.("brace-impact");
    this.sendInput({ includeViewDelta: true, immediate: true });
  }

  canOpenInventory() {
    return Boolean(
      (this.motionEnabled || this.preview)
      && this.foreground
      && !this.paused
      && !this.requiresContinue
      && !this.destroyed
      && this.connectionState === "joined"
      && this.foundPhoneUI?.element?.hidden !== false
    );
  }

  handleInventoryClaim() {
    this.voiceHold?.cancel({ discard: true });
    this.gameplayClaimGeneration = null;
    this.move = { x: 0, y: 0 };
    this.clearCrouch();
    this.viewDelta = zeroViewDelta();
    this.viewEngaged = false;
    this.socket?.clearPendingViewDelta?.();
    this.motion?.disengage?.();
    this.handTracker?.suspend?.();
    this.joystick?.reset();
    this.diagnostics?.updateEngagement(false);
    if (this.playSurface) this.playSurface.dataset.clutch = "off";
    this.sendInput({ includeViewDelta: true, immediate: true });
  }

  handleInventoryRelease() {
    if (!this.destroyed && this.foreground && !this.paused && this.cameraEnabled) {
      this.handTracker?.resume?.();
    }
  }

  sendInventoryPointer(phase, delta = {}) {
    const detail = phase === "move"
      ? { phase, dx: delta.dx, dy: delta.dy }
      : phase === "open" && Number.isFinite(delta.entryY)
        ? { phase, entryY: delta.entryY }
        : { phase };
    this.socket?.sendAction("inventory-pointer", detail);
  }

  isVoicePoint({ clientX, clientY }) {
    const bounds = this.voiceRegion?.getBoundingClientRect?.();
    if (bounds?.width > 0 && bounds?.height > 0) {
      return clientX >= bounds.left && clientX <= bounds.right
        && clientY >= bounds.top && clientY <= bounds.bottom;
    }
    return this.isBottomPoint({ y: clientY });
  }

  handleVoiceActive(active) {
    if (this.voiceRegion) this.voiceRegion.dataset.active = String(Boolean(active));
    this.socket?.sendAction("voice-recording", { active: Boolean(active) });
    if (active) this.startVoiceRecognition();
    else this.stopVoiceRecognition();
  }

  handleVoicePressState(state) {
    if (state === "pressed") {
      // Keep this call inside pointerdown's user-activation task. iOS Safari
      // rejects SpeechRecognition.start() when it is delayed until permission
      // or the recording dwell promise resolves.
      this.startVoiceRecognition();
      pulse(8);
    } else if (state === "error") {
      this.stopVoiceRecognition({ cancel: true });
    } else if (state === "idle") {
      this.stopVoiceRecognition();
    }
    if (!this.voiceRegion) return;
    this.voiceRegion.dataset.state = state;
    if (state !== "recording") this.voiceRegion.dataset.active = "false";
    const labels = {
      idle: ["按住说话", "松开发送"],
      pressed: ["继续按住", "正在准备麦克风"],
      recording: ["正在录音", "说完后松开"],
      error: ["麦克风不可用", "检查浏览器权限"],
    };
    const [label, status] = labels[state] ?? labels.idle;
    if (this.voiceLabel) this.voiceLabel.textContent = label;
    if (this.voiceStatus) this.voiceStatus.textContent = status;
  }

  startVoiceRecognition() {
    if (this.voiceRecognitionStarted) return true;
    const started = this.voiceRecognizer?.start?.() === true;
    this.voiceRecognitionStarted = started;
    return started;
  }

  handleBrowserVoiceResult(result) {
    const transcript = String(result?.transcript ?? "").trim();
    if (!transcript) return false;
    const payload = {
      transcript,
      confidence: Number.isFinite(result.confidence) ? result.confidence : 0.5,
      voiceLevel: Number.isFinite(result.voiceLevel) ? result.voiceLevel : 0.7,
      interim: result.interim === true,
    };
    this.socket?.sendAction("voice-transcript", payload);
    if (this.voiceStatus) this.voiceStatus.textContent = payload.interim ? "实时识别中" : "已识别";
    return true;
  }

  stopVoiceRecognition({ cancel = false } = {}) {
    if (!this.voiceRecognitionStarted) return false;
    this.voiceRecognitionStarted = false;
    return cancel
      ? this.voiceRecognizer?.cancel?.() === true
      : this.voiceRecognizer?.stop?.() === true;
  }

  handleVoiceRecognitionError(error) {
    this.stopVoiceRecognition({ cancel: true });
    if (this.voiceRegion) {
      // Browser speech recognition is only a low-latency helper. The held
      // MediaRecorder clip remains authoritative and is transcribed by the
      // server after release, so a Safari/Chrome recognition error must not
      // turn the microphone control into a failed state.
      this.voiceRegion.dataset.recognition = "fallback";
      this.voiceRegion.dataset.error = String(error?.error ?? error?.message ?? "recognition-error");
    }
  }

  async handleVoiceClip(clip) {
    const pcmTranscript = this.voicePcmTranscriptPromise;
    this.voicePcmTranscriptPromise = null;
    if (pcmTranscript && await pcmTranscript) return true;
    return this.submitVoiceClip(clip);
  }

  async submitVoiceClip(clip, { fallbackToSocket = true } = {}) {
    const fallback = () => {
      if (fallbackToSocket) this.socket?.sendVoiceClip?.(clip);
      return false;
    };
    let request;
    try {
      request = this.fetchImpl?.("/api/npc/transcribe", {
        method: "POST",
        headers: { "Content-Type": clip?.mimeType || "audio/webm" },
        body: clip?.data,
      });
    } catch {
      return fallback();
    }
    if (!request || typeof request.then !== "function") return fallback();
    try {
      if (this.voiceRegion) this.voiceRegion.dataset.recognition = "transcribing";
      if (this.voiceStatus) this.voiceStatus.textContent = "正在识别";
      const response = await request;
      if (!response?.ok) return fallback();
      const result = await response.json();
      const transcript = String(result?.transcript ?? "").trim();
      if (!transcript) return fallback();
      const payload = {
        transcript,
        confidence: Number.isFinite(result?.confidence) ? result.confidence : 0.9,
        voiceLevel: Number.isFinite(result?.voiceLevel) ? result.voiceLevel : 0.6,
      };
      this.socket?.sendAction("voice-transcript", payload);
      if (this.voiceRegion) this.voiceRegion.dataset.recognition = "complete";
      if (this.voiceStatus) this.voiceStatus.textContent = "已发送";
      return true;
    } catch {
      if (this.voiceRegion) this.voiceRegion.dataset.recognition = "fallback";
      if (this.voiceStatus) this.voiceStatus.textContent = "识别失败，请重试";
      return fallback();
    }
  }

  handleVoiceStreamFrame(frame) {
    this.socket?.sendVoiceFrame?.(frame);
    if (frame?.type === "voice-start") {
      this.voicePcmFrames = [];
      this.voicePcmBytes = 0;
      this.voicePcmTranscriptPromise = null;
      return;
    }
    if (frame instanceof ArrayBuffer || ArrayBuffer.isView(frame)) {
      const bytes = frame instanceof ArrayBuffer
        ? new Uint8Array(frame)
        : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
      if (bytes.byteLength > 0 && bytes.byteLength % 2 === 0
        && this.voicePcmBytes + bytes.byteLength <= MAX_VOICE_CLIP_BYTES - 44) {
        const copy = bytes.slice().buffer;
        this.voicePcmFrames.push(copy);
        this.voicePcmBytes += bytes.byteLength;
      }
      return;
    }
    if (frame?.type === "voice-stop" && this.voicePcmBytes > 0) {
      const wav = pcm16FramesToWav(this.voicePcmFrames, 24_000);
      this.voicePcmFrames = [];
      this.voicePcmBytes = 0;
      this.voicePcmTranscriptPromise = this.submitVoiceClip({ mimeType: "audio/wav", data: wav }, {
        fallbackToSocket: false,
      });
    }
  }

  isBottomPoint({ y }) {
    const height = window.innerHeight || document.documentElement?.clientHeight || 0;
    const bottomRegionHeight = Math.min(96, Math.max(68, height * 0.12));
    return !this.usesDoorFallbackHold() && y >= height - bottomRegionHeight;
  }

  handleCrouchChange(active) {
    const crouching = Boolean(active) && !this.usesDoorFallbackHold();
    if (crouching === this.crouching) return;
    this.crouching = crouching;
    if (crouching) this.move = { x: 0, y: 0 };
    this.sendInput({ immediate: true });
  }

  clearCrouch({ immediate = false } = {}) {
    if (!this.crouching) return false;
    this.crouching = false;
    if (immediate) this.sendInput({ immediate: true });
    return true;
  }

  sendInput({ includeViewDelta = false, immediate = false } = {}) {
    const input = {
      move: this.move,
      clutch: this.viewEngaged,
      crouch: Boolean(this.crouching) && !this.usesDoorFallbackHold(),
    };
    if (includeViewDelta) input.viewDelta = this.viewDelta;
    this.socket?.setInput?.(input, { immediate });
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
      this.cancelTransientControls("pause");
      this.motion?.suspend();
      this.cameraMotion?.suspend();
      this.handTracker?.suspend?.();
      this.haptics?.stop();
      this.foundPhoneUI?.setActive(false);
      this.socket?.sendAction("pause");
      pulse();
      return;
    }

    this.hapticsActive = this.foreground && this.connectionState === "joined" && !this.destroyed;
    const generation = this.lifecycleGeneration;
    if (this.motionEnabled) {
      this.motion.resumeSensors();
      if (!this.isLifecycleCurrent(generation)) return;
      this.motion.reset();
      this.cameraMotion?.resume?.();
      this.handTracker?.resume?.();
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

  setPresentationControls({ active = false, index = 0, total = 0 } = {}) {
    this.presentationActive = Boolean(active);
    if (!this.presentationControls) return;
    this.presentationControls.hidden = !this.presentationActive;
    if (!this.presentationActive) return;
    const count = Math.max(1, Number(total) || 1);
    const page = Math.min(count - 1, Math.max(0, Number(index) || 0));
    this.presentationPage.textContent = `${page + 1} / ${count}`;
    const canCycle = count > 1;
    this.presentationPrevious.disabled = !canCycle;
    this.presentationNext.disabled = !canCycle;
  }

  handleDesktopEvent(event) {
    if (event.type === "presentation-state") {
      this.setPresentationControls(event);
      return;
    }
    if (event.type === "hand-task") {
      if (!event.active && this.doorFallbackHolding) {
        this.socket?.sendAction("task-hold", { context: "door-defense", active: false });
        this.doorFallbackHolding = false;
      }
      this.handTaskContext = event.active ? event.context : null;
      if (this.usesDoorFallbackHold()) this.clearCrouch({ immediate: true });
      if (this.playSurface) this.playSurface.dataset.handTask = this.handTaskContext ?? "off";
      return;
    }
    if (event.type === "target-focus") {
      this.cameraMotion?.setFocused(Boolean(event.id));
      return;
    }
    if (event.type === "control-feedback") {
      this.socket?.markApplied(event);
      return;
    }
    if (event.type === "gesture-mode") {
      this.cameraMotion?.setMode({ mode: "pulse", context: null, baseline: "fresh" });
      return;
    }
    if (event.type === "haptics") {
      if (!event.active || event.pattern !== "brace") this.haptics?.stop();
      else if (this.hapticsActive && this.foundPhoneUI?.element?.hidden !== false) this.haptics?.start();
      return;
    }
    if (event.type === "found-phone-ui") {
      const canActivate = this.foreground
        && !this.paused
        && !this.requiresContinue
        && !this.destroyed
        && this.connectionState === "joined";
      const active = Boolean(event.active) && canActivate;
      this.foundPhoneUI?.setActive(active);
      this.haptics?.stop();
    }
  }

  ensureAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext && !this.audioContext) this.audioContext = new AudioContext();
    this.audioContext?.resume();
  }

  pulseBraceFallback() {
    const surface = this.playSurface;
    surface?.classList?.remove("brace-impact");
    void surface?.offsetWidth;
    surface?.classList?.add("brace-impact");
    window.clearTimeout(this.braceFallbackTimer);
    this.braceFallbackTimer = window.setTimeout(() => {
      this.braceFallbackTimer = null;
      surface?.classList?.remove("brace-impact");
    }, 180);

    const context = this.audioContext;
    if (!context?.createOscillator || !context?.createGain) return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(72, now);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.08);
    } catch {
      // Visual impact remains available when Web Audio cannot start.
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.lifecycleGeneration += 1;
    this.destroyed = true;
    this.hapticsActive = false;
    this.cancelTransientControls("destroy");
    this.haptics?.stop();
    this.foundPhoneUI?.setActive(false);
    for (const [type, handler] of Object.entries(this.voicePointerHandlers ?? {})) {
      this.voiceRegion?.removeEventListener?.(type, handler);
    }
    for (const [type, handler] of Object.entries(this.inventoryPointerHandlers ?? {})) {
      this.root?.removeEventListener?.(type, handler, true);
    }
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    this.joystick?.destroy();
    this.motion?.destroy();
    this.cameraMotion?.destroy();
    this.handTracker?.destroy?.();
    this.foundPhoneUI?.destroy();
    this.diagnostics?.destroy();
    this.socket?.destroy();
    this.audioContext?.close();
  }
}
