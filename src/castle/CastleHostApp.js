import * as THREE from "three";
import QRCode from "qrcode";
import { io } from "socket.io-client";
import { CASTLE_EVENTS } from "../shared/castle-protocol.js";
import {
  ENTRANCE, TREASURES, GUARDS, WALLS, SLABS, STAIRS,
  GUARD_SIGHT_RANGE, GUARD_SIGHT_RANGE_DARK, GUARD_FOV_COS, GUARD_CATCH_DIST,
  GUARD_CHASE_SPEED, PLAYER_SPEED, PLAYER_CROUCH_SPEED, PLAYER_RADIUS, GRAB_RANGE, GRAB_CONE_COS,
} from "./castle-layout.js";
import {
  collideWithWalls, groundHeightAt, stepGuard, findGrabbable, clipCameraToWalls,
} from "./castle-logic.js";
import { CastleSceneBuilder } from "./CastleSceneBuilder.js";
import "./castle-host.css";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const GUARD_CONFIG = {
  sightRange: GUARD_SIGHT_RANGE,
  sightRangeDark: GUARD_SIGHT_RANGE_DARK,
  fovCos: GUARD_FOV_COS,
  catchDist: GUARD_CATCH_DIST,
  chaseSpeed: GUARD_CHASE_SPEED,
};
const GRAB_CONFIG = { grabRange: GRAB_RANGE, grabConeCos: GRAB_CONE_COS };
const EXTRACT_RADIUS = 1.6;
const INPUT_STALE_MS = 500;
const GRAB_COOLDOWN_MS = 900;

export class CastleHostApp {
  constructor(root) {
    this.root = root;
    this.phase = "lobby";
    this.viewMode = "tp";
    this.player = null;
    this.guards = [];
    this.treasures = [];
    this.carried = 0;
    this.banked = 0;
    this.roomCode = null;
    this.peerConnected = false;
    this.latestInput = null;
    this.inputAt = 0;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.lastInputSeq = -1;
    this.lightOn = true;
    this.crouch = false;
    this.crouchBlend = 0;
    this.lastGrabAt = 0;
    this.lastFrameAt = performance.now();
    this.alertCount = 0;
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
      <div class="castle-host">
        <canvas id="castle-canvas"></canvas>
        <div class="castle-vignette" id="castle-vignette"></div>

        <div class="castle-hud" id="castle-hud" hidden>
          <div class="castle-hud-row">
            <span class="castle-chip">身上 <strong id="castle-carried">0</strong></span>
            <span class="castle-chip gold">已带回 <strong id="castle-banked">0</strong></span>
            <span class="castle-chip dim">剩余 <strong id="castle-left">12</strong></span>
          </div>
          <div class="castle-alert" id="castle-alert" hidden>被发现了！</div>
        </div>
        <div class="castle-grab-hint" id="castle-grab-hint" hidden>✊ 握拳抓取</div>

        <section class="castle-lobby" id="castle-lobby">
          <div class="castle-lobby-card">
            <div class="castle-lobby-main">
              <div class="castle-qr-wrap">
                <img id="castle-qr" alt="加入二维码" width="220" height="220" />
                <p class="castle-qr-hint">手机扫码 · 房间码 <strong id="castle-room-code">----</strong></p>
                <p class="castle-peer" id="castle-peer">等待手机加入…</p>
              </div>
              <div class="castle-lobby-side">
                <div class="castle-mode-row" role="group" aria-label="视角选择">
                  <button class="castle-mode" id="castle-mode-fp" type="button">第一人称</button>
                  <button class="castle-mode active" id="castle-mode-tp" type="button">第三人称</button>
                </div>
                <button class="castle-btn" id="castle-start" disabled>进入古堡</button>
                <button class="castle-btn ghost" id="castle-solo" type="button">键鼠试玩（无手机）</button>
                <ol class="castle-howto">
                  <li>按住屏幕拖动＝移动</li>
                  <li>按住不放并转动手机＝手电转向（松开锁定）</li>
                  <li>滑到屏幕底部＝蹲下，向右上滑＝站起</li>
                  <li>左手握拳＝抓宝物，短触屏幕＝也可抓</li>
                  <li>躲开守卫视锥，回入口光柱＝宝物入库</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        <section class="castle-over" id="castle-over" hidden>
          <div class="castle-over-card">
            <h2 id="castle-over-title">撤离成功</h2>
            <p id="castle-over-detail"></p>
            <button class="castle-btn" id="castle-again">再来一局</button>
          </div>
        </section>

        <div class="castle-toast" id="castle-toast" hidden></div>
      </div>`;
  }

  cacheDom() {
    this.dom = {
      canvas: this.root.querySelector("#castle-canvas"),
      vignette: this.root.querySelector("#castle-vignette"),
      hud: this.root.querySelector("#castle-hud"),
      carried: this.root.querySelector("#castle-carried"),
      banked: this.root.querySelector("#castle-banked"),
      alert: this.root.querySelector("#castle-alert"),
      grabHint: this.root.querySelector("#castle-grab-hint"),
      left: this.root.querySelector("#castle-left"),
      lobby: this.root.querySelector("#castle-lobby"),
      qr: this.root.querySelector("#castle-qr"),
      roomCode: this.root.querySelector("#castle-room-code"),
      peer: this.root.querySelector("#castle-peer"),
      modeFp: this.root.querySelector("#castle-mode-fp"),
      modeTp: this.root.querySelector("#castle-mode-tp"),
      start: this.root.querySelector("#castle-start"),
      solo: this.root.querySelector("#castle-solo"),
      over: this.root.querySelector("#castle-over"),
      overTitle: this.root.querySelector("#castle-over-title"),
      overDetail: this.root.querySelector("#castle-over-detail"),
      again: this.root.querySelector("#castle-again"),
      toast: this.root.querySelector("#castle-toast"),
    };
  }

  bind() {
    this.dom.modeFp.addEventListener("click", () => this.setViewMode("fp"));
    this.dom.modeTp.addEventListener("click", () => this.setViewMode("tp"));
    this.dom.start.addEventListener("click", () => this.startGame());
    this.dom.solo.addEventListener("click", () => this.startGame(true));
    this.dom.again.addEventListener("click", () => {
      this.dom.over.hidden = true;
      this.dom.lobby.hidden = false;
      this.phase = "lobby";
      this.sendPhase("lobby");
    });
    window.addEventListener("keydown", (event) => {
      this.keys.add(event.code);
      if (event.code === "KeyL") this.lightOn = !this.lightOn;
      if (event.code === "KeyC" || event.code === "ControlLeft") this.crouch = !this.crouch;
      if (event.code === "Space") this.tryGrab();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("mousemove", (event) => {
      if (this.phase !== "playing" || this.peerConnected) return;
      if (document.pointerLockElement === this.dom.canvas) {
        this.yaw -= event.movementX * 0.0024;
        this.pitch = clamp(this.pitch - event.movementY * 0.0024, -1.1, 1.1);
      }
    });
    this.dom.canvas.addEventListener("click", () => {
      if (this.phase === "playing" && !this.peerConnected) this.dom.canvas.requestPointerLock?.();
    });
    window.addEventListener("resize", () => this.resize());
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.dom.modeFp.classList.toggle("active", mode === "fp");
    this.dom.modeTp.classList.toggle("active", mode === "tp");
  }

  async connect() {
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => {
      this.socket.emit(CASTLE_EVENTS.hostCreate, async (result) => {
        if (!result?.ok) return;
        this.roomCode = result.code;
        this.dom.roomCode.textContent = result.code;
        const url = await this.buildControllerUrl(result.code);
        this.dom.qr.src = await QRCode.toDataURL(url, {
          width: 440, margin: 2,
          color: { dark: "#e8dcc8", light: "#1a1610" },
          errorCorrectionLevel: "M",
        });
      });
    });
    this.socket.on(CASTLE_EVENTS.roomUpdate, ({ player }) => {
      this.peerConnected = Boolean(player?.connected);
      this.dom.peer.textContent = this.peerConnected ? `已连接：${player.name}` : "等待手机加入…";
      this.dom.start.disabled = !this.peerConnected;
    });
    this.socket.on(CASTLE_EVENTS.playerInput, (payload) => {
      this.latestInput = payload;
      this.inputAt = performance.now();
      if (typeof payload.light === "boolean") this.lightOn = payload.light;
      if (typeof payload.crouch === "boolean") this.crouch = payload.crouch;
    });
    this.socket.on(CASTLE_EVENTS.playerAction, (payload) => {
      if (payload.action === "grab") this.tryGrab();
    });
  }

  async buildControllerUrl(code) {
    let origin = location.origin;
    try {
      const response = await fetch("/api/config");
      const config = await response.json();
      if (config.controllerOrigin) origin = config.controllerOrigin;
    } catch { /* keep origin */ }
    const url = new URL("/castle/controller", origin);
    url.searchParams.set("room", code);
    return url.toString();
  }

  sendPhase(phase) {
    if (!this.socket?.connected) return;
    this.socket.emit(CASTLE_EVENTS.hostPhase, { phase, at: Date.now(), viewMode: this.viewMode });
  }

  sendEvent(payload) {
    if (!this.socket?.connected) return;
    this.socket.emit(CASTLE_EVENTS.hostEvent, payload);
  }

  toast(text) {
    this.dom.toast.textContent = text;
    this.dom.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.dom.toast.hidden = true; }, 2400);
  }

  // ---------- game ----------

  startGame(solo = false) {
    this.solo = solo;
    this.player = {
      x: ENTRANCE.x, z: ENTRANCE.z, y: 0,
      vx: 0, vz: 0,
    };
    this.yaw = 0;
    this.pitch = 0;
    this.lightOn = true;
    this.carried = 0;
    this.banked = 0;
    this.alertCount = 0;
    this.treasures = TREASURES.map((t) => ({ ...t, collected: false }));
    this.guards = GUARDS.map((g) => ({
      ...g,
      x: g.waypoints[0][0], z: g.waypoints[0][1], y: g.floorY,
      heading: 0, wpIndex: 0, state: "patrol", alert: 0,
    }));
    this.sceneBuilder.resetTreasures();
    this.dom.lobby.hidden = true;
    this.dom.over.hidden = true;
    this.dom.hud.hidden = false;
    this.phase = "playing";
    this.sendPhase("playing");
    this.updateHud();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  endGame(won) {
    this.phase = "finished";
    this.sendPhase("finished");
    this.dom.hud.hidden = true;
    this.dom.over.hidden = false;
    this.dom.overTitle.textContent = won ? "撤离成功" : "被守卫抓住了";
    this.dom.overDetail.textContent = `带回宝物 ${this.banked} 件` + (this.carried > 0 ? `，身上 ${this.carried} 件丢失` : "");
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  tryGrab() {
    if (this.phase !== "playing") return;
    const now = performance.now();
    if (now - this.lastGrabAt < GRAB_COOLDOWN_MS) return;
    this.lastGrabAt = now;
    const target = findGrabbable(
      { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.yaw, pitch: this.pitch },
      this.treasures,
      GRAB_CONFIG,
    );
    if (!target) return;
    target.collected = true;
    this.carried += target.value;
    this.sceneBuilder.setTreasureCollected(target.id);
    this.sendEvent({ event: "collect", value: target.value, total: this.carried });
    this.updateHud();
    this.toast(`拾取宝物 +${target.value}`);
  }

  updateHud() {
    this.dom.carried.textContent = String(this.carried);
    this.dom.banked.textContent = String(this.banked);
    this.dom.left.textContent = String(this.treasures.filter((t) => !t.collected).length);
  }

  // ---------- three ----------

  initThree() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.dom.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
    this.camera.position.set(0, 6, 14);

    this.sceneBuilder = new CastleSceneBuilder(this.scene);
    this.sceneBuilder.build();

    // Player avatar (visible in third person).
    this.avatar = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 20, 18),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.5 }),
    );
    body.scale.set(1, 1.18, 0.95);
    body.position.y = 0.68;
    this.avatar.add(body);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x33261d });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), eyeMat);
      eye.position.set(side * 0.14, 0.86, -0.33);
      this.avatar.add(eye);
      const blush = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 12),
        new THREE.MeshBasicMaterial({ color: 0xff9d9d }),
      );
      blush.position.set(side * 0.26, 0.74, -0.32);
      blush.rotation.y = side * -0.4 + Math.PI;
      this.avatar.add(blush);
    }

    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.4, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8 }),
    );
    pack.position.set(0, 0.72, 0.36);
    this.avatar.add(pack);

    const torchArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.6 }),
    );
    torchArm.position.set(0.34, 0.78, -0.2);
    torchArm.rotation.x = -1.1;
    torchArm.rotation.z = -0.4;
    this.avatar.add(torchArm);

    const torchHead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.5, metalness: 0.5 }),
    );
    torchHead.position.set(0.42, 0.92, -0.42);
    torchHead.rotation.x = -1.2;
    this.avatar.add(torchHead);

    this.scene.add(this.avatar);

    // Faint warm fill around the player so the avatar reads in the dark
    // even with the flashlight off.
    this.playerGlow = new THREE.PointLight(0xffc888, 2.2, 4.5, 2);
    this.scene.add(this.playerGlow);

    // The phone flashlight: spotlight glued to aim direction.
    this.flashlight = new THREE.SpotLight(0xfff2d0, 42, 26, 0.42, 0.45, 1.4);
    this.flashTarget = new THREE.Object3D();
    this.scene.add(this.flashTarget);
    this.flashlight.target = this.flashTarget;
    this.scene.add(this.flashlight);

    // Extraction beacon at the entrance.
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(EXTRACT_RADIUS, EXTRACT_RADIUS, 0.06, 32),
      new THREE.MeshBasicMaterial({ color: 0x54d88a, transparent: true, opacity: 0.4 }),
    );
    beacon.position.set(ENTRANCE.x, 0.04, ENTRANCE.z);
    this.scene.add(beacon);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.6, 5, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x54d88a, transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
    );
    beam.position.set(ENTRANCE.x, 2.5, ENTRANCE.z);
    this.scene.add(beam);
    this.beaconLight = new THREE.PointLight(0x54d88a, 8, 8, 2);
    this.beaconLight.position.set(ENTRANCE.x, 1.6, ENTRANCE.z);
    this.scene.add(this.beaconLight);

    this.resize();
  }

  readMove() {
    if (this.peerConnected && this.latestInput && performance.now() - this.inputAt < INPUT_STALE_MS) {
      return { x: this.latestInput.m[0], y: this.latestInput.m[1] };
    }
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    return { x, y };
  }

  readAim(dt) {
    const fresh = this.peerConnected && this.latestInput && performance.now() - this.inputAt < INPUT_STALE_MS;
    if (fresh && this.latestInput.seq > this.lastInputSeq) {
      const degreesToRadians = Math.PI / 180;
      this.yaw += this.latestInput.dyaw * degreesToRadians;
      this.pitch = clamp(this.pitch + this.latestInput.dpitch * degreesToRadians, -1.1, 1.1);
      this.lastInputSeq = this.latestInput.seq;
      return;
    }
    if (!document.pointerLockElement && this.solo) {
      if (this.keys.has("KeyQ")) this.yaw += 2.2 * dt;
      if (this.keys.has("KeyE")) this.yaw -= 2.2 * dt;
    }
  }

  frame() {
    const now = performance.now();
    const dt = clamp((now - this.lastFrameAt) / 1000, 0.001, 0.05);
    this.lastFrameAt = now;
    const time = now / 1000;

    this.sceneBuilder.update(time);

    if (this.phase === "playing") {
      this.readAim(dt);
      const move = this.readMove();

      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const moveLen = Math.hypot(move.x, move.y);
      const scale = moveLen > 1 ? 1 / moveLen : 1;
      const forwardAmount = move.y * scale;
      const strafeAmount = move.x * scale;
      this.crouchBlend += ((this.crouch ? 1 : 0) - this.crouchBlend) * Math.min(1, 10 * dt);
      const speed = PLAYER_SPEED + (PLAYER_CROUCH_SPEED - PLAYER_SPEED) * this.crouchBlend;
      const wx = (-sin * forwardAmount + cos * strafeAmount) * speed;
      const wz = (-cos * forwardAmount - sin * strafeAmount) * speed;
      this.player.vx += (wx - this.player.vx) * Math.min(1, 12 * dt);
      this.player.vz += (wz - this.player.vz) * Math.min(1, 12 * dt);

      let nx = this.player.x + this.player.vx * dt;
      let nz = this.player.z + this.player.vz * dt;
      [nx, nz] = collideWithWalls(nx, nz, PLAYER_RADIUS, WALLS, this.player.y);
      this.player.x = clamp(nx, -11.5, 11.5);
      this.player.z = clamp(nz, -8.5, 8.5);
      const gy = groundHeightAt(this.player.x, this.player.z, this.player.y, SLABS, STAIRS);
      this.player.y += (gy - this.player.y) * Math.min(1, 14 * dt);

      // Guards
      let alerted = 0;
      for (const guard of this.guards) {
        const caught = stepGuard(guard, {
          x: this.player.x, y: this.player.y, z: this.player.z,
          lightOn: this.lightOn, crouch: this.crouch,
        }, WALLS, STAIRS, SLABS, GUARD_CONFIG, dt);
        if (guard.state === "chase") alerted += 1;
        this.sceneBuilder.updateGuard(guard.id, guard.x, guard.y, guard.z, guard.heading, guard.alert ?? 0);
        if (caught) {
          const lost = Math.ceil(this.carried / 2);
          this.carried -= lost;
          this.player.x = ENTRANCE.x;
          this.player.z = ENTRANCE.z;
          this.player.y = 0;
          this.player.vx = 0;
          this.player.vz = 0;
          this.sendEvent({ event: "caught" });
          this.toast(lost > 0 ? `被抓住！丢了 ${lost} 件宝物` : "被抓住！送回入口");
          this.updateHud();
        }
      }
      this.alertCount = alerted;
      this.dom.alert.hidden = alerted === 0;
      this.dom.vignette.style.opacity = alerted > 0 ? "1" : "0";

      // Extraction
      const extractDist = Math.hypot(this.player.x - ENTRANCE.x, this.player.z - ENTRANCE.z);
      if (extractDist < EXTRACT_RADIUS && this.player.y < 0.6) {
        if (this.carried > 0) {
          this.banked += this.carried;
          this.sendEvent({ event: "extract" });
          this.toast(`宝物入库 +${this.carried}`);
          this.carried = 0;
          this.updateHud();
        }
        const remaining = this.treasures.filter((t) => !t.collected).length;
        if (remaining === 0) this.endGame(true);
      }

      // Grab hint: a treasure is in reach and inside the flashlight cone
      const grabbable = findGrabbable(
        { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.yaw, pitch: this.pitch },
        this.treasures,
        GRAB_CONFIG,
      );
      this.dom.grabHint.hidden = !grabbable;

      // Avatar + flashlight + camera
      this.avatar.position.set(this.player.x, this.player.y, this.player.z);
      this.avatar.rotation.y = this.yaw;
      this.avatar.visible = this.viewMode === "tp";
      this.avatar.scale.y = 1 - this.crouchBlend * 0.3;
      const speedNow = Math.hypot(this.player.vx, this.player.vz);
      this.avatar.position.y += Math.abs(Math.sin(time * 8)) * 0.05 * clamp(speedNow / PLAYER_SPEED, 0, 1);
      this.playerGlow.position.set(this.player.x, this.player.y + 1.2, this.player.z);

      const eyeY = this.player.y + 1.5 - this.crouchBlend * 0.55;
      const fx = -sin * Math.cos(this.pitch);
      const fy = Math.sin(this.pitch);
      const fz = -cos * Math.cos(this.pitch);
      this.flashlight.visible = this.lightOn;
      this.flashlight.position.set(this.player.x + fx * 0.3, eyeY - 0.25, this.player.z + fz * 0.3);
      this.flashTarget.position.set(this.player.x + fx * 8, eyeY + fy * 8, this.player.z + fz * 8);

      if (this.viewMode === "fp") {
        this.camera.position.set(this.player.x, eyeY, this.player.z);
        this.camera.rotation.set(0, 0, 0, "YXZ");
        this.camera.rotation.order = "YXZ";
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
      } else {
        const back = 3.4;
        const rawX = this.player.x + sin * Math.cos(this.pitch * 0.4) * back;
        const rawY = eyeY + 1.1 + Math.sin(-this.pitch * 0.4) * back * 0.5;
        const rawZ = this.player.z + cos * Math.cos(this.pitch * 0.4) * back;
        const clipped = clipCameraToWalls(
          { x: this.player.x, y: eyeY, z: this.player.z },
          { x: rawX, y: rawY, z: rawZ },
          WALLS,
          3.2,
        );
        this.camera.position.lerp(new THREE.Vector3(clipped.x, clipped.y, clipped.z), Math.min(1, 18 * dt));
        this.camera.lookAt(this.player.x - sin * 2, eyeY + Math.sin(this.pitch) * 3, this.player.z - cos * 2);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
