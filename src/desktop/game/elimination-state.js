// Pure elimination game state. No rendering or networking imports — fully
// unit-testable. The renderer/director subscribes to snapshots.

export const ELIMINATION_RULES = Object.freeze({
  playerCount: 5,
  rounds: 3,
  roundSeconds: 180,
  survivorsPerRound: [4, 3, 2],
});

export function createEliminationState({ playerNames, seed = 1, rules = ELIMINATION_RULES } = {}) {
  const names = Array.isArray(playerNames) && playerNames.length >= 2
    ? playerNames
    : ["你", "猎手", "旅人", "工匠", "守夜人"];
  let rngState = seed >>> 0 || 1;
  const random = () => {
    // mulberry32 — deterministic loot rolls.
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const players = names.slice(0, rules.playerCount).map((name, index) => ({
    id: index === 0 ? "local" : `bot-${index}`,
    name,
    coins: 0,
    alive: true,
    isLocal: index === 0,
    items: [],
    materials: {},
  }));

  return {
    rules,
    random,
    players,
    round: 1,
    phase: "playing", // playing -> round-end -> finished
    roundStartedAt: 0,
    winnerIds: [],
  };
}

export function awardCoins(state, playerId, amount) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || !player.alive || !Number.isFinite(amount) || amount <= 0) return false;
  player.coins += Math.round(amount);
  return true;
}

export function alivePlayers(state) {
  return state.players.filter((player) => player.alive);
}

export function roundRankings(state) {
  return [...alivePlayers(state)].sort((a, b) => b.coins - a.coins || a.id.localeCompare(b.id));
}

// Ends the current round: eliminates the lowest-coin alive player. Returns a
// summary for the UI. The state machine is phase-gated; call advanceRound to
// move from "round-end" into the next round.
export function settleRound(state) {
  if (state.phase !== "playing") return null;
  const rankings = roundRankings(state);
  const eliminated = rankings[rankings.length - 1] ?? null;
  if (eliminated) eliminated.alive = false;
  state.phase = state.round >= state.rules.rounds ? "finished" : "round-end";
  if (state.phase === "finished") {
    state.winnerIds = alivePlayers(state).map((player) => player.id);
  }
  return {
    round: state.round,
    rankings,
    eliminated,
    finished: state.phase === "finished",
    winners: state.winnerIds,
    localWon: state.players.find((p) => p.isLocal)?.alive ?? false,
  };
}

export function advanceRound(state) {
  if (state.phase !== "round-end") return false;
  state.round += 1;
  state.phase = "playing";
  return true;
}

export function isLocalEliminated(state) {
  const local = state.players.find((player) => player.isLocal);
  return Boolean(local && !local.alive);
}

// --- shared inventory helpers (players all carry items + materials) ---
export function giveItem(state, playerId, itemId, label) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return false;
  player.items.push({ id: itemId, label: label ?? itemId });
  return true;
}

export function takeItem(state, playerId, itemId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return false;
  const index = player.items.findIndex((item) => item.id === itemId);
  if (index < 0) return false;
  player.items.splice(index, 1);
  return true;
}

export function giveMaterial(state, playerId, materialId, count = 1) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return false;
  player.materials[materialId] = (player.materials[materialId] ?? 0) + count;
  return true;
}

export function takeMaterials(state, playerId, materialId, count) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || (player.materials[materialId] ?? 0) < count) return false;
  player.materials[materialId] -= count;
  return true;
}

// Loot tables stay data-driven and deterministic through the seeded RNG.
export const LOOT_TABLE = Object.freeze([
  { id: "coins-small", label: "一把金币", coins: [15, 40], weight: 45 },
  { id: "coins-medium", label: "钱袋", coins: [45, 90], weight: 30 },
  { id: "coins-large", label: "宝箱", coins: [95, 160], weight: 15 },
  { id: "part", label: "任务零件", coins: [0, 0], weight: 10 },
]);

export function rollLoot(state) {
  const totalWeight = LOOT_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = state.random() * totalWeight;
  let entry = LOOT_TABLE[0];
  for (const candidate of LOOT_TABLE) {
    roll -= candidate.weight;
    if (roll <= 0) { entry = candidate; break; }
  }
  const [min, max] = entry.coins;
  const coins = max > min ? min + Math.floor(state.random() * (max - min + 1)) : min;
  return { id: entry.id, label: entry.label, coins };
}
