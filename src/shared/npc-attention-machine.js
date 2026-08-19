export const ATTENTION_STATES = Object.freeze({
  IDLE: "Idle",
  CAPTURING_CALLOUT: "CapturingCallout",
  NPC_NOTICED: "NpcNoticed",
  AWAITING_INTENT: "AwaitingIntent",
  CONVERSATION_REQUESTED: "ConversationRequested",
  CANCELLED: "Cancelled",
  CLARIFYING_INTENT: "ClarifyingIntent",
  TIMED_OUT: "TimedOut",
});

export class NpcAttentionMachine {
  constructor({ now = () => Date.now(), followUpMs = 5_000, onChange = null } = {}) {
    this.now = now;
    this.followUpMs = followUpMs;
    this.onChange = onChange;
    this.generation = 0;
    this.state = ATTENTION_STATES.IDLE;
    this.npcId = null;
    this.hearingRadius = 0;
    this.deadline = 0;
    this.clarifications = 0;
    this.pendingConversation = null;
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      generation: this.generation,
      npcId: this.npcId,
      hearingRadius: this.hearingRadius,
      deadline: this.deadline,
      clarifications: this.clarifications,
    });
  }

  transition(state) {
    this.state = state;
    this.onChange?.(this.snapshot());
  }

  isCurrent(generation) {
    return generation === this.generation;
  }

  startCapture() {
    this.generation += 1;
    this.npcId = null;
    this.hearingRadius = 0;
    this.deadline = 0;
    this.clarifications = 0;
    this.pendingConversation = null;
    this.transition(ATTENTION_STATES.CAPTURING_CALLOUT);
    return this.generation;
  }

  notice({ npcId, hearingRadius } = {}, generation = this.generation) {
    if (!this.isCurrent(generation) || this.state !== ATTENTION_STATES.CAPTURING_CALLOUT || !npcId) return false;
    this.npcId = npcId;
    this.hearingRadius = Number.isFinite(hearingRadius) ? hearingRadius : 0;
    this.transition(ATTENTION_STATES.NPC_NOTICED);
    return true;
  }

  acknowledged(generation = this.generation) {
    if (!this.isCurrent(generation) || this.state !== ATTENTION_STATES.NPC_NOTICED) return false;
    this.deadline = this.now() + this.followUpMs;
    this.transition(ATTENTION_STATES.AWAITING_INTENT);
    return true;
  }

  submitIntent({ kind, utterance = "" } = {}, generation = this.generation) {
    if (!this.isCurrent(generation) || this.state !== ATTENTION_STATES.AWAITING_INTENT) return false;
    if (kind === "cancel") {
      this.transition(ATTENTION_STATES.CANCELLED);
      return true;
    }
    if (kind === "engage") {
      this.pendingConversation = Object.freeze({ npcId: this.npcId, utterance, generation });
      this.transition(ATTENTION_STATES.CONVERSATION_REQUESTED);
      return true;
    }
    if (this.clarifications >= 1) {
      this.transition(ATTENTION_STATES.TIMED_OUT);
      return true;
    }
    this.clarifications += 1;
    this.transition(ATTENTION_STATES.CLARIFYING_INTENT);
    return true;
  }

  clarificationDelivered(generation = this.generation) {
    if (!this.isCurrent(generation) || this.state !== ATTENTION_STATES.CLARIFYING_INTENT) return false;
    this.deadline = this.now() + this.followUpMs;
    this.transition(ATTENTION_STATES.AWAITING_INTENT);
    return true;
  }

  consumeConversationRequest() {
    const request = this.pendingConversation;
    this.pendingConversation = null;
    return request;
  }

  updateDistance(distance, generation = this.generation) {
    if (!this.isCurrent(generation) || !this.npcId || this.hearingRadius <= 0) return false;
    if (distance <= this.hearingRadius * 1.25) return false;
    this.transition(ATTENTION_STATES.CANCELLED);
    return true;
  }

  tick() {
    if (this.state !== ATTENTION_STATES.AWAITING_INTENT || this.now() <= this.deadline) return false;
    this.transition(ATTENTION_STATES.TIMED_OUT);
    return true;
  }

  reset() {
    this.npcId = null;
    this.hearingRadius = 0;
    this.deadline = 0;
    this.clarifications = 0;
    this.pendingConversation = null;
    this.transition(ATTENTION_STATES.IDLE);
  }
}
