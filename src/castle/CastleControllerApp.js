import { io } from "socket.io-client";
import { CASTLE_EVENTS } from "../shared/castle-protocol.js";
import { MotionController } from "../controller/MotionController.js";
import { VirtualJoystick } from "../controller/VirtualJoystick.js";
import { FistGrabDetector } from "../egg/FistGrabDetector.js";
import "./castle-controller.css";

const STORAGE_KEY = "egg-race-player-key";
const NAME_KEY = "castle-player-name";

function makeKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export class CastleControllerApp {
  constructor(root) {
    this.root = root;
    this.room = new URLSearchParams(location.search).get("room") ?? "";
    this.key = sessionStorage.getItem(STORAGE_KEY) ?? makeKey();
    sessionStorage.setItem(STORAGE_KEY, this.key);
    this.socket = null;
    this.phase = "lobby";
    this.sequence = 0;
    this.pingTimer = null;
    this.sendTimer = null;
    this.wakeLock = null;
    this.move = { x: 0, y: 0 };
    this.pendingView = { yaw: 0, pitch: 0 };
    this.viewEngaged = false;
    this.crouching = false;
    this.light = true;
    this.motion = null;
    this.joystick = null;
    this.grabDetector = null;
    this.grabArmedAt = 0;
  }

  mount() {
    this.root.innerHTML = this.markup();
    this.bind();
  }

  markup() {
    const savedName = localStorage.getItem(NAME_KEY) ?? "";
    return `
      <main class="castle-phone">
        <section class="play-surface" id="play-surface" aria-label="游戏控制器">
          <div class="castle-flash" id="castle-flash" hidden></div>
          <div class="castle-caught" id="castle-caught" hidden>被抓住了！</div>
          <div class="castle-crouch-tag" id="castle-crouch-tag" hidden>已蹲下</div>
          <div class="castle-hand-tag" id="castle-hand-tag" hidden>✋ 识别中</div>
          <div class="joystick-base" aria-hidden="true">
            <div class="joystick-ring"></div><div class="joystick-thumb"></div>
          </div>
        </section>

        <button class="castle-light-btn" id="castle-light" type="button" hidden>手电 开</button>
        <div class="castle-status" id="castle-status">连接中…</div>

        <div class="castle-join" id="castle-join">
          <p class="castle-copy">按住屏幕拖动＝移动；按住不放并转动手机＝手电转向；从上方快速滑到屏幕底部＝蹲下，蹲下后向右上滑＝站起；左手对摄像头握拳＝抓宝物。</p>
          <label class="castle-name-label">昵称
            <input id="castle-name" type="text" maxlength="12" placeholder="探险者" value="${savedName.replace(/"/g, "&quot;")}" autocomplete="off" />
          </label>
          <button class="castle-primary" id="castle-enable" type="button">允许并开始</button>
          <p class="castle-room">房间 <strong>${this.room || "—"}</strong></p>
        </div>

        <div class="castle-insecure" id="castle-insecure" hidden>
          <p>需要 HTTPS 安全上下文才能读取陀螺仪，请用电脑二维码给出的地址打开。</p>
        </div>
      </main>`;
  }

  bind() {
    this.el = {
      playSurface: this.root.querySelector("#play-surface"),
      flash: this.root.querySelector("#castle-flash"),
      caught: this.root.querySelector("#castle-caught"),
      crouchTag: this.root.querySelector("#castle-crouch-tag"),
      handTag: this.root.querySelector("#castle-hand-tag"),
      light: this.root.querySelector("#castle-light"),
      status: this.root.querySelector("#castle-status"),
      join: this.root.querySelector("#castle-join"),
      name: this.root.querySelector("#castle-name"),
      enable: this.root.querySelector("#castle-enable"),
      insecure: this.root.querySelector("#castle-insecure"),
    };

    if (!window.isSecureContext) {
      this.el.join.hidden = true;
      this.el.insecure.hidden = false;
      return;
    }

    // Same interaction paradigm as the corridor controller:
    // press-and-hold engages the gyro (clutch), drag moves,
    // quick slide into the bottom strip crouches, flick up-right stands.
    this.joystick = new VirtualJoystick(this.el.playSurface, {
      onChange: (move) => {
        this.move = move;
      },
      onEngagementChange: (engaged) => {
        this.viewEngaged = engaged;
        if (engaged) this.motion?.engage();
        else this.motion?.disengage();
      },
      canStart: () => this.phase === "playing",
      isBottomPoint: (point) => this.isBottomPoint(point),
      isCrouching: () => this.crouching,
      onCrouchChange: (active) => {
        this.crouching = active;
        this.el.crouchTag.hidden = !active;
        if (active) this.move = { x: 0, y: 0 };
        vibrate(active ? 30 : 20);
      },
      onTap: () => {
        if (this.phase !== "playing" || !this.socket?.connected) return;
        this.socket.emit(CASTLE_EVENTS.playerAction, { action: "grab" });
        vibrate(30);
      },
      onIgnoreTarget: (target) => Boolean(target?.closest?.("button, input, .castle-join")),
    });

    this.motion = new MotionController({
      onSample: (viewDelta) => {
        this.pendingView.yaw += viewDelta.yaw;
        this.pendingView.pitch += viewDelta.pitch;
      },
      onState: (state) => {
        if (state === "denied") this.setStatus("陀螺仪授权被拒绝");
        if (state === "insecure") this.setStatus("需要 HTTPS 安全上下文");
        if (state === "unsupported") this.setStatus("设备不支持方向传感器");
      },
    });

    this.el.enable.addEventListener("click", () => this.enable());
    this.el.light.addEventListener("click", () => {
      this.light = !this.light;
      this.el.light.textContent = this.light ? "手电 开" : "手电 关";
      this.el.light.classList.toggle("off", !this.light);
      vibrate(20);
    });

    this.connect();
  }

  isBottomPoint({ y }) {
    const height = window.innerHeight || document.documentElement?.clientHeight || 0;
    const bottomRegionHeight = Math.min(96, Math.max(68, height * 0.12));
    return y >= height - bottomRegionHeight;
  }

  setStatus(text) {
    this.el.status.textContent = text;
  }

  async enable() {
    this.el.enable.disabled = true;
    const name = (this.el.name.value || "").trim() || "探险者";
    localStorage.setItem(NAME_KEY, name);
    this.name = name;
    const result = await this.motion.requestPermission();
    if (!result?.motionGranted) {
      this.el.enable.disabled = false;
      this.setStatus("传感器授权失败，请重试");
      return;
    }
    this.connectSocket(name);
  }

  connectSocket(name) {
    this.setStatus("正在连接房间…");
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => {
      this.socket.emit(CASTLE_EVENTS.playerJoin, { room: this.room, key: this.key, name }, (result) => {
        if (!result?.ok) {
          this.setStatus(result?.reason === "room-full" ? "房间已有玩家" : "加入失败，请检查房间码");
          this.el.enable.disabled = false;
          return;
        }
        this.el.join.hidden = true;
        this.el.light.hidden = false;
        this.setPhase("lobby");
        this.setStatus("已加入，等待电脑端开始");
        this.startPing();
        this.startGesture();
      });
    });
    this.socket.on("disconnect", () => this.setStatus("连接断开，重连中…"));
    this.socket.on("connect_error", () => this.setStatus("连接失败，请确认与电脑在同一网络"));
    this.socket.on(CASTLE_EVENTS.hostPhase, (payload) => this.setPhase(payload.phase, payload));
    this.socket.on(CASTLE_EVENTS.hostEvent, (payload) => this.handleHostEvent(payload));
    this.socket.on(CASTLE_EVENTS.ended, () => {
      this.setPhase("lobby");
      this.setStatus("房间已结束");
    });
  }

  startGesture() {
    this.grabDetector = new FistGrabDetector({
      onGrab: () => {
        if (this.phase !== "playing" || !this.socket?.connected) return;
        const now = performance.now();
        if (now - this.grabArmedAt < 800) return;
        this.grabArmedAt = now;
        this.socket.emit(CASTLE_EVENTS.playerAction, { action: "grab" });
        vibrate(45);
        this.el.handTag.textContent = "✊ 抓取！";
        this.el.handTag.classList.add("grabbed");
        window.setTimeout(() => this.el.handTag.classList.remove("grabbed"), 500);
      },
      onState: (state) => {
        if (state === "loading") this.setStatus("正在加载手势识别…");
        if (state === "ready") this.setStatus("手势识别已就绪");
        if (state === "unavailable") this.setStatus("手势不可用，可点屏幕抓取");
      },
      onHandPresence: (seen) => {
        this.el.handTag.hidden = !seen;
        if (seen && !this.el.handTag.classList.contains("grabbed")) {
          this.el.handTag.textContent = "✋ 识别中";
        }
      },
    });
    this.grabDetector.start();
  }

  startPing() {
    this.pingTimer = window.setInterval(() => {
      if (!this.socket?.connected) return;
      const sentAt = Date.now();
      this.socket.emit(CASTLE_EVENTS.ping, { t: sentAt }, (reply) => {
        if (reply && typeof reply.echo === "number") this.rtt = Math.max(0, Date.now() - reply.echo);
      });
    }, 2000);
  }

  startSendLoop() {
    if (this.sendTimer !== null) return;
    this.sendTimer = window.setInterval(() => {
      if (this.phase !== "playing" || !this.socket?.connected) return;
      this.sequence += 1;
      const viewDelta = this.viewEngaged ? this.pendingView : { yaw: 0, pitch: 0 };
      this.pendingView = { yaw: 0, pitch: 0 };
      this.socket.volatile.emit(CASTLE_EVENTS.playerInput, {
        seq: this.sequence,
        sentAt: Date.now(),
        m: [this.move.x, this.move.y],
        dyaw: viewDelta.yaw,
        dpitch: viewDelta.pitch,
        light: this.light,
        crouch: this.crouching,
      });
    }, 33);
  }

  setPhase(phase) {
    this.phase = phase;
    if (phase === "lobby") {
      this.setStatus("等待电脑端开始");
      this.motion?.disengage();
      this.releaseWakeLock();
    } else if (phase === "playing") {
      this.setStatus("按住拖动＝走 · 按住转手机＝照向");
      this.startSendLoop();
      this.requestWakeLock();
      vibrate(60);
    } else if (phase === "finished") {
      this.setStatus("本局结束");
      this.motion?.disengage();
      this.releaseWakeLock();
    }
  }

  handleHostEvent(payload) {
    if (payload.event === "collect") {
      this.el.flash.hidden = false;
      window.setTimeout(() => { this.el.flash.hidden = true; }, 400);
      vibrate([40, 40, 40]);
    } else if (payload.event === "caught") {
      this.el.caught.hidden = false;
      vibrate([150, 80, 150, 80, 300]);
      window.setTimeout(() => { this.el.caught.hidden = true; }, 1500);
    } else if (payload.event === "extract") {
      vibrate([60, 60, 60, 60, 220]);
    } else if (payload.event === "alert") {
      vibrate([60, 60, 60]);
    }
  }

  async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request?.("screen");
    } catch {
      this.wakeLock = null;
    }
  }

  releaseWakeLock() {
    try { this.wakeLock?.release?.(); } catch { /* noop */ }
    this.wakeLock = null;
  }
}
