import * as THREE from "three";
import { classifyFollowUp } from "../../shared/npc-cues.js";
import { NpcAttentionMachine, ATTENTION_STATES } from "../../shared/npc-attention-machine.js";
import { resolveNpcListener } from "../../shared/npc-listener-resolver.js";

const TERMINAL_STATES = new Set([
  ATTENTION_STATES.IDLE,
  ATTENTION_STATES.CANCELLED,
  ATTENTION_STATES.TIMED_OUT,
  ATTENTION_STATES.CONVERSATION_REQUESTED,
]);

function voiceUrl(npcId, phase) {
  return `/assets/npcs/voices/${npcId}-${phase}.wav`;
}

export class NpcConversationCoordinator {
  constructor({
    npcSystem,
    spatialVoice,
    roster,
    performer,
    camera,
    now = () => Date.now(),
    onStatus = null,
    onRecording = null,
    realtimeFactory = null,
    transcriber = null,
  } = {}) {
    if (!npcSystem || !spatialVoice || !roster || !performer || !camera) {
      throw new TypeError("NpcConversationCoordinator requires village, voice, roster, performer, and camera");
    }
    this.npcSystem = npcSystem;
    this.spatialVoice = spatialVoice;
    this.roster = roster;
    this.performer = performer;
    this.camera = camera;
    this.onStatus = onStatus;
    this.onRecording = onRecording;
    this.realtimeFactory = realtimeFactory;
    this.transcriber = transcriber;
    this.machine = new NpcAttentionMachine({ now, followUpMs: 5_000 });
    this.captureMode = "callout";
    this.captureGeneration = 0;
    this.activeNpcId = null;
    this.realtime = null;
    this.destroyed = false;
  }

  playerPosition() {
    return this.camera.getWorldPosition?.(new THREE.Vector3()) ?? this.camera.position.clone();
  }

  playerForward() {
    return this.camera.getWorldDirection?.(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, -1);
  }

  setStatus(message, detail = null) {
    this.onStatus?.({ message, detail, state: this.machine.state, npcId: this.activeNpcId ?? this.machine.npcId });
  }

  beginCapture() {
    if (this.destroyed) return null;
    this.spatialVoice.interrupt();
    this.realtime?.interrupt?.();
    if (this.activeNpcId) {
      this.captureMode = "conversation";
      this.captureGeneration = this.machine.generation;
    } else if (this.machine.state === ATTENTION_STATES.AWAITING_INTENT) {
      this.captureMode = "intent";
      this.captureGeneration = this.machine.generation;
    } else {
      this.captureMode = "callout";
      this.captureGeneration = this.machine.startCapture();
    }
    this.onRecording?.(true);
    this.setStatus(this.captureMode === "callout" ? "正在呼叫村民" : "正在聆听");
    return this.captureGeneration;
  }

  cancelCapture() {
    this.onRecording?.(false);
    this.spatialVoice.interrupt();
    if (!this.activeNpcId && this.machine.state === ATTENTION_STATES.CAPTURING_CALLOUT) this.machine.reset();
    this.setStatus("已取消");
  }

  async acceptVoiceClip(clip) {
    if (!this.transcriber) {
      this.onRecording?.(false);
      this.setStatus("本地语音识别未启用，可使用文字演示输入");
      return false;
    }
    const generation = this.captureGeneration;
    try {
      const result = await this.transcriber(clip);
      if (generation !== this.captureGeneration) return false;
      return this.acceptTranscript(result);
    } catch {
      if (generation === this.captureGeneration) this.setStatus("没有听清，请再说一次");
      return false;
    }
  }

  acceptVoiceFrame(frame) {
    if (!this.realtime?.acceptVoiceFrame) return false;
    return this.realtime.acceptVoiceFrame(frame) === true;
  }

  async acceptTranscript({ transcript = "", voiceLevel = 0.5, confidence = 1 } = {}) {
    if (this.destroyed) return false;
    this.onRecording?.(false);
    const utterance = String(transcript).trim();
    if (!utterance) {
      this.setStatus("没有听清，请再说一次");
      return false;
    }
    if (this.captureMode === "conversation" && this.activeNpcId) {
      return this.submitConversationTurn(utterance);
    }
    if (this.captureMode === "intent" && this.machine.state === ATTENTION_STATES.AWAITING_INTENT) {
      return this.acceptIntent(utterance, confidence);
    }
    return this.acceptCallout(utterance, voiceLevel);
  }

  async acceptCallout(transcript, voiceLevel) {
    const generation = this.captureGeneration;
    if (!this.machine.isCurrent(generation) || this.machine.state !== ATTENTION_STATES.CAPTURING_CALLOUT) return false;
    const result = resolveNpcListener({
      transcript,
      voiceLevel,
      playerPosition: this.playerPosition(),
      playerForward: this.playerForward(),
      npcs: this.npcSystem.snapshots(),
    });
    if (!result.listener) {
      this.machine.reset();
      this.setStatus("没有村民回应");
      return false;
    }
    if (!this.machine.notice({ npcId: result.listener.id, hearingRadius: result.hearingRadius }, generation)) return false;
    const playerPosition = this.playerPosition();
    this.npcSystem.notice(result.listener.id, playerPosition);
    const performance = await this.performer.perform({
      npcId: result.listener.id,
      phase: "notice",
      utterance: transcript,
      generation,
      isCurrent: (token) => this.machine.isCurrent(token) && this.machine.state === ATTENTION_STATES.NPC_NOTICED,
    });
    if (!performance) return false;
    this.npcSystem.perform(result.listener.id, performance, playerPosition);
    await this.spatialVoice.speak(result.listener.id, {
      speech: performance.speech,
      audioUrl: performance.source === "local" ? voiceUrl(result.listener.id, "notice") : null,
    });
    if (!this.machine.acknowledged(generation)) return false;
    this.setStatus(`${this.roster.get(result.listener.id).displayName}正在等你说明来意`, { hearingRadius: result.hearingRadius });
    return true;
  }

  async acceptIntent(utterance, confidence) {
    const generation = this.machine.generation;
    const intent = classifyFollowUp(utterance, { confidence });
    if (!this.machine.submitIntent(intent, generation)) return false;
    const npcId = this.machine.npcId;
    if (intent.kind === "cancel") {
      await this.speakPhase(npcId, "dismiss", utterance, generation);
      this.setStatus("对话已取消");
      return true;
    }
    if (intent.kind === "ambiguous") {
      if (this.machine.state === ATTENTION_STATES.TIMED_OUT) {
        this.setStatus("对方没有听懂，呼叫结束");
        return true;
      }
      const spoken = await this.speakPhase(npcId, "clarify", utterance, generation);
      if (spoken) this.machine.clarificationDelivered(generation);
      this.setStatus("请再具体说明一次");
      return spoken;
    }
    const request = this.machine.consumeConversationRequest();
    if (!request) return false;
    return this.openConversation(request);
  }

  async speakPhase(npcId, phase, utterance, generation = this.machine.generation) {
    const performance = await this.performer.perform({
      npcId,
      phase,
      utterance,
      generation,
      isCurrent: (token) => this.machine.isCurrent(token),
    });
    if (!performance) return false;
    const playerPosition = this.playerPosition();
    this.npcSystem.perform(npcId, performance, playerPosition);
    await this.spatialVoice.speak(npcId, {
      speech: performance.speech,
      audioUrl: performance.source === "local" ? voiceUrl(npcId, phase) : null,
    });
    return true;
  }

  async openConversation(request) {
    this.activeNpcId = request.npcId;
    this.setStatus(`正在与${this.roster.get(request.npcId).displayName}交谈`);
    if (this.realtimeFactory) {
      try {
        this.realtime = this.realtimeFactory({
          npcId: request.npcId,
          context: this.roster.contextFor(request.npcId),
          spatialVoice: this.spatialVoice,
        });
        await this.realtime.connect?.();
        await this.realtime.submitOpening?.(request.utterance);
        return true;
      } catch {
        this.realtime?.close?.();
        this.realtime = null;
        this.setStatus("实时语音不可用，已切换本地对话");
      }
    }
    return this.speakPhase(request.npcId, "conversation", request.utterance, request.generation);
  }

  async submitConversationTurn(utterance) {
    if (!this.activeNpcId) return false;
    if (this.realtime) {
      try {
        await this.realtime.submitTurn?.(utterance);
        return true;
      } catch {
        this.realtime.close?.();
        this.realtime = null;
        this.setStatus("实时语音中断，继续本地对话");
      }
    }
    return this.speakPhase(this.activeNpcId, "conversation", utterance, this.machine.generation);
  }

  endConversation() {
    this.spatialVoice.interrupt();
    this.realtime?.close?.();
    this.realtime = null;
    this.activeNpcId = null;
    this.machine.reset();
    this.setStatus("对话结束");
  }

  update() {
    if (this.destroyed) return;
    if (this.machine.tick()) {
      this.setStatus("回应超时，呼叫结束");
      return;
    }
    if (!this.machine.npcId || TERMINAL_STATES.has(this.machine.state)) return;
    const npc = this.npcSystem.snapshots().find((entry) => entry.id === this.machine.npcId);
    if (!npc) return;
    const position = this.playerPosition();
    const distance = Math.hypot(npc.position.x - position.x, npc.position.z - position.z);
    if (this.machine.updateDistance(distance)) this.setStatus("距离太远，呼叫中断");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onRecording?.(false);
    this.spatialVoice.interrupt();
    this.realtime?.close?.();
    this.realtime = null;
    this.activeNpcId = null;
  }
}
