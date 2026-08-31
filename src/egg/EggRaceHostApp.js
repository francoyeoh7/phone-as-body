import * as THREE from "three";
import QRCode from "qrcode";
import { io } from "socket.io-client";
import { EGG_EVENTS, EGG_MAX_PLAYERS } from "../shared/egg-protocol.js";
import { slideAcceleration } from "./plate-tilt.js";
import { inverseQuaternion, rotateVector } from "../shared/orientation.js";
import { BUMPS, TRACK_HALF, aiControl, bumpHit, chooseGrabTarget } from "./race-logic.js";
import "./egg-host.css";

const TRACK_LEN = 60;
const START_SPACING = 2.2;
const MAX_SPEED = 8.5;
const ACCEL = 7;
const BRAKE_DECEL = 11;
const LATERAL_SPEED = 4.6;
const PLATE_RADIUS = 0.52;
const SLIDE_GAIN = 0.62;
const INERTIA_GAIN = 0.42;
const EGG_FRICTION = 2.6;
const EGG_MAX_SPEED = 3.6;
const CATCH_SPRING = 8;
const DROP_TIME = 1.5;
const KNOCKBACK = 2.5;
const SAMPLE_STALE_MS = 600;
const CALIBRATE_MS = 2600;
const COUNTDOWN_MS = 3000;
const FINISH_TIMEOUT_MS = 15000;
const COLLIDE_DIST = 0.78;
const COLLIDE_EGG_IMPULSE = 1.1;
const COLLIDE_COOLDOWN = 0.6;
const GRAB_COOLDOWN = 6;
const GRAB_PULL_BACK = 2.0;
const GRAB_EGG_IMPULSE = 1.7;
const AI_BALANCE_SPRING = 4.2;
const AI_MAX = 2;
const MAX_RACERS = 5;
const SLOT_COLORS = [0xffb3c7, 0xffe08a, 0x9ed2ff, 0xb9e6a5, 0xd9b3ff, 0xffc49e];
const SLOT_COLOR_CSS = ["#ff8fb2", "#f5c542", "#6db6f2", "#8fce6f", "#b483e8", "#f0a060"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const GAME_TO_THREE = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 1, 0),
);
const FRAME_QUAT = new THREE.Quaternion().setFromRotationMatrix(GAME_TO_THREE);
const FRAME_QUAT_INV = FRAME_QUAT.clone().invert();

function gameQuatToThree(r) {
  const qg = new THREE.Quaternion(r[0], r[1], r[2], r[3]);
  return FRAME_QUAT.clone().multiply(qg).multiply(FRAME_QUAT_INV);
}

function gameVecToThree(x, y, z) {
  return new THREE.Vector3(x, z, -y);
}

export class EggRaceHostApp {
  constructor(root) {
    this.root = root;
    this.roster = [];
    this.racers = new Map();
    this.phase = "lobby";
    this.raceClock = 0;
    this.finishOrder = [];
    this.keyboardEnabled = false;
    this.aiCount = 0;
    this.keys = new Set();
    this.roomCode = null;
    this.focusZ = 0;
    this.focusX = 0;
    this.confetti = [];
    this.collisionCooldown = new Map();
    this.lastFrameAt = performance.now();
  }

  mount() {
    this.root.innerHTML = this.markup();
    this.cacheDom();
    this.initThree();
    this.bind();
    this.connect();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  markup() {
    return `
      <div class="egg-host">
        <canvas id="egg-canvas"></canvas>

        <div class="egg-hud" id="egg-hud"></div>

        <div class="egg-center-count" id="egg-center-count" hidden></div>

        <section class="egg-lobby" id="egg-lobby">
          <div class="egg-lobby-card">
            <div class="egg-lobby-main">
              <div class="egg-qr-wrap">
                <img id="egg-qr" alt="加入二维码" width="220" height="220" />
                <p class="egg-qr-hint">手机扫码加入 · 房间码 <strong id="egg-room-code">----</strong></p>
              </div>
              <div class="egg-lobby-side">
                <div class="egg-player-list" id="egg-player-list"></div>
                <button class="egg-host-btn" id="egg-start" disabled>开始比赛</button>
                <div class="egg-lobby-tools">
                  <label class="egg-kb-toggle">
                    <input type="checkbox" id="egg-keyboard" />
                    <span>键盘玩家（WASD）</span>
                  </label>
                  <button class="egg-tool-btn" id="egg-ai" type="button">加入 AI 玩家</button>
                </div>
                <ol class="egg-howto">
                  <li>手机扫码，允许传感器和摄像头</li>
                  <li>按住屏幕拖动＝跑和转向，全场随便跑</li>
                  <li>倾斜手机＝稳住盘子里的蛋</li>
                  <li>握拳＝把旁边的蛋仔拽到身后</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        <section class="egg-results" id="egg-results" hidden>
          <div class="egg-results-card">
            <h2>比赛结果</h2>
            <div id="egg-results-list"></div>
            <button class="egg-host-btn" id="egg-again">再来一局</button>
          </div>
        </section>

        <div class="egg-toast" id="egg-toast" hidden></div>
      </div>`;
  }

  cacheDom() {
    this.dom = {
      canvas: this.root.querySelector("#egg-canvas"),
      hud: this.root.querySelector("#egg-hud"),
      count: this.root.querySelector("#egg-center-count"),
      lobby: this.root.querySelector("#egg-lobby"),
      qr: this.root.querySelector("#egg-qr"),
      roomCode: this.root.querySelector("#egg-room-code"),
      playerList: this.root.querySelector("#egg-player-list"),
      start: this.root.querySelector("#egg-start"),
      keyboard: this.root.querySelector("#egg-keyboard"),
      ai: this.root.querySelector("#egg-ai"),
      results: this.root.querySelector("#egg-results"),
      resultsList: this.root.querySelector("#egg-results-list"),
      again: this.root.querySelector("#egg-again"),
      toast: this.root.querySelector("#egg-toast"),
    };
  }

  bind() {
    this.dom.start.addEventListener("click", () => this.startRace());
    this.dom.again.addEventListener("click", () => this.startRace());
    this.dom.keyboard.addEventListener("change", (event) => {
      this.keyboardEnabled = event.target.checked;
      this.renderPlayerList();
    });
    this.dom.ai.addEventListener("click", () => {
      this.aiCount = (this.aiCount + 1) % (AI_MAX + 1);
      this.renderPlayerList();
    });
    window.addEventListener("keydown", (event) => this.keys.add(event.code));
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("resize", () => this.resize());
  }

  connect() {
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => {
      this.socket.emit(EGG_EVENTS.hostCreate, async (result) => {
        if (!result?.ok) return;
        this.roomCode = result.code;
        this.dom.roomCode.textContent = result.code;
        const url = await this.buildControllerUrl(result.code);
        this.dom.qr.src = await QRCode.toDataURL(url, {
          width: 440,
          margin: 2,
          color: { dark: "#4a3b2a", light: "#fffdf6" },
          errorCorrectionLevel: "M",
        });
      });
    });
    this.socket.on(EGG_EVENTS.roomUpdate, ({ players }) => {
      this.roster = players;
      this.renderPlayerList();
    });
    this.socket.on(EGG_EVENTS.playerTilt, (payload) => this.acceptTilt(payload));
    this.socket.on(EGG_EVENTS.playerAction, (payload) => this.handlePlayerAction(payload));
  }

  handlePlayerAction({ slot, action }) {
    if (this.phase !== "racing" || action !== "grab") return;
    const attacker = this.racers.get(slot);
    if (!attacker || attacker.finished || attacker.dropTimer > 0) return;
    if (this.raceClock < attacker.grabCooldownUntil) {
      return;
    }
    attacker.grabCooldownUntil = this.raceClock + GRAB_COOLDOWN;
    const victim = chooseGrabTarget(this.racers, slot);
    if (!victim) {
      this.sendHostEvent({ event: "grab-miss", slot });
      return;
    }
    victim.dist = Math.max(0, attacker.dist - GRAB_PULL_BACK);
    victim.speed *= 0.5;
    victim.eggVel.x += (Math.random() < 0.5 ? -1 : 1) * GRAB_EGG_IMPULSE;
    victim.eggVel.y -= GRAB_EGG_IMPULSE;
    victim.wobble = 1;
    attacker.grabFlash = 1;
    this.sendHostEvent({ event: "grabbed", slot: victim.slot });
    this.sendHostEvent({ event: "grab-hit", slot });
    this.toast(`${attacker.name} 把 ${victim.name} 拽走了！`);
  }

  async buildControllerUrl(code) {
    let origin = location.origin;
    try {
      const response = await fetch("/api/config");
      const config = await response.json();
      if (config.controllerOrigin) origin = config.controllerOrigin;
    } catch {
      origin = location.origin;
    }
    const url = new URL("/egg-race/controller", origin);
    url.searchParams.set("room", code);
    return url.toString();
  }

  // ---------- lobby ----------

  renderPlayerList() {
    const rows = [];
    for (let slot = 0; slot < EGG_MAX_PLAYERS; slot += 1) {
      const player = this.roster.find((entry) => entry.slot === slot);
      rows.push(player
        ? `<div class="egg-player-chip joined" style="--slot:${slot}"><i></i>${player.connected ? "" : "<em>离线</em>"}${player.name}</div>`
        : `<div class="egg-player-chip empty" style="--slot:${slot}"><i></i>等待加入…</div>`);
    }
    if (this.keyboardEnabled) {
      rows.push(`<div class="egg-player-chip joined" style="--slot:3"><i></i>键盘蛋仔</div>`);
    }
    for (let index = 0; index < this.aiCount; index += 1) {
      rows.push(`<div class="egg-player-chip joined" style="--slot:${4 + index}"><i></i>AI蛋仔·${index + 1}</div>`);
    }
    this.dom.ai.textContent = this.aiCount === 0 ? "加入 AI 玩家" : `AI 玩家 ×${this.aiCount}（再点取消）`;
    this.dom.playerList.innerHTML = rows.join("");
    const connected = this.roster.filter((entry) => entry.connected).length + (this.keyboardEnabled ? 1 : 0) + this.aiCount;
    this.dom.start.disabled = connected === 0;
    this.dom.start.textContent = connected === 0 ? "等待玩家扫码" : `开始比赛（${connected} 人）`;
  }

  toast(text) {
    this.dom.toast.textContent = text;
    this.dom.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.dom.toast.hidden = true; }, 2600);
  }

  // ---------- race flow ----------

  startRace() {
    this.buildRacers();
    if (this.racers.size === 0) return;
    this.dom.lobby.hidden = true;
    this.dom.results.hidden = true;
    this.finishOrder = [];
    this.raceClock = 0;
    this.sendPhase("calibrate", CALIBRATE_MS);
    this.phase = "calibrate";
    window.setTimeout(() => {
      if (this.phase !== "calibrate") return;
      this.phase = "countdown";
      this.sendPhase("countdown", COUNTDOWN_MS);
      this.runCenterCountdown(COUNTDOWN_MS);
    }, CALIBRATE_MS);
  }

  runCenterCountdown(durationMs) {
    let remaining = Math.round(durationMs / 1000);
    this.dom.count.hidden = false;
    this.dom.count.textContent = String(remaining);
    const tick = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(tick);
        this.dom.count.hidden = true;
        this.beginRacing();
        return;
      }
      this.dom.count.textContent = String(remaining);
    }, 1000);
  }

  beginRacing() {
    this.phase = "racing";
    this.raceClock = 0;
    this.sendPhase("racing");
    for (const racer of this.racers.values()) racer.state = "racing";
  }

  sendPhase(phase, durationMs) {
    if (!this.socket?.connected) return;
    const payload = { phase, at: Date.now() };
    if (durationMs) payload.durationMs = durationMs;
    this.socket.emit(EGG_EVENTS.hostPhase, payload);
  }

  sendHostEvent(payload) {
    if (!this.socket?.connected) return;
    this.socket.emit(EGG_EVENTS.hostEvent, payload);
  }

  buildRacers() {
    this.clearRacerVisuals();
    this.racers.clear();
    const entrants = this.roster.filter((entry) => entry.connected);
    if (this.keyboardEnabled) entrants.push({ slot: 3, name: "键盘蛋仔", keyboard: true });
    for (let index = 0; index < this.aiCount; index += 1) {
      entrants.push({ slot: 4 + index, name: `AI蛋仔·${index + 1}`, ai: true });
    }
    const limited = entrants.slice(0, MAX_RACERS);
    limited.forEach((entry, index) => {
      this.addRacer(entry.slot, entry.name, { keyboard: Boolean(entry.keyboard), ai: Boolean(entry.ai) });
      const racer = this.racers.get(entry.slot);
      const startX = (index - (limited.length - 1) / 2) * START_SPACING;
      racer.worldX = clamp(startX, -TRACK_HALF, TRACK_HALF);
      racer.laneXRender = racer.worldX;
    });
  }

  addRacer(slot, name, { keyboard = false, ai = false } = {}) {
    const racer = {
      slot,
      name,
      keyboard,
      ai,
      dist: 0,
      prevDist: 0,
      worldX: 0,
      prevWorldX: 0,
      speed: 0,
      prevSpeed: 0,
      eggPos: { x: 0, y: 0 },
      eggVel: { x: 0, y: 0 },
      drops: 0,
      dropTimer: 0,
      state: "ready",
      finished: false,
      finishTimeMs: null,
      sample: null,
      sampleAt: 0,
      rtt: null,
      wobble: 0,
      grabCooldownUntil: 0,
      grabFlash: 0,
      laneXRender: 0,
    };
    racer.visual = this.buildEggy(slot);
    this.racers.set(slot, racer);
  }

  acceptTilt(payload) {
    const racer = this.racers.get(payload.slot);
    if (!racer || racer.keyboard) return;
    racer.sample = payload;
    racer.sampleAt = performance.now();
    if (typeof payload.rtt === "number") racer.rtt = payload.rtt;
  }

  // ---------- physics ----------

  virtualInputFromKeys() {
    let forward = 0;
    let lateral = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward = 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward = -1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) lateral = -1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) lateral = 1;
    return { g: [0, 0, 1], r: [0, 0, 0, 1], m: [lateral, forward] };
  }

  stepRacer(racer, dt) {
    racer.prevSpeed = racer.speed;
    racer.prevDist = racer.dist;
    racer.prevWorldX = racer.worldX;

    if (racer.dropTimer > 0) {
      racer.dropTimer -= dt;
      racer.speed = 0;
      if (racer.dropTimer <= 0) {
        racer.eggPos = { x: 0, y: 0 };
        racer.eggVel = { x: 0, y: 0 };
      }
      this.applyKinematics(racer, dt);
      return;
    }
    if (racer.finished) {
      racer.speed = Math.max(0, racer.speed - BRAKE_DECEL * dt);
      racer.dist += racer.speed * dt;
      this.applyKinematics(racer, dt);
      return;
    }

    let sample = null;
    if (racer.ai) {
      const control = aiControl(racer, BUMPS, { trackHalf: TRACK_HALF, plateRadius: PLATE_RADIUS });
      let aiMax = MAX_SPEED * 0.45;
      let minHumanDist = Infinity;
      for (const other of this.racers.values()) {
        if (!other.ai && !other.finished) minHumanDist = Math.min(minHumanDist, other.dist);
      }
      if (minHumanDist !== Infinity && racer.dist > minHumanDist + 1.5) aiMax = MAX_SPEED * 0.25;
      sample = { g: [0, 0, 1], r: [0, 0, 0, 1], m: [control.x, control.y], aiMax };
    } else if (racer.keyboard) {
      sample = this.virtualInputFromKeys();
    } else if (racer.sample && performance.now() - racer.sampleAt < SAMPLE_STALE_MS) {
      sample = racer.sample;
    }

    if (sample) {
      const move = Array.isArray(sample.m) ? sample.m : [0, 0];
      const moveY = clamp(move[1] ?? 0, -1, 1);
      const moveX = clamp(move[0] ?? 0, -1, 1);

      const braking = moveY < -0.25;
      const speedCap = sample.aiMax ?? MAX_SPEED;
      const targetSpeed = braking ? 0 : speedCap * clamp(moveY, 0, 1) ** 1.1;
      const limit = (targetSpeed >= racer.speed ? ACCEL : BRAKE_DECEL) * dt;
      racer.speed += clamp(targetSpeed - racer.speed, -limit, limit);

      racer.worldX = clamp(racer.worldX + moveX * LATERAL_SPEED * dt, -TRACK_HALF, TRACK_HALF);

      racer.dist += racer.speed * dt;
      const forwardAccel = (racer.speed - racer.prevSpeed) / dt;
      const lateralVelocity = (racer.worldX - racer.prevWorldX) / dt;
      const lateralAccel = clamp((lateralVelocity - (racer.prevLatVel ?? 0)) / dt, -30, 30);
      racer.prevLatVel = lateralVelocity;

      const gravity = { x: sample.g[0], y: sample.g[1], z: sample.g[2] };
      const slide = slideAcceleration(gravity, { gain: SLIDE_GAIN });
      const rel = { x: sample.r[0], y: sample.r[1], z: sample.r[2], w: sample.r[3] };
      const accelWorld = { x: lateralAccel * 0.35, y: forwardAccel, z: 0 };
      const inertia = rotateVector(inverseQuaternion(rel), accelWorld) ?? { x: 0, y: 0, z: 0 };
      racer.eggVel.x += (slide.x - inertia.x * INERTIA_GAIN) * dt;
      racer.eggVel.y += (slide.y - inertia.y * INERTIA_GAIN) * dt;

      if (racer.ai) {
        racer.eggVel.x += -racer.eggPos.x * AI_BALANCE_SPRING * dt;
        racer.eggVel.y += -racer.eggPos.y * AI_BALANCE_SPRING * dt;
      }

      this.checkBumps(racer);
    } else {
      racer.speed = Math.max(0, racer.speed - BRAKE_DECEL * dt);
      racer.dist += racer.speed * dt;
    }

    const damping = Math.exp(-EGG_FRICTION * dt);
    racer.eggVel.x *= damping;
    racer.eggVel.y *= damping;

    const eggSpeed = Math.hypot(racer.eggVel.x, racer.eggVel.y);
    if (eggSpeed > EGG_MAX_SPEED) {
      const scale = EGG_MAX_SPEED / eggSpeed;
      racer.eggVel.x *= scale;
      racer.eggVel.y *= scale;
    }

    racer.eggPos.x += racer.eggVel.x * dt;
    racer.eggPos.y += racer.eggVel.y * dt;

    if (racer.visual.droppedEgg) {
      this.applyKinematics(racer, dt);
      return;
    }

    const eggDist = Math.hypot(racer.eggPos.x, racer.eggPos.y);
    const catchStart = PLATE_RADIUS * 0.72;
    if (eggDist > catchStart && eggDist <= PLATE_RADIUS) {
      const over = (eggDist - catchStart) / (PLATE_RADIUS - catchStart);
      const normalX = racer.eggPos.x / eggDist;
      const normalY = racer.eggPos.y / eggDist;
      racer.eggVel.x -= normalX * CATCH_SPRING * over * dt;
      racer.eggVel.y -= normalY * CATCH_SPRING * over * dt;
    }

    if (eggDist > PLATE_RADIUS && racer.dropTimer <= 0 && !racer.visual.droppedEgg) {
      this.launchEgg(racer);
    }

    if (!racer.finished && racer.dist >= TRACK_LEN) {
      racer.finished = true;
      racer.finishTimeMs = Math.round(this.raceClock * 1000);
      this.finishOrder.push(racer.slot);
      const rank = this.finishOrder.length;
      this.sendHostEvent({ event: "finish", slot: racer.slot, rank, timeMs: racer.finishTimeMs });
      this.spawnConfetti(racer);
      if (rank === 1) this.toast(`${racer.name} 第一个送达！`);
      this.maybeFinishRace();
    }

    this.applyKinematics(racer, dt);
  }

  checkCollisions() {
    const active = [...this.racers.values()].filter(
      (racer) => racer.state === "racing" && !racer.finished && racer.dropTimer <= 0,
    );
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        const key = `${a.slot}:${b.slot}`;
        if ((this.collisionCooldown.get(key) ?? -1) > this.raceClock) continue;
        const dx = (a.renderX ?? 0) - (b.renderX ?? 0);
        const dz = a.dist - b.dist;
        if (Math.abs(dx) >= COLLIDE_DIST || Math.abs(dz) >= COLLIDE_DIST) continue;

        const dir = Math.sign(dx) || (Math.random() < 0.5 ? -1 : 1);
        a.worldX = clamp(a.worldX + dir * 0.16, -TRACK_HALF, TRACK_HALF);
        b.worldX = clamp(b.worldX - dir * 0.16, -TRACK_HALF, TRACK_HALF);
        a.speed *= 0.72;
        b.speed *= 0.72;
        a.eggVel.x += dir * COLLIDE_EGG_IMPULSE;
        b.eggVel.x -= dir * COLLIDE_EGG_IMPULSE;
        a.eggVel.y += (Math.random() - 0.5) * 0.8;
        b.eggVel.y += (Math.random() - 0.5) * 0.8;
        a.wobble = 1;
        b.wobble = 1;
        this.sendHostEvent({ event: "collide", slot: a.slot });
        this.sendHostEvent({ event: "collide", slot: b.slot });
        this.collisionCooldown.set(key, this.raceClock + COLLIDE_COOLDOWN);
      }
    }
  }

  checkBumps(racer) {
    for (const bumpRow of BUMPS) {
      if (bumpHit(bumpRow, racer.worldX, racer.prevDist, racer.dist)) {
        racer.speed *= 0.5;
        racer.eggVel.y -= 1.5;
        racer.eggVel.x += (Math.random() - 0.5) * 1.1;
        racer.wobble = 1;
        this.sendHostEvent({ event: "bump", slot: racer.slot });
      }
    }
  }

  dropEgg(racer) {
    racer.drops += 1;
    racer.dropTimer = DROP_TIME;
    racer.state = "dropped";
    racer.speed = 0;
    racer.dist = Math.max(0, racer.dist - KNOCKBACK);
    racer.wobble = 1;
    this.sendHostEvent({ event: "drop", slot: racer.slot });
  }

  maybeFinishRace() {
    const pending = [...this.racers.values()].filter((racer) => !racer.finished);
    if (pending.length === 0) return this.endRace();
    if (this.finishTimer === undefined) {
      this.finishTimer = window.setTimeout(() => {
        this.finishTimer = undefined;
        this.endRace();
      }, FINISH_TIMEOUT_MS);
    }
    return null;
  }

  endRace() {
    if (this.finishTimer !== undefined) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = undefined;
    }
    this.phase = "finished";
    this.sendPhase("finished");
    this.renderResults();
    this.dom.results.hidden = false;
  }

  renderResults() {
    const ranked = [...this.racers.values()].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
    const medals = ["gold", "silver", "bronze", "fourth"];
    this.dom.resultsList.innerHTML = ranked.map((racer, index) => `
      <div class="egg-result-row ${medals[index] ?? ""}">
        <span class="egg-result-rank">${index + 1}</span>
        <i style="background:${SLOT_COLOR_CSS[racer.slot]}"></i>
        <span class="egg-result-name">${racer.name}</span>
        <span class="egg-result-time">${racer.finished ? `${(racer.finishTimeMs / 1000).toFixed(2)}s` : "未送达"}</span>
        <span class="egg-result-drops">掉蛋 ${racer.drops}</span>
      </div>`).join("");
  }

  applyKinematics(racer, dt) {
    void dt;
    racer.renderX = racer.worldX;
    racer.laneXRender += (racer.renderX - racer.laneXRender) * 0.2;
  }

  // ---------- three.js ----------

  initThree() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.dom.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfff3e2);
    this.scene.fog = new THREE.Fog(0xfff3e2, 30, 85);
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 6.5, 13);

    const hemi = new THREE.HemisphereLight(0xfff6e8, 0xd8c2a8, 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.35);
    sun.position.set(8, 14, 6);
    this.scene.add(sun);

    this.buildTrack();
    this.resize();
  }

  buildTrack() {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(13, 0.6, TRACK_LEN + 26),
      new THREE.MeshStandardMaterial({ color: 0xbfe8c8, roughness: 0.95 }),
    );
    ground.position.set(0, -0.3, -TRACK_LEN / 2 + 6);
    this.scene.add(ground);

    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.2, TRACK_LEN + 80),
      new THREE.MeshStandardMaterial({ color: 0xf7e3c2, roughness: 1 }),
    );
    apron.position.set(0, -0.72, -TRACK_LEN / 2);
    this.scene.add(apron);

    for (let lane = -1; lane <= 1; lane += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.05, TRACK_LEN + 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
      );
      stripe.position.set(lane * 3.2 + 1.6, 0.03, -TRACK_LEN / 2 + 4);
      if (lane < 1) this.scene.add(stripe);
    }

    for (let d = 0; d <= TRACK_LEN; d += 10) {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(10.4, 0.04, 0.18),
        new THREE.MeshStandardMaterial({ color: d === TRACK_LEN ? 0xff8fb2 : 0xffffff, roughness: 0.8 }),
      );
      marker.position.set(0, 0.03, -d);
      this.scene.add(marker);
    }

    this.buildGate(0, 0xffffff, "起点");
    this.buildGate(TRACK_LEN, 0xff8fb2, "终点");

    for (const bumpRow of BUMPS) {
      for (const segment of bumpRow.segments) {
        const bumpMesh = new THREE.Mesh(
          new THREE.BoxGeometry(segment.w, 0.22, 0.7),
          new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.7 }),
        );
        bumpMesh.position.set(segment.x, 0.11, -bumpRow.d);
        this.scene.add(bumpMesh);
        const stripeTop = new THREE.Mesh(
          new THREE.BoxGeometry(segment.w, 0.24, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.8 }),
        );
        stripeTop.position.set(segment.x, 0.115, -bumpRow.d);
        this.scene.add(stripeTop);
      }
    }
  }

  buildGate(dist, color, label) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const left = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.6, 12), material);
    left.position.set(-5.4, 1.8, -dist);
    const right = left.clone();
    right.position.x = 5.4;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.9, 0.3), material);
    banner.position.set(0, 3.6, -dist);
    this.scene.add(left, right, banner);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdf6";
    context.font = "bold 44px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 256, 34);
    const texture = new THREE.CanvasTexture(canvas);
    const textPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 0.75),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    textPlane.position.set(0, 3.6, -dist + 0.17);
    this.scene.add(textPlane);
  }

  buildEggy(slot) {
    const color = SLOT_COLORS[slot] ?? 0xdddddd;
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.34, 8, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
    );
    body.position.y = 0.55;
    group.add(body);

    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x33261d, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), eyeMaterial);
      eye.position.set(side * 0.13, 0.78, -0.29);
      group.add(eye);
      const blush = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xff9d9d, roughness: 0.9 }),
      );
      blush.position.set(side * 0.24, 0.66, -0.28);
      blush.rotation.y = side * -0.35;
      group.add(blush);
    }

    const plateGroup = new THREE.Group();
    plateGroup.position.y = 1.14;
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.62, 0.05, 28),
      new THREE.MeshStandardMaterial({ color: 0xfffdf6, roughness: 0.35 }),
    );
    plateGroup.add(plate);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.67, 0.03, 10, 36),
      new THREE.MeshStandardMaterial({ color: 0xf2c7d8, roughness: 0.5 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.03;
    plateGroup.add(rim);

    const egg = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xfff8ec, roughness: 0.3 }),
    );
    egg.scale.set(1, 1.12, 1);
    egg.position.y = 0.2;
    plateGroup.add(egg);
    group.add(plateGroup);

    this.scene.add(group);
    return { group, body, plateGroup, egg, droppedEgg: null };
  }

  clearRacerVisuals() {
    for (const racer of this.racers.values()) {
      this.scene.remove(racer.visual.group);
      if (racer.visual.droppedEgg) this.scene.remove(racer.visual.droppedEgg);
    }
  }

  launchEgg(racer) {
    const visual = racer.visual;
    const worldPos = new THREE.Vector3();
    visual.egg.getWorldPosition(worldPos);
    visual.egg.visible = false;
    const loose = visual.egg.clone();
    loose.visible = true;
    loose.position.copy(worldPos);
    this.scene.add(loose);
    visual.droppedEgg = {
      mesh: loose,
      velocity: new THREE.Vector3(
        racer.eggVel.x + (Math.random() - 0.5) * 0.8,
        1.6,
        -racer.speed * 0.45 - racer.eggVel.y * 0.6,
      ),
      bounces: 0,
      grounded: false,
    };
  }

  spawnConfetti(racer) {
    const count = 60;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = racer.laneXRender;
      positions[index * 3 + 1] = 2.4;
      positions[index * 3 + 2] = -racer.dist;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 5 + 2, (Math.random() - 0.5) * 5));
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: SLOT_COLORS[racer.slot] ?? 0xffffff, size: 0.16 });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.confetti.push({ points, velocities, life: 2.4 });
  }

  // ---------- frame loop ----------

  frame() {
    const now = performance.now();
    const dt = clamp((now - this.lastFrameAt) / 1000, 0.001, 0.04);
    this.lastFrameAt = now;
    const time = now / 1000;

    if (this.phase === "racing" || this.phase === "finished") {
      if (this.phase === "racing") this.raceClock += dt;
      const activeSlots = [...this.racers.keys()].sort((a, b) => a - b);
      activeSlots.forEach((slot) => {
        this.stepRacer(this.racers.get(slot), dt);
      });
      if (this.phase === "racing") this.checkCollisions();
      this.renderRacers(time, dt);
      this.updateHud();
      this.updateCamera(dt);
    } else {
      this.camera.position.lerp(new THREE.Vector3(0, 6.5, 13), 0.02);
      this.camera.lookAt(0, 1, -12);
    }

    this.updateConfetti(dt);
    this.renderer.render(this.scene, this.camera);
  }

  renderRacers(time, dt) {
    for (const racer of this.racers.values()) {
      const visual = racer.visual;
      const x = racer.laneXRender;
      const z = -racer.dist;
      const bob = Math.sin(time * 9 + racer.slot * 1.7) * 0.035 * clamp(racer.speed / MAX_SPEED, 0.25, 1);
      visual.group.position.set(x, bob, z);

      const lean = clamp(racer.speed / MAX_SPEED, 0, 1) * 0.16;
      let wobbleZ = 0;
      if (racer.wobble > 0) {
        racer.wobble = Math.max(0, racer.wobble - 0.03);
        wobbleZ = Math.sin(time * 22) * 0.12 * racer.wobble;
      }
      visual.group.rotation.set(-lean, 0, wobbleZ);

      if (racer.sample && !racer.keyboard) {
        visual.plateGroup.quaternion.copy(gameQuatToThree(racer.sample.r));
      } else {
        visual.plateGroup.quaternion.identity();
      }

      if (racer.dropTimer > 0 || visual.droppedEgg) {
        visual.egg.visible = false;
      } else {
        visual.egg.visible = true;
        visual.egg.position.set(racer.eggPos.x, 0.2, -racer.eggPos.y);
      }

      if (visual.droppedEgg) {
        const loose = visual.droppedEgg;
        loose.velocity.y -= 12 * dt;
        loose.mesh.position.addScaledVector(loose.velocity, dt);
        if (loose.mesh.position.y < 0.16 && loose.velocity.y < 0) {
          loose.mesh.position.y = 0.16;
          loose.velocity.y *= -0.42;
          loose.velocity.x *= 0.7;
          loose.velocity.z *= 0.7;
          loose.bounces += 1;
          if (!loose.grounded) {
            loose.grounded = true;
            this.dropEgg(racer);
          }
        }
        if (loose.bounces > 2 || (racer.dropTimer <= 0 && loose.grounded)) {
          this.scene.remove(loose.mesh);
          visual.droppedEgg = null;
          visual.egg.visible = true;
        }
      }
      if (racer.dropTimer <= 0 && racer.state === "dropped") racer.state = "racing";
    }
  }

  updateConfetti(dt) {
    for (let index = this.confetti.length - 1; index >= 0; index -= 1) {
      const burst = this.confetti[index];
      burst.life -= dt;
      const positions = burst.points.geometry.attributes.position;
      for (let particle = 0; particle < burst.velocities.length; particle += 1) {
        const velocity = burst.velocities[particle];
        velocity.y -= 6 * dt;
        positions.array[particle * 3] += velocity.x * dt;
        positions.array[particle * 3 + 1] += velocity.y * dt;
        positions.array[particle * 3 + 2] += velocity.z * dt;
      }
      positions.needsUpdate = true;
      if (burst.life <= 0) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        burst.points.material.dispose();
        this.confetti.splice(index, 1);
      }
    }
  }

  updateCamera(dt) {
    const humans = [...this.racers.values()].filter((racer) => !racer.ai);
    const focusSet = humans.length ? humans : [...this.racers.values()];
    let sumZ = 0;
    let sumX = 0;
    for (const racer of focusSet) {
      sumZ += -racer.dist;
      sumX += racer.laneXRender;
    }
    const count = focusSet.length || 1;
    const focusZ = sumZ / count;
    const focusX = sumX / count;
    this.focusZ += (focusZ - this.focusZ) * Math.min(1, 3 * dt);
    this.focusX += (focusX - this.focusX) * Math.min(1, 3 * dt);
    const target = new THREE.Vector3(this.focusX, 5.4, this.focusZ + 10.5);
    this.camera.position.lerp(target, Math.min(1, 4 * dt));
    this.camera.lookAt(this.focusX, 0.9, this.focusZ - 9);
  }

  updateHud() {
    if (this.phase !== "racing") {
      if (this.phase === "finished") return;
      this.dom.hud.innerHTML = "";
      return;
    }
    const cards = [...this.racers.values()].sort((a, b) => b.dist - a.dist).map((racer) => {
      const progress = clamp(racer.dist / TRACK_LEN, 0, 1) * 100;
      const latency = racer.keyboard ? "—" : racer.rtt !== null ? `${Math.round(racer.rtt)}ms` : "…";
      const state = racer.finished ? "送达" : racer.dropTimer > 0 ? "掉蛋!" : "跑";
      return `
        <div class="egg-hud-card" style="--slot:${racer.slot}">
          <div class="egg-hud-top"><i></i><span>${racer.name}</span><em>${state}</em></div>
          <div class="egg-hud-bar"><b style="width:${progress}%"></b></div>
          <div class="egg-hud-meta"><span>${racer.speed.toFixed(1)} m/s</span><span>掉 ${racer.drops}</span><span>${latency}</span></div>
        </div>`;
    }).join("");
    this.dom.hud.innerHTML = cards;
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
