const ALLOWED_KEYS = new Set(["npcId", "speech", "action", "emotion", "gesture"]);
const ACTIONS = new Set(["notice", "clarify", "dismiss", "speak", "idle"]);
const EMOTIONS = new Set(["neutral", "warm", "guarded", "concerned", "angry", "curious"]);
const GESTURES = new Set(["turn", "nod", "shake-head", "explain", "idle"]);

export function validateNpcPerformance(payload, { expectedNpcId } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== 5 || keys.some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (payload.npcId !== expectedNpcId) return null;
  if (typeof payload.speech !== "string" || !payload.speech.trim() || payload.speech.length > 180) return null;
  if (!ACTIONS.has(payload.action) || !EMOTIONS.has(payload.emotion) || !GESTURES.has(payload.gesture)) return null;
  return Object.freeze({
    npcId: payload.npcId,
    speech: payload.speech.trim(),
    action: payload.action,
    emotion: payload.emotion,
    gesture: payload.gesture,
  });
}

function conversationLine(npc, utterance) {
  if (npc.id === "bram" && /钥匙|锁|划痕|金属|工具|修/.test(utterance)) {
    return "这种金属划痕像细齿锉留下的。把钥匙给我看清楚，我能判断还能不能修。";
  }
  if (npc.id === "mara" && /昨晚|住客|陌生人|旅店|房间/.test(utterance)) {
    return "昨晚旅店确实不安静，但住客的事不能只凭传闻。你具体看见了什么？";
  }
  if (npc.id === "elowen" && /井|水|草药|伤|树林|植物/.test(utterance)) {
    return "先别碰异常的水和植物。告诉我颜色、气味和你发现它的位置。";
  }
  return npc.fallback.conversation;
}

function localPerformance(npc, phase, utterance) {
  const presets = {
    notice: [npc.fallback.acknowledge, "notice", "curious", "turn"],
    clarify: [npc.fallback.clarify, "clarify", "curious", "explain"],
    dismiss: [npc.fallback.dismiss, "dismiss", "neutral", "nod"],
    conversation: [conversationLine(npc, utterance), "speak", npc.id === "mara" ? "guarded" : "neutral", "explain"],
  };
  const [speech, action, emotion, gesture] = presets[phase] ?? ["我在听。", "idle", "neutral", "idle"];
  return Object.freeze({ npcId: npc.id, speech, action, emotion, gesture, source: "local" });
}

export class NpcPerformer {
  constructor({ roster, remote = null } = {}) {
    if (!roster) throw new TypeError("NpcPerformer requires a roster");
    this.roster = roster;
    this.remote = remote;
  }

  async perform({ npcId, phase, utterance = "", generation, isCurrent = () => true, signal } = {}) {
    const npc = this.roster.get(npcId);
    let performance = null;
    if (this.remote) {
      try {
        const remotePayload = await this.remote({
          npcId,
          phase,
          utterance,
          generation,
          context: this.roster.contextFor(npcId),
          signal,
        });
        if (!isCurrent(generation)) return null;
        const validated = validateNpcPerformance(remotePayload, { expectedNpcId: npcId });
        if (validated) performance = Object.freeze({ ...validated, source: "remote" });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return null;
      }
    }
    if (!isCurrent(generation)) return null;
    performance ??= localPerformance(npc, phase, utterance);
    if (phase === "conversation") {
      this.roster.addTurn(npcId, { speaker: "player", text: utterance });
      this.roster.addTurn(npcId, { speaker: "npc", text: performance.speech });
    }
    return performance;
  }
}
