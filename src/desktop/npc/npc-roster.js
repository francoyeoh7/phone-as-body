function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const NPC_DEFINITIONS = deepFreeze([
  {
    id: "mara",
    displayName: "玛拉",
    role: "旅店老板",
    aliases: ["Mara", "玛拉", "老板娘", "旅店老板"],
    identity: "旧橡木旅店的老板，待客周到，习惯先观察再回答。",
    publicStory: "经营村口旅店，熟悉来往住客和村里的公开传闻。",
    privateGoal: "保护二楼一间被封住的客房，不让无关者靠近。",
    knowledgeBoundary: ["住客登记", "旅店内发生的公开事件", "村民常谈的传闻"],
    secretFacts: ["昨夜有一名未登记的陌生人从后门进入二楼。"],
    emotionalWounds: ["曾因轻信旅客让家人陷入危险。"],
    evidenceThresholds: { suspiciousGuest: 2, sealedRoom: 4 },
    voice: { pitch: 1.04, rate: 0.95 },
    fallback: {
      acknowledge: "我听见了。你是在叫我吗？",
      clarify: "你找我，是想问住店的事，还是村里的事？",
      dismiss: "好，有需要再叫我。",
      conversation: "住店和村里的传闻我大多知道。你想从哪件事问起？",
    },
  },
  {
    id: "bram",
    displayName: "布拉姆",
    role: "铁匠",
    aliases: ["Bram", "布拉姆", "铁匠", "师傅"],
    identity: "村里的铁匠，重事实轻传闻，说话简短直接。",
    publicStory: "修理农具、门锁和金属器件，能从损伤判断工具与力道。",
    privateGoal: "查清是谁用他的细齿锉破坏了祠堂旧锁。",
    knowledgeBoundary: ["金属加工", "工具痕迹", "村内维修记录"],
    secretFacts: ["祠堂锁上的新划痕来自他失窃的细齿锉。"],
    emotionalWounds: ["一次错误修复导致学徒受伤。"],
    evidenceThresholds: { stolenFile: 2, shrineLock: 3 },
    voice: { pitch: 0.84, rate: 0.9 },
    fallback: {
      acknowledge: "听到了。说吧，什么事？",
      clarify: "要修东西，还是要问我看过的痕迹？",
      dismiss: "行，我接着干活。",
      conversation: "金属不会撒谎。把要修的东西或划痕给我说清楚。",
    },
  },
  {
    id: "elowen",
    displayName: "艾洛温",
    role: "草药师",
    aliases: ["Elowen", "艾洛温", "草药师", "药师"],
    identity: "采药与行医的村民，观察细致，不对未经证实的事情下结论。",
    publicStory: "熟悉村边植物、常见伤病和林间道路。",
    privateGoal: "找到污染井水的来源，同时避免引发无依据的恐慌。",
    knowledgeBoundary: ["草药与伤病", "林间路径", "水与植物的异常迹象"],
    secretFacts: ["井边的黑色苔痕与北林废弃祭台上的样本一致。"],
    emotionalWounds: ["曾因误判病因失去一位病人。"],
    evidenceThresholds: { taintedWater: 2, forestAltar: 4 },
    voice: { pitch: 1.12, rate: 0.92 },
    fallback: {
      acknowledge: "我在。你哪里不舒服吗？",
      clarify: "你想问草药、伤势，还是林子里的路？",
      dismiss: "明白。需要时再来找我。",
      conversation: "先把你看到的症状或植物说清楚，我不会凭猜测下结论。",
    },
  },
]);

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export class NpcRoster {
  constructor({ definitions = NPC_DEFINITIONS, recentTurnLimit = 8 } = {}) {
    this.recentTurnLimit = recentTurnLimit;
    this.entries = new Map(definitions.map((definition) => [definition.id, {
      ...clone(definition),
      relationshipState: { trust: 0, familiarity: 0, tension: 0 },
      admissions: [],
      recentTurns: [],
    }]));
  }

  get(id) {
    const npc = this.entries.get(id);
    if (!npc) throw new Error(`Unknown NPC: ${id}`);
    return npc;
  }

  list() {
    return [...this.entries.values()];
  }

  updateRelationship(id, patch = {}) {
    const npc = this.get(id);
    for (const key of ["trust", "familiarity", "tension"]) {
      if (Number.isFinite(patch[key])) npc.relationshipState[key] = patch[key];
    }
    return { ...npc.relationshipState };
  }

  addTurn(id, turn) {
    const npc = this.get(id);
    npc.recentTurns.push({ speaker: turn?.speaker === "npc" ? "npc" : "player", text: String(turn?.text ?? "").slice(0, 500) });
    if (npc.recentTurns.length > this.recentTurnLimit) {
      npc.recentTurns.splice(0, npc.recentTurns.length - this.recentTurnLimit);
    }
  }

  contextFor(id) {
    return { npc: clone(this.get(id)) };
  }
}

export function createNpcRoster(options) {
  return new NpcRoster(options);
}
