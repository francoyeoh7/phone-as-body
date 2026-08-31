import { io } from "socket.io-client";
import { EGG_EVENTS } from "../shared/egg-protocol.js";
import { plateQuaternion, gravityInPlateFrame, createPlateTracker } from "./plate-tilt.js";
import { FistGrabDetector } from "./FistGrabDetector.js";
import "./egg-controller.css";

const STORAGE_KEY = "egg-race-player-key";
const NAME_KEY = "egg-race-player-name";

function makeKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export class EggRaceControllerApp {
  constructor(root) {
    this.root = root;
    this.room = new URLSearchParams(location.search).get("room") ?? "";
    this.key = sessionStorage.getItem(STORAGE_KEY) ?? makeKey();
    sessionStorage.setItem(STORAGE_KEY, this.key);
    this.socket = null;
    this.slot = null;
    this.phase = "lobby";
    this.tracker = createPlateTracker();
    this.sequence = 0;
    this.rtt = null;
    this.pingTimer = null;
    this.sendTimer = null;
    this.wakeLock = null;
    this.latestGravity = null;
    this.latestRelative = null;
    this.move = { x: 0, y: 0 };
    this.joystickPointer = null;
    this.joystickOrigin = null;
    this.grabDetector = null;
    this.grabArmedAt = 0;
  }

  mount() {
    this.root.innerHTML = this.markup();
    this.bind();
    if (!window.isSecureContext) this.showInsecure();
  }

  markup() {
    const savedName = localStorage.getItem(NAME_KEY) ?? "";
    return `
      <main class="egg-phone">
        <section class="egg-stage" id="egg-stage">
          <div class="egg-bubble" id="egg-bubble" hidden>
            <div class="egg-bubble-ring"></div>
            <div class="egg-bubble-dot" id="egg-bubble-dot"></div>
          </div>
          <div class="egg-count" id="egg-count" hidden></div>
          <div class="egg-go" id="egg-go" hidden>跑！</div>
          <div class="egg-drop-flash" id="egg-drop-flash" hidden>蛋掉了！</div>
          <div class="egg-rank" id="egg-rank" hidden></div>
          <div class="egg-joystick" id="egg-joystick" hidden>
            <div class="egg-joystick-ring"></div>
            <div class="egg-joystick-thumb" id="egg-joystick-thumb"></div>
          </div>
        </section>

        <div class="egg-status" id="egg-status">连接中…</div>

        <div class="egg-join" id="egg-join">
          <p class="egg-copy">按住屏幕拖动＝跑和转向，倾斜手机＝稳住蛋，对摄像头握拳＝把旁边的人拽到身后。</p>
          <label class="egg-name-label">昵称
            <input id="egg-name" type="text" maxlength="12" placeholder="蛋仔" value="${savedName.replace(/"/g, "&quot;")}" autocomplete="off" />
          </label>
          <button class="egg-primary" id="egg-enable" type="button">允许并开始</button>
          <p class="egg-room">房间 <strong>${this.room || "—"}</strong></p>
        </div>
      </main>`;
  }

  bind() {
    this.el = {
      stage: this.root.querySelector("#egg-stage"),
      bubble: this.root.querySelector("#egg-bubble"),
      bubbleDot: this.root.querySelector("#egg-bubble-dot"),
      count: this.root.querySelector("#egg-count"),
      go: this.root.querySelector("#egg-go"),
      dropFlash: this.root.querySelector("#egg-drop-flash"),
      rank: this.root.querySelector("#egg-rank"),
      joystick: this.root.querySelector("#egg-joystick"),
      joystickThumb: this.root.querySelector("#egg-joystick-thumb"),
      status: this.root.querySelector("#egg-status"),
      join: this.root.querySelector("#egg-join"),
      name: this.root.querySelector("#egg-name"),
      enable: this.root.querySelector("#egg-enable"),
    };
    this.el.enable.addEventListener("click", () => this.enable());
    this.handleOrientation = this.handleOrientation.bind(this);
    this.bindJoystick();
  }

  showInsecure() {
    this.el.status.textContent = "需要 HTTPS 安全上下文才能读取陀螺仪";
    this.el.enable.disabled = true;
    this.el.enable.textContent = "请通过 HTTPS 地址打开";
  }

  setStatus(text) {
    this.el.status.textContent = text;
  }

  async enable() {
    this.el.enable.disabled = true;
    const name = (this.el.name.value || "").trim() || "蛋仔";
    localStorage.setItem(NAME_KEY, name);
    this.name = name;

    const granted = await this.requestSensorPermission();
    if (!granted) {
      this.el.enable.disabled = false;
      this.setStatus("传感器授权失败，请重试");
      return;
    }

    this.startListening();
    this.connect(name);
  }

  async requestSensorPermission() {
    try {
      const requests = [];
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        requests.push(DeviceMotionEvent.requestPermission());
      }
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        requests.push(DeviceOrientationEvent.requestPermission());
      }
      if (requests.length) {
        const results = await Promise.all(requests);
        return results.every((result) => result === "granted");
      }
      return true;
    } catch {
      return false;
    }
  }

  startListening() {
    window.addEventListener("deviceorientation", this.handleOrientation, true);
  }

  bindJoystick() {
    const stage = this.el.stage;
    const maxRadius = 52;
    const onDown = (event) => {
      if (this.phase !== "racing" || this.joystickPointer !== null) return;
      const touch = event.changedTouches ? event.changedTouches[0] : event;
      this.joystickPointer = touch.identifier ?? "mouse";
      this.joystickOrigin = { x: touch.clientX, y: touch.clientY };
      this.el.joystick.hidden = false;
      this.el.joystick.style.left = `${touch.clientX}px`;
      this.el.joystick.style.top = `${touch.clientY}px`;
      this.move = { x: 0, y: 0 };
      event.preventDefault?.();
    };
    const onMove = (event) => {
      if (this.joystickPointer === null) return;
      const touches = event.changedTouches ? [...event.changedTouches] : [event];
      const touch = touches.find((entry) => (entry.identifier ?? "mouse") === this.joystickPointer);
      if (!touch) return;
      const dx = touch.clientX - this.joystickOrigin.x;
      const dy = touch.clientY - this.joystickOrigin.y;
      const distance = Math.hypot(dx, dy);
      const scale = distance > maxRadius ? maxRadius / distance : 1;
      const clampedX = dx * scale;
      const clampedY = dy * scale;
      this.el.joystickThumb.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
      this.move = {
        x: Math.abs(clampedX / maxRadius) < 0.12 ? 0 : clampedX / maxRadius,
        y: Math.abs(-clampedY / maxRadius) < 0.12 ? 0 : -clampedY / maxRadius,
      };
      event.preventDefault?.();
    };
    const onUp = (event) => {
      if (this.joystickPointer === null) return;
      const touches = event.changedTouches ? [...event.changedTouches] : [event];
      const touch = touches.find((entry) => (entry.identifier ?? "mouse") === this.joystickPointer);
      if (!touch) return;
      this.joystickPointer = null;
      this.move = { x: 0, y: 0 };
      this.el.joystickThumb.style.transform = "translate(0px, 0px)";
      this.el.joystick.hidden = true;
    };
    stage.addEventListener("touchstart", onDown, { passive: false });
    stage.addEventListener("touchmove", onMove, { passive: false });
    stage.addEventListener("touchend", onUp);
    stage.addEventListener("touchcancel", onUp);
  }

  startSendLoop() {
    if (this.sendTimer !== null) return;
    this.sendTimer = window.setInterval(() => {
      if (this.phase !== "racing" || !this.socket?.connected) return;
      if (!this.tracker.calibrated || !this.latestGravity || !this.latestRelative) return;
      this.sequence += 1;
      const payload = {
        seq: this.sequence,
        sentAt: Date.now(),
        g: [...this.latestGravity],
        r: [...this.latestRelative],
        m: [this.move.x, this.move.y],
      };
      if (this.rtt !== null) payload.rtt = this.rtt;
      this.socket.volatile.emit(EGG_EVENTS.playerTilt, payload);
    }, 33);
  }

  stopJoystick() {
    this.joystickPointer = null;
    this.move = { x: 0, y: 0 };
    this.el.joystickThumb.style.transform = "translate(0px, 0px)";
    this.el.joystick.hidden = true;
  }

  connect(name) {
    this.setStatus("正在连接房间…");
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => {
      this.socket.emit(EGG_EVENTS.playerJoin, { room: this.room, key: this.key, name }, (result) => {
        if (!result?.ok) {
          this.setStatus(result?.reason === "room-full" ? "房间已满" : "加入失败，请检查房间码");
          return;
        }
        this.slot = result.slot;
        this.el.join.hidden = true;
        this.setPhase("lobby");
        this.setStatus("已加入，等待电脑端开始");
        this.startPing();
        this.startGesture();
      });
    });
    this.socket.on("disconnect", () => this.setStatus("连接断开，重连中…"));
    this.socket.on("connect_error", () => this.setStatus("连接失败，请确认与电脑在同一网络"));
    this.socket.on(EGG_EVENTS.hostPhase, (payload) => this.setPhase(payload.phase, payload));
    this.socket.on(EGG_EVENTS.hostEvent, (payload) => this.handleHostEvent(payload));
    this.socket.on(EGG_EVENTS.ended, () => {
      this.setPhase("lobby");
      this.setStatus("房间已结束");
    });
  }

  startGesture() {
    this.grabDetector = new FistGrabDetector({
      onGrab: () => {
        if (this.phase !== "racing" || !this.socket?.connected) return;
        const now = performance.now();
        if (now - this.grabArmedAt < 1500) return;
        this.grabArmedAt = now;
        this.socket.emit(EGG_EVENTS.playerAction, { action: "grab" });
        vibrate(45);
      },
      onState: (state) => {
        if (state === "ready") this.setStatus("手势已开启：握拳抓人");
        if (state === "unavailable") this.setStatus("手势不可用（不影响游戏）");
      },
    });
    this.grabDetector.start();
  }

  startPing() {
    this.pingTimer = window.setInterval(() => {
      if (!this.socket?.connected) return;
      const sentAt = Date.now();
      this.socket.emit(EGG_EVENTS.ping, { t: sentAt }, (reply) => {
        if (reply && typeof reply.echo === "number") this.rtt = Math.max(0, Date.now() - reply.echo);
      });
    }, 2000);
  }

  setPhase(phase, payload = {}) {
    this.phase = phase;
    this.el.bubble.hidden = true;
    this.el.count.hidden = true;
    this.el.go.hidden = true;
    this.el.dropFlash.hidden = true;
    this.el.rank.hidden = true;

    if (phase === "lobby") {
      this.tracker = createPlateTracker();
      this.setStatus("等待电脑端开始");
      this.releaseWakeLock();
      this.stopJoystick();
    } else if (phase === "calibrate") {
      this.tracker = createPlateTracker();
      this.el.bubble.hidden = false;
      this.setStatus("把手机端平好，保持水平");
      this.stopJoystick();
    } else if (phase === "countdown") {
      this.el.bubble.hidden = false;
      this.runCountdown(payload.durationMs ?? 3000);
    } else if (phase === "racing") {
      this.el.go.hidden = false;
      this.setStatus("摇杆跑 · 倾斜救蛋");
      this.requestWakeLock();
      this.startSendLoop();
      vibrate(60);
      window.setTimeout(() => { this.el.go.hidden = true; }, 900);
    } else if (phase === "finished") {
      this.setStatus("比赛结束");
      this.releaseWakeLock();
      this.stopJoystick();
    }
  }

  runCountdown(durationMs) {
    const steps = Math.max(1, Math.round(durationMs / 1000));
    let remaining = steps;
    this.el.count.hidden = false;
    this.el.count.textContent = String(remaining);
    const tick = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(tick);
        this.el.count.hidden = true;
        return;
      }
      this.el.count.textContent = String(remaining);
      vibrate(30);
    }, 1000);
  }

  handleHostEvent(payload) {
    if (payload.slot !== this.slot) return;
    if (payload.event === "drop") {
      this.el.dropFlash.hidden = false;
      this.el.dropFlash.textContent = "蛋掉了！";
      vibrate([90, 50, 140]);
      window.setTimeout(() => { this.el.dropFlash.hidden = true; }, 1100);
    } else if (payload.event === "bump") {
      vibrate(35);
    } else if (payload.event === "collide") {
      vibrate([40, 40, 80]);
    } else if (payload.event === "grabbed") {
      this.el.dropFlash.hidden = false;
      this.el.dropFlash.textContent = "被拽走了！";
      vibrate([120, 60, 120, 60, 200]);
      window.setTimeout(() => { this.el.dropFlash.hidden = true; }, 1200);
    } else if (payload.event === "grab-hit") {
      vibrate([60, 40, 160]);
    } else if (payload.event === "grab-miss") {
      vibrate(25);
    } else if (payload.event === "finish") {
      this.el.rank.hidden = false;
      this.el.rank.textContent = `第 ${payload.rank} 名！`;
      vibrate([60, 60, 60, 60, 220]);
    }
  }

  handleOrientation(event) {
    const quaternion = plateQuaternion(event);
    if (!quaternion) return;
    const gravity = gravityInPlateFrame(quaternion);
    if (!gravity) return;

    if (this.phase === "calibrate" || this.phase === "countdown") {
      this.renderBubble(gravity);
    }

    if (this.phase !== "racing") return;
    if (!this.tracker.calibrated) this.tracker.calibrate(quaternion);
    const relative = this.tracker.relative(quaternion);
    if (!relative) return;
    this.latestGravity = [gravity.x, gravity.y, gravity.z];
    this.latestRelative = [relative.x, relative.y, relative.z, relative.w];
  }

  renderBubble(gravity) {
    const clampedX = Math.max(-1, Math.min(1, -gravity.x * 2.4));
    const clampedY = Math.max(-1, Math.min(1, -gravity.y * 2.4));
    this.el.bubbleDot.style.transform = `translate(${clampedX * 42}px, ${clampedY * 42}px)`;
    const level = Math.hypot(gravity.x, gravity.y) < 0.06;
    this.el.bubble.classList.toggle("level", level);
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
