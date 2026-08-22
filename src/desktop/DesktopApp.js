import { PhoneSession } from "./PhoneSession.js";
import { LobbyClient } from "./LobbyClient.js";
import * as THREE from "three";
import { PlayerController } from "./PlayerController.js";
import { HorrorDirector } from "./HorrorDirector.js";
import { VillageDirector } from "./VillageDirector.js";
import { FoundPhoneDirector } from "./FoundPhoneDirector.js";
import { DoorDefenseDirector } from "./DoorDefenseDirector.js";
import { ShadowQuestDirector } from "./ShadowQuestDirector.js";
import { KnockDoorDirector } from "./KnockDoorDirector.js";
import { PresentationDirector } from "./PresentationDirector.js";
import { HandTrackingDirector } from "./HandTrackingDirector.js";
import { RightHandFlashlight } from "./RightHandFlashlight.js";
import { InventoryState } from "./InventoryState.js";
import { createGameAudio } from "./audio.js";
import { createScene } from "./create-scene.js";
import { EnvironmentLoadError } from "./environment/EnvironmentLoader.js";
import {
  ENVIRONMENT_DEFAULT_QUALITY,
  ENVIRONMENT_QUALITY_LEVELS,
} from "./environment/manifest.js";
import { createDesktopUI } from "./ui.js";
import { createDesktopNpcRuntime, transcribeVoiceClip } from "./npc/DesktopNpcRuntime.js";
import "./styles.css";

const LOBBY_ERROR_NOTES = {
  "cloud-unavailable": "云服务未配置：本机无法联机（可先用键鼠单人开始）",
  "lobby-not-found": "房间不存在或已结束",
  "lobby-full": "大厅已满（最多 8 台电脑）",
  "already-playing": "游戏已开始，无法加入",
  "already-joined": "已在房间里",
  timeout: "连接云端超时，请重试",
  "not-host": "只有房主可以开始游戏",
};

function isLocalVillageChunk(error) {
  if (typeof error?.url !== "string") return false;
  try {
    return new URL(error.url, globalThis.location?.href ?? "http://localhost/").pathname
      .startsWith("/assets/environment/elderboom-v1/chunks/");
  } catch {
    return false;
  }
}

const ENVIRONMENT_QUALITY_STORAGE_KEY = "corridor617-environment-quality";

function readStoredEnvironmentQuality() {
  try {
    const stored = globalThis.localStorage?.getItem?.(ENVIRONMENT_QUALITY_STORAGE_KEY);
    return ENVIRONMENT_QUALITY_LEVELS.includes(stored) ? stored : ENVIRONMENT_DEFAULT_QUALITY;
  } catch {
    return ENVIRONMENT_DEFAULT_QUALITY;
  }
}

function writeStoredEnvironmentQuality(quality) {
  try {
    globalThis.localStorage?.setItem?.(ENVIRONMENT_QUALITY_STORAGE_KEY, quality);
  } catch { /* storage unavailable */ }
}

function chunkLoadMessage(error) {
  if (error?.status === 404 && error?.phase === "response" && isLocalVillageChunk(error)) {
    return "村庄资源尚未准备好。";
  }
  if (error?.phase === "response" && Number(error?.status) >= 500) {
    return "村庄资源服务暂时不可用。";
  }
  if (error?.phase === "request") {
    return "村庄资源网络连接失败。";
  }
  return "村庄资源加载失败。";
}

function chunkInvalidMessage(error) {
  if (error?.phase === "integrity" || error?.phase === "validate") {
    return "村庄资源校验失败。";
  }
  if (error?.phase === "decode") {
    return "村庄资源无法解析。";
  }
  return error?.phase ? "村庄资源加载失败。" : "村庄资源无法解析。";
}

export function classifySceneError(error) {
  if (error?.name === "AbortError" || error?.phase === "abort" || error?.cause?.name === "AbortError") {
    return { code: "aborted", message: null, retryable: false };
  }
  const environmentError = error instanceof EnvironmentLoadError;
  const code = environmentError ? error.code : "scene-start";
  const messages = {
    "manifest-fetch": "村庄配置暂时无法载入。",
    "manifest-invalid": "村庄配置有误。",
    "chunk-load": chunkLoadMessage(error),
    "chunk-invalid": chunkInvalidMessage(error),
    "scene-start": "3D 场景启动失败。",
  };
  return {
    code,
    message: messages[code] ?? messages["scene-start"],
    retryable: environmentError ? error.retryable !== false : true,
  };
}

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
    this.knockDoor = null;
    this.presentation = null;
    this.npcRuntime = null;
    this.createNpcRuntime = createDesktopNpcRuntime;
    this.fetchImpl = globalThis.fetch?.bind(globalThis) ?? null;
    this.handTracking = null;
    this.rightHandFlashlight = null;
    this.createRightHandFlashlight = (options) => new RightHandFlashlight(options);
    this.inventory = new InventoryState([{ id: "spare-fuse", enabled: true }]);
    this.inventoryOpen = false;
    this.fallbackHolding = false;
    this.fallbackKeyDown = false;
    this.destroyed = false;
    this.sceneStartGeneration = 0;
    this.sceneStartAttempt = null;
    this.lastStartFallback = false;
    this.disposedScenes = new WeakSet();
    this.debugFrames = 0;
    this.debugShadowAutoplay = import.meta.env.DEV && new URLSearchParams(location.search).has("playShadow");
    this.debugShadowTriggered = false;
    this.lastFeedbackSequence = -1;
    this.currentTargetId = null;
    this.currentTargetEpoch = 0;
    this.handleStartClick = () => this.startGame(false);
    this.handleFallbackClick = () => this.startGame(true);
    this.handleSceneRetryClick = () => this.retrySceneStart();
    this.handleVisibilityChange = () => {
      if (this.started && document.hidden) this.setPaused(true);
    };
    this.handlePageHide = () => this.destroy();
    this.environmentQuality = readStoredEnvironmentQuality();
    this.environmentQualitySwitching = null;
    this.handleFallbackKeyDown = this.handleFallbackKeyDown.bind(this);
    this.handleFallbackKeyUp = this.handleFallbackKeyUp.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handlePhoneRoom = this.handlePhoneRoom.bind(this);
    this.handlePhonePeer = this.handlePhonePeer.bind(this);
    this.handlePhoneActionEvent = this.handlePhoneActionEvent.bind(this);
    this.handlePhoneHand = this.handlePhoneHand.bind(this);
    this.handlePhoneVoiceClip = this.handlePhoneVoiceClip.bind(this);
    this.handlePhoneVoiceStream = this.handlePhoneVoiceStream.bind(this);
    this.handleMenuCreate = this.handleMenuCreate.bind(this);
    this.handleMenuJoin = this.handleMenuJoin.bind(this);
    this.handleMenuSolo = this.handleMenuSolo.bind(this);
    this.handleLobbyStart = this.handleLobbyStart.bind(this);
    this.handleLobbyLeave = this.handleLobbyLeave.bind(this);
    this.handleLobbyState = this.handleLobbyState.bind(this);
    this.handleLobbyStarted = this.handleLobbyStarted.bind(this);
    this.handleLobbyEnded = this.handleLobbyEnded.bind(this);
    this.lobby = null;
    this.lobbyIsHost = false;
  }

  mount() {
    this.ui = createDesktopUI(this.root);
    this.phone = new PhoneSession();
    this.phone.addEventListener("room", this.handlePhoneRoom);
    this.phone.addEventListener("peer", this.handlePhonePeer);
    this.phone.addEventListener("action", this.handlePhoneActionEvent);
    this.phone.addEventListener("hand", this.handlePhoneHand);
    this.phone.addEventListener("voice-clip", this.handlePhoneVoiceClip);
    this.phone.addEventListener("voice-stream", this.handlePhoneVoiceStream);
    this.phone.start();

    // Local visual verification can start the keyboard path without a manual
    // click; the query is inert during normal pairing and has no UI impact.
    if (new URLSearchParams(location.search).get("autostart") === "keyboard") {
      queueMicrotask(() => this.startGame(true));
    }

    this.ui.elements.startButton.addEventListener("click", this.handleStartClick);
    this.ui.elements.fallbackButton.addEventListener("click", this.handleFallbackClick);
    this.ui.elements.sceneRetryButton.addEventListener("click", this.handleSceneRetryClick);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("keydown", this.handleFallbackKeyDown);
    window.addEventListener("keyup", this.handleFallbackKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
    window.addEventListener("pagehide", this.handlePageHide, { once: true });
    this.setupMainMenu();
  }

  setupMainMenu() {
    const elements = this.ui.elements;
    elements.menuOverlay.hidden = false;
    elements.menuCreate.addEventListener("click", this.handleMenuCreate);
    elements.menuJoin.addEventListener("click", this.handleMenuJoin);
    elements.menuJoinCode.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.handleMenuJoin();
    });
    elements.menuSolo.addEventListener("click", this.handleMenuSolo);
    elements.lobbyStart.addEventListener("click", this.handleLobbyStart);
    elements.lobbyLeave.addEventListener("click", this.handleLobbyLeave);
  }

  ensureLobby() {
    if (this.lobby) return this.lobby;
    this.lobby = new LobbyClient();
    this.lobby.addEventListener("state", this.handleLobbyState);
    this.lobby.addEventListener("started", this.handleLobbyStarted);
    this.lobby.addEventListener("ended", this.handleLobbyEnded);
    return this.lobby;
  }

  async handleMenuCreate() {
    if (this.destroyed) return;
    const note = this.ui.elements.menuNote;
    note.textContent = "正在创建房间…";
    const lobby = this.ensureLobby();
    const result = await lobby.create();
    if (this.destroyed) return;
    if (!result.ok) {
      note.textContent = LOBBY_ERROR_NOTES[result.reason] ?? "创建失败，请重试";
      return;
    }
    this.lobbyIsHost = true;
    this.showLobbyView();
  }

  async handleMenuJoin() {
    if (this.destroyed) return;
    const elements = this.ui.elements;
    const code = (elements.menuJoinCode.value || "").trim();
    if (!/^\d{6}$/.test(code)) {
      elements.menuNote.textContent = "请输入 6 位数字房号";
      return;
    }
    elements.menuNote.textContent = "正在加入房间…";
    const lobby = this.ensureLobby();
    const result = await lobby.join(code);
    if (this.destroyed) return;
    if (!result.ok) {
      elements.menuNote.textContent = LOBBY_ERROR_NOTES[result.reason] ?? "加入失败，请检查房号";
      return;
    }
    this.lobbyIsHost = false;
    this.showLobbyView();
  }

  handleMenuSolo() {
    if (this.destroyed) return;
    this.ui.elements.menuOverlay.hidden = true;
    this.startGame(true);
  }

  showLobbyView() {
    const elements = this.ui.elements;
    elements.menuOverlay.hidden = true;
    elements.lobbyOverlay.hidden = false;
    elements.lobbyStart.hidden = !this.lobbyIsHost;
    elements.lobbyWaiting.hidden = this.lobbyIsHost;
    elements.lobbyNote.textContent = "";
    if (this.lobby?.code) elements.lobbyRoomCode.textContent = this.lobby.code;
  }

  async handleLobbyStart() {
    if (this.destroyed || !this.lobby) return;
    const result = await this.lobby.start();
    if (this.destroyed) return;
    if (!result.ok) {
      this.ui.elements.lobbyNote.textContent = LOBBY_ERROR_NOTES[result.reason] ?? "开始失败，请重试";
      return;
    }
    this.enterGameFromLobby();
  }

  handleLobbyLeave() {
    if (this.destroyed) return;
    this.lobby?.leave();
    this.lobbyIsHost = false;
    const elements = this.ui.elements;
    elements.lobbyOverlay.hidden = true;
    elements.menuOverlay.hidden = false;
    elements.menuNote.textContent = "";
  }

  handleLobbyState({ detail: state }) {
    if (this.destroyed || !state) return;
    const elements = this.ui.elements;
    elements.lobbyRoomCode.textContent = state.code;
    const selfId = this.lobby?.selfSocketId;
    elements.lobbyPlayers.innerHTML = state.players.map((player, index) => {
      const safeName = String(player.name).replace(/[<>&"]/g, "");
      const tags = [];
      if (player.isHost) tags.push('<span class="lobby-row-tag">主机</span>');
      if (player.socketId === selfId) tags.push('<span class="lobby-row-self">本机</span>');
      return `<li class="lobby-row${player.isHost ? " is-host" : ""}">`
        + `<span class="lobby-row-index">${String(index + 1).padStart(2, "0")}</span>`
        + `<span class="lobby-row-name">${safeName}</span>`
        + `<span class="lobby-row-tags">${tags.join("")}</span>`
        + "</li>";
    }).join("");
  }

  handleLobbyStarted() {
    if (this.destroyed) return;
    this.enterGameFromLobby();
  }

  handleLobbyEnded() {
    if (this.destroyed) return;
    this.lobbyIsHost = false;
    const elements = this.ui.elements;
    elements.lobbyOverlay.hidden = true;
    elements.menuOverlay.hidden = false;
    elements.menuNote.textContent = "房主已退出，大厅已解散";
  }

  enterGameFromLobby() {
    this.ui.elements.lobbyOverlay.hidden = true;
    this.ui.elements.menuOverlay.hidden = true;
    this.startGame(false);
  }

  startGame(fallback) {
    if (this.destroyed) return Promise.resolve();
    if (this.started) return this.sceneStartAttempt?.promise ?? Promise.resolve();
    this.lastStartFallback = fallback === true;
    return this.beginSceneStart(this.lastStartFallback, "start");
  }

  beginSceneStart(fallback, origin) {
    const attempt = {
      generation: this.sceneStartGeneration + 1,
      controller: new AbortController(),
      origin,
      promise: null,
    };
    this.sceneStartGeneration = attempt.generation;
    this.sceneStartAttempt = attempt;
    attempt.promise = this.runSceneStart(attempt, fallback);
    return attempt.promise;
  }

  ownsSceneStart(attempt) {
    return Boolean(
      !this.destroyed
      && this.sceneStartAttempt === attempt
      && this.sceneStartGeneration === attempt.generation
      && !attempt.controller.signal.aborted
    );
  }

  disposeScene(experience) {
    if (!experience || typeof experience.dispose !== "function") return;
    this.disposedScenes ??= new WeakSet();
    if (this.disposedScenes.has(experience)) return;
    this.disposedScenes.add(experience);
    experience.dispose({ clearHost: this.experience === experience });
  }

  abortSceneStart(reason = "superseded") {
    const attempt = this.sceneStartAttempt;
    if (!attempt) return false;
    this.sceneStartAttempt = null;
    this.sceneStartGeneration += 1;
    attempt.controller.abort(new DOMException(`Scene start ${reason}`, "AbortError"));
    return true;
  }

  retrySceneStart() {
    if (this.destroyed) return Promise.resolve();
    if (this.sceneStartAttempt?.origin === "retry") return this.sceneStartAttempt.promise;
    if (this.sceneStartAttempt) {
      this.abortSceneStart("superseded by retry");
      try {
        this.disposeRuntime();
      } catch (cleanupError) {
        console.error("Failed to clean up scene startup:", cleanupError);
      }
      this.started = false;
    } else if (this.started) {
      return Promise.resolve();
    }
    return this.beginSceneStart(this.lastStartFallback, "retry");
  }

  async runSceneStart(attempt, fallback) {
    let experience = null;
    this.started = true;
    this.fallback = fallback;
    this.audio.start();
    this.ui.showSceneError?.(null);
    this.ui.setCleanView?.(false);
    this.ui.showLoading(true);
    this.ui.showPairing(false);
    try {
      experience = await createScene(this.ui.elements.sceneHost, {
        signal: attempt.controller.signal,
        environmentQuality: this.environmentQuality,
      });
      if (!this.ownsSceneStart(attempt)) {
        this.disposeScene(experience);
        return;
      }
      this.experience = experience;
      const handTracking = new HandTrackingDirector({
        camera: this.experience.camera,
        sendControllerEvent: (event) => this.phone?.send(event),
        onGesture: (event) => this.handleHandGesture(event),
        onInventoryGesture: (event) => this.handleTrackedInventoryGesture(event),
        getEquippedId: () => this.inventory.snapshot().equippedId,
        canPresentEquipment: () => this.canPresentEquipment(),
        canOpenInventory: () => this.canOpenInventory(),
        isInventoryOpen: () => this.inventoryOpen,
        getInventoryHoveredId: () => this.ui?.inventoryItemAtCursor?.()
          ?? this.inventory.snapshot().hoveredId
      });
      this.handTracking = handTracking;
      await handTracking.load({ signal: attempt.controller.signal });
      if (!this.ownsSceneStart(attempt)) {
        if (this.experience !== experience) this.disposeScene(experience);
        return;
      }
      handTracking.hand?.setHeldItem?.(this.experience.objects?.heldFuse ?? null);
      this.experience.objects?.knockDoor?.setArmAsset?.(handTracking.hand?.presentationModel);
      const rightHandFlashlight = this.createRightHandFlashlight({ camera: this.experience.camera });
      this.rightHandFlashlight = rightHandFlashlight;
      await rightHandFlashlight.load({ signal: attempt.controller.signal });
      if (!this.ownsSceneStart(attempt)) {
        if (this.experience !== experience) this.disposeScene(experience);
        return;
      }
      this.player = new PlayerController({
        ...this.experience,
        onInteract: (id, details) => this.handleInteraction(id, details),
        onAction: (action) => this.handlePhoneAction({ action }),
        onPrompt: (label) => this.ui.setPrompt(label),
        onTarget: (target) => this.handleTargetFocus(target),
      });
      this.player.setFallback(fallback);
      const isVillage = this.experience.objects?.environment?.manifest?.id === "elderboom-v1";
      this.director = isVillage ? new VillageDirector({
        experience: this.experience,
        ui: this.ui,
        audio: this.audio,
        inventory: this.inventory,
      }) : new HorrorDirector({
        experience: this.experience,
        ui: this.ui,
        audio: this.audio,
        inventory: this.inventory,
      });
      if (isVillage && this.experience.objects?.npcs) {
        try {
          this.npcRuntime = this.createNpcRuntime({
            npcSystem: this.experience.objects.npcs,
            camera: this.experience.camera,
            ui: this.ui,
            staticOccluderRoots: this.experience.staticOccluderRoots,
            onTranscript: (result) => this.handleRecognizedTranscript(result),
          });
        } catch (error) {
          console.warn("NPC voice runtime unavailable; village movement remains active.", error);
        }
      }
      this.foundPhone = new FoundPhoneDirector({
        experience: this.experience,
        player: this.player,
        audio: this.audio,
        sendControllerEvent: (event) => this.phone?.send(event),
        handTracking: this.handTracking,
      });
      this.doorDefense = !isVillage && this.experience.objects?.exitDoor ? new DoorDefenseDirector({
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
      }) : null;
      this.knockDoor = isVillage && this.experience.objects?.knockDoor ? new KnockDoorDirector({
        experience: this.experience,
        player: this.player,
        audio: this.audio,
        ui: this.ui,
        handTracking: this.handTracking,
      }) : null;
      this.presentation = isVillage && this.experience.objects?.presentationPaper
        ? new PresentationDirector({
          ui: this.ui,
          phone: this.phone,
          paper: this.experience.objects.presentationPaper,
          fetchImpl: this.fetchImpl,
        })
        : null;
      this.shadowQuest = !isVillage && this.experience.objects?.shadowQuest ? new ShadowQuestDirector({
        experience: this.experience,
        player: this.player,
        ui: this.ui,
        audio: this.audio,
      }) : null;
      this.applyDebugStart();
      this.ui.showLoading(false);
      this.ui.setCleanView?.(true);
      this.lastFrame = performance.now();
      this.frame = requestAnimationFrame((time) => this.tick(time));
      if (this.sceneStartAttempt === attempt) this.sceneStartAttempt = null;
    } catch (error) {
      if (!this.ownsSceneStart(attempt)) {
        if (experience && this.experience !== experience) this.disposeScene(experience);
        return;
      }
      const presentation = classifySceneError(error);
      if (presentation.code !== "aborted") console.error(error);
      this.sceneStartAttempt = null;
      try {
        this.disposeRuntime();
      } catch (cleanupError) {
        console.error("Failed to clean up scene startup:", cleanupError);
      } finally {
        this.started = false;
        this.ui.setCleanView?.(false);
        this.ui.showLoading(false);
        if (presentation.code !== "aborted") this.ui.showPairing(true);
        if (presentation.code !== "aborted") this.ui.showSceneError?.(presentation);
      }
    }
  }

  async setEnvironmentQuality(quality) {
    if (this.destroyed) return this.environmentQuality;
    if (!ENVIRONMENT_QUALITY_LEVELS.includes(quality)) return this.environmentQuality;
    if (quality === this.environmentQuality && !this.environmentQualitySwitching) return this.environmentQuality;
    if (this.environmentQualitySwitching) await this.environmentQualitySwitching.catch(() => null);
    if (quality === this.environmentQuality) return this.environmentQuality;
    const previousQuality = this.environmentQuality;
    this.environmentQuality = quality;
    writeStoredEnvironmentQuality(quality);
    if (!this.experience?.setEnvironmentQuality) return quality;
    const attempt = (async () => {
      this.ui.showLoading(true);
      try {
        await this.experience.setEnvironmentQuality(quality);
        return quality;
      } finally {
        this.ui.showLoading(false);
      }
    })();
    this.environmentQualitySwitching = attempt;
    try {
      return await attempt;
    } catch (error) {
      console.error("Failed to switch environment quality:", error);
      if (this.environmentQuality === quality) {
        this.environmentQuality = previousQuality;
        writeStoredEnvironmentQuality(previousQuality);
      }
      const presentation = classifySceneError(error);
      if (presentation.code !== "aborted") this.ui.showSceneError?.(presentation);
      return previousQuality;
    } finally {
      if (this.environmentQualitySwitching === attempt) this.environmentQualitySwitching = null;
    }
  }

  handlePhoneAction(payload = {}) {
    if (this.destroyed) return;
    const { action, settings } = payload;
    if (action === "presentation-open") return this.presentation?.open({ source: payload.source ?? "settings" });
    if (action === "presentation-next") return this.presentation?.next();
    if (action === "presentation-prev") return this.presentation?.previous();
    if (action === "presentation-close") {
      const closed = this.presentation?.close();
      if (closed && this.paused) this.setPaused(false, false);
      return closed;
    }
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
      if (ENVIRONMENT_QUALITY_LEVELS.includes(settings?.quality)) {
        void this.setEnvironmentQuality(settings.quality);
      }
    }
    if (action === "voice-recording") {
      const active = payload.active === true;
      this.ui.setVoiceRecording(active);
      if (active) this.npcRuntime?.beginCapture?.();
    }
    if (action === "voice-transcript") {
      const result = {
        transcript: payload.transcript,
        confidence: payload.confidence,
        voiceLevel: payload.voiceLevel,
      };
      if (payload.interim !== undefined) result.interim = payload.interim === true;
      const transcript = this.handleRecognizedTranscript(result);
      if (result.interim) return Boolean(transcript);
      return this.npcRuntime?.acceptTranscript?.(result) ?? Boolean(transcript);
    }
    if (action === "pause") this.setPaused(true);
    if (action === "resume") this.setPaused(false);
  }

  handleRecognizedTranscript(result = {}) {
    const transcript = String(result.transcript ?? "").trim();
    if (!transcript) return "";
    const interim = result.interim === true;
    if (interim) this.ui?.setPlayerTranscript?.(transcript, true, 0);
    else this.ui?.setPlayerTranscript?.(transcript, true);
    // A PPT keyword is intentionally actionable as soon as an interim
    // hypothesis contains it; NPC dialogue still waits for the final result.
    this.tryPresentationVoiceTrigger(transcript);
    return transcript;
  }

  isNearStoryDoor() {
    if (this.currentTargetId === "knock-door") return true;
    const door = this.experience?.objects?.knockDoor?.root;
    const camera = this.experience?.camera;
    if (!door?.getWorldPosition || !camera?.position) return false;
    return door.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position) <= 3.6;
  }

  tryPresentationVoiceTrigger(transcript) {
    if (!this.presentation || this.presentation.isOpen() || !this.isNearStoryDoor()) return false;
    if (!/(?:ppt|\u5e7b\u706f\u7247|\u6f14\u793a\u6587\u7a3f|\u7b54\u8fa9)/i.test(String(transcript))) return false;
    this.presentation.showPaper();
    this.ui?.setPrompt?.("抓取 PPT");
    return true;
  }

  canOpenInventory() {
    return Boolean(
      this.started
      && this.player
      && !this.fallback
      && !this.paused
      && !this.destroyed
      && !this.inventoryOpen
      && !this.presentation?.isOpen?.()
      && !this.doorDefense?.isCinematic?.()
      && !this.knockDoor?.isCinematic?.()
      && !this.foundPhone?.isInspecting?.()
      && !this.shadowQuest?.isCinematic?.()
    );
  }

  canPresentEquipment() {
    return Boolean(
      this.started
      && !this.fallback
      && !this.paused
      && !this.destroyed
      && !this.inventoryOpen
      && !this.presentation?.isOpen?.()
      && !this.doorDefense?.isCinematic?.()
      && !this.knockDoor?.isCinematic?.()
      && !this.foundPhone?.isInspecting?.()
      && !this.shadowQuest?.isCinematic?.()
    );
  }

  handleInventoryPointer({ phase, dx, dy, entryY } = {}) {
    if (phase === "open") {
      if (!this.canOpenInventory()) return false;
      this.inventoryOpen = true;
      this.handTracking?.setPaused?.(true);
      this.ui?.setInventory?.(this.inventory.snapshot(), { entryEdge: "right", entryY });
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
      if (hoveredId && this.inventory.equip(hoveredId)) this.presentEquippedItem(hoveredId);
      this.closeInventory();
      return true;
    }
    if (phase === "cancel") {
      this.closeInventory();
      return true;
    }
    return false;
  }

  handleTrackedInventoryGesture(event = {}) {
    const phaseByType = {
      open: "open",
      move: "move",
      commit: "commit",
      cancel: "cancel",
    };
    const phase = phaseByType[event.type];
    if (!phase) return false;
    return this.handleInventoryPointer({
      phase,
      dx: event.dx,
      dy: event.dy,
      entryY: event.entryY,
    });
  }

  presentEquippedItem(id) {
    if (!id || this.inventory.snapshot().equippedId !== id) return false;
    if (id === "spare-fuse") {
      this.handTracking?.hand?.setHeldItem?.(this.experience?.objects?.heldFuse ?? null);
    }
    this.handTracking?.presentEquippedItem?.();
    return true;
  }

  closeInventory() {
    if (!this.inventoryOpen) return false;
    this.inventoryOpen = false;
    this.handTracking?.setPaused?.(false);
    this.inventory.setHovered(null);
    this.ui?.closeInventory?.();
    return true;
  }

  clearTransientInteractionState(reason = "unspecified") {
    this.lastTransientClearReason = reason;
    let cleanupError = null;
    const runCleanup = (cleanup) => {
      try {
        cleanup();
      } catch (error) {
        cleanupError ??= error;
      }
    };
    runCleanup(() => this.ui?.setVoiceRecording?.(false));
    runCleanup(() => {
      if (!this.closeInventory()) this.inventory?.setHovered?.(null);
    });
    runCleanup(() => this.presentation?.close?.());
    runCleanup(() => this.player?.resetCrouch?.());
    runCleanup(() => this.handTracking?.suppressEquipment?.());
    runCleanup(() => this.releaseFallbackHold());
    if (cleanupError) throw cleanupError;
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
      || this.presentation?.isOpen?.()
      || this.doorDefense?.isCinematic()
      || this.knockDoor?.isCinematic()
      || this.foundPhone?.isInspecting()
      || this.shadowQuest?.isCinematic()
    ) return false;
    if (id === "presentation-paper") {
      return this.presentation?.open({ source: "door" }) ?? false;
    }
    if (this.foundPhone?.handleInteraction(id, details)) {
      if (this.foundPhone.isInspecting?.()) this.clearTransientInteractionState("cinematic:found-phone");
      return true;
    }
    if (this.shadowQuest?.handleInteraction(id)) {
      if (this.shadowQuest.isCinematic?.()) this.clearTransientInteractionState("cinematic:shadow-quest");
      return true;
    }
    return this.director?.handleInteraction(id, details) ?? false;
  }

  handleHandGesture(event) {
    if (
      event?.type !== "grab"
      || !this.currentTargetId
      || this.destroyed
      || this.paused
      || this.inventoryOpen
      || this.presentation?.isOpen?.()
      || event?.targetId !== this.currentTargetId
      || event?.targetEpoch !== this.currentTargetEpoch
      || this.doorDefense?.isCinematic()
      || this.knockDoor?.isCinematic()
      || this.foundPhone?.isInspecting()
      || this.shadowQuest?.isCinematic()
    ) return false;
    if (this.currentTargetId === "presentation-paper") {
      return this.presentation?.open({ source: "door" }) ?? false;
    }
    if (this.currentTargetId === "knock-door") return false;
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

  handlePhoneVoiceClip({ detail }) {
    if (this.destroyed) return false;
    if (this.npcRuntime?.acceptVoiceClip) {
      return Promise.resolve()
        .then(() => this.npcRuntime.acceptVoiceClip(detail))
        .then((accepted) => Boolean(accepted))
        .catch(() => false);
    }
    return this.transcribePhoneClip(detail);
  }

  async transcribePhoneClip(clip) {
    try {
      const result = await transcribeVoiceClip(clip, {
        fetchImpl: this.fetchImpl ?? globalThis.fetch?.bind(globalThis),
      });
      const transcript = String(result?.transcript ?? "").trim();
      if (!transcript || this.destroyed) return false;
      this.handleRecognizedTranscript(result);
      this.npcRuntime?.acceptTranscript?.(result);
      return true;
    } catch {
      return false;
    }
  }

  handlePhoneVoiceStream({ detail }) {
    if (this.destroyed) return false;
    return this.npcRuntime?.acceptVoiceFrame?.(detail) ?? false;
  }

  handlePeer(connected) {
    if (this.destroyed) return;
    if (connected) {
      this.ui.setConnected(true);
      if (!this.started || this.fallback) return;
      this.ui.showPairing(false);
      this.phone?.send({ type: "target-focus", id: this.currentTargetId });
      this.presentation?.sendState?.();
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
    runDisconnectStep(() => this.clearTransientInteractionState("peer-disconnect"));
    if (this.started) {
      runDisconnectStep(() => this.foundPhone?.release?.());
      runDisconnectStep(() => this.doorDefense?.abort?.());
      runDisconnectStep(() => this.knockDoor?.abort?.());
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
      runPauseStep(() => this.clearTransientInteractionState("pause"));
      runPauseStep(() => this.handTracking?.setPaused(true));
      runPauseStep(() => this.foundPhone?.release?.());
      runPauseStep(() => this.doorDefense?.abort?.());
      runPauseStep(() => this.knockDoor?.abort?.());
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
    try {
      if (!this.paused) {
        this.elapsed += delta;
        const phoneInput = this.phone.currentInput();
        const presentationOpen = this.presentation?.isOpen?.() === true;
        const gameplayInput = this.inventoryOpen || presentationOpen ? {
          ...phoneInput,
          move: { x: 0, y: 0 },
          viewDelta: { yaw: 0, pitch: 0 },
          clutch: false,
          crouch: false,
        } : { ...phoneInput, crouch: phoneInput.crouch === true };
        this.player.setControllerInput(gameplayInput, this.phone.connected);
        this.player.update(delta);
        this.rightHandFlashlight?.update?.(delta, {
          speed: Math.hypot(this.player.velocity.x, this.player.velocity.z),
          maxSpeed: this.player.movementSpeed,
        });
        this.handTracking?.update(delta);
        this.sendControlFeedback(phoneInput);
        this.experience.world.timestep = delta;
        this.experience.world.step();
        this.player.syncAfterPhysics();
        this.experience.update(delta, this.elapsed);
        this.npcRuntime?.update?.();
        this.foundPhone?.update(delta);
        const doorWasCinematic = this.doorDefense?.isCinematic?.() === true;
        if (!this.inventoryOpen && !presentationOpen) this.doorDefense?.update(delta);
        if (!doorWasCinematic && this.doorDefense?.isCinematic?.()) {
          this.clearTransientInteractionState("cinematic:door-defense");
        }
        const knockWasCinematic = this.knockDoor?.isCinematic?.() === true;
        if (!this.inventoryOpen && !presentationOpen) this.knockDoor?.update(delta, { focused: this.currentTargetId === "knock-door" });
        if (!knockWasCinematic && this.knockDoor?.isCinematic?.()) {
          this.clearTransientInteractionState("cinematic:knock-door");
        }
        this.shadowQuest?.update(delta, this.elapsed);
        if (this.debugShadowAutoplay && !this.debugShadowTriggered && this.shadowQuest?.isAvailable()) {
          this.debugShadowTriggered = this.shadowQuest.handleInteraction("shadow-window");
        }
        const cinematicOwned = this.doorDefense?.isCinematic()
          || this.knockDoor?.isCinematic()
          || this.foundPhone?.isInspecting()
          || this.shadowQuest?.isCinematic()
          || presentationOpen;
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
            objective: this.director?.story?.current?.() ?? null,
            shadowQuest: this.shadowQuest?.complete ? "complete" : this.shadowQuest?.isCinematic() ? "cinematic" : this.shadowQuest?.isAvailable() ? "available" : "hidden",
            delta: Number(delta.toFixed(4)),
            vx: Number(this.player.velocity.x.toFixed(2)),
            vz: Number(this.player.velocity.z.toFixed(2)),
            frames: this.debugFrames,
          });
        }
      }
    } catch (error) {
      this.reportRuntimeFailure(error);
    }
    try {
      this.experience.renderer.render(this.experience.scene, this.experience.camera);
      this.sampleDebugPixels();
    } catch (error) {
      this.reportRuntimeFailure(error);
    }
    this.frame = requestAnimationFrame((nextTime) => this.tick(nextTime));
  }

  reportRuntimeFailure(error) {
    const message = String(error?.message ?? error ?? "Unknown runtime error");
    if (this.lastRuntimeFailure === message) return;
    this.lastRuntimeFailure = message;
    console.error("Desktop runtime failure:", error);
    fetch("/api/runtime-diagnostic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, stack: error?.stack ?? null }),
    }).catch(() => {});
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
    runCleanup(() => this.clearTransientInteractionState("runtime-dispose"));
    runCleanup(() => this.npcRuntime?.destroy?.());
    runCleanup(() => this.foundPhone?.destroy());
    runCleanup(() => this.doorDefense?.destroy());
    runCleanup(() => this.knockDoor?.destroy());
    runCleanup(() => this.presentation?.destroy?.());
    runCleanup(() => this.director?.destroy?.());
    runCleanup(() => this.rightHandFlashlight?.destroy?.());
    runCleanup(() => this.handTracking?.destroy());
    runCleanup(() => this.shadowQuest?.destroy());
    runCleanup(() => this.player?.destroy());
    runCleanup(() => this.disposeScene(this.experience));
    this.foundPhone = null;
    this.npcRuntime = null;
    this.doorDefense = null;
    this.knockDoor = null;
    this.presentation = null;
    this.handTracking = null;
    this.rightHandFlashlight = null;
    this.shadowQuest = null;
    this.director = null;
    this.player = null;
    this.experience = null;
    if (cleanupError) throw cleanupError;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortSceneStart("destroyed");
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
    runCleanup(() => this.ui?.elements?.startButton?.removeEventListener("click", this.handleStartClick));
    runCleanup(() => this.ui?.elements?.fallbackButton?.removeEventListener("click", this.handleFallbackClick));
    runCleanup(() => this.ui?.elements?.sceneRetryButton?.removeEventListener("click", this.handleSceneRetryClick));
    runCleanup(() => document.removeEventListener("visibilitychange", this.handleVisibilityChange));
    runCleanup(() => window.removeEventListener("keydown", this.handleFallbackKeyDown));
    runCleanup(() => window.removeEventListener("keyup", this.handleFallbackKeyUp));
    runCleanup(() => window.removeEventListener("blur", this.handleWindowBlur));
    runCleanup(() => window.removeEventListener("pagehide", this.handlePageHide));
    runCleanup(() => phone?.removeEventListener?.("room", this.handlePhoneRoom));
    runCleanup(() => phone?.removeEventListener?.("peer", this.handlePhonePeer));
    runCleanup(() => phone?.removeEventListener?.("action", this.handlePhoneActionEvent));
    runCleanup(() => phone?.removeEventListener?.("hand", this.handlePhoneHand));
    runCleanup(() => phone?.removeEventListener?.("voice-clip", this.handlePhoneVoiceClip));
    runCleanup(() => phone?.removeEventListener?.("voice-stream", this.handlePhoneVoiceStream));
    runCleanup(() => this.disposeRuntime());
    runCleanup(() => this.audio.dispose());
    runCleanup(() => this.lobby?.destroy());
    runCleanup(() => phone?.destroy());
    if (this.phone === phone) this.phone = null;
    if (cleanupError) throw cleanupError;
  }
}
