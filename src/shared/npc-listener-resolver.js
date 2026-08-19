import { analyzeCallout } from "./npc-cues.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function hearingRadiusForVoice(voiceLevel) {
  const level = Number.isFinite(voiceLevel) ? voiceLevel : 0;
  return clamp(3.5 + level * 10, 3.5, 12);
}

function spatialMetrics(playerPosition, playerForward, npcPosition, radius) {
  const dx = Number(npcPosition?.x ?? 0) - Number(playerPosition?.x ?? 0);
  const dz = Number(npcPosition?.z ?? 0) - Number(playerPosition?.z ?? 0);
  const distance = Math.hypot(dx, dz);
  const length = Math.hypot(dx, dz) || 1;
  const forwardLength = Math.hypot(playerForward?.x ?? 0, playerForward?.z ?? -1) || 1;
  const dot = (dx / length) * ((playerForward?.x ?? 0) / forwardLength)
    + (dz / length) * ((playerForward?.z ?? -1) / forwardLength);
  const facingFactor = dot >= 0.5 ? 1 : dot >= -0.3 ? 0.85 : 0.65;
  return {
    distance,
    dot,
    facingFactor,
    distanceFactor: clamp(1 - distance / radius, 0, 1),
  };
}

function cueWeight(cue) {
  return (cue.named ? 0.65 : 0)
    + (cue.greeting ? 0.25 : 0)
    + (cue.request ? 0.4 : 0)
    + (cue.directed ? 0.35 : 0);
}

export function resolveNpcListener({
  transcript,
  voiceLevel = 0,
  playerPosition,
  playerForward,
  npcs = [],
  minConfidence = 0.45,
} = {}) {
  const hearingRadius = hearingRadiusForVoice(voiceLevel);
  const candidates = [];

  for (const npc of npcs) {
    if (!npc?.id || !npc?.position) continue;
    const cue = analyzeCallout(transcript, npc.aliases ?? npc.names ?? [npc.name].filter(Boolean));
    const cueScore = cueWeight(cue);
    if (cueScore <= 0) continue;
    const spatial = spatialMetrics(playerPosition, playerForward, npc.position, hearingRadius);
    if (spatial.distance > hearingRadius) continue;
    const genericGreeting = cue.greeting && !cue.named && !cue.request && !cue.directed;
    if (genericGreeting && spatial.distance > 8) continue;
    const score = cueScore + spatial.distanceFactor * 0.35 + spatial.facingFactor * 0.2;
    if (score < minConfidence) continue;
    candidates.push({ npc, cue, cueScore, score, hearingRadius, ...spatial });
  }

  candidates.sort((a, b) => b.score - a.score
    || a.distance - b.distance
    || String(a.npc.id).localeCompare(String(b.npc.id)));
  const winner = candidates[0];
  if (!winner) return { listener: null, hearingRadius, candidates: [] };
  return Object.freeze({
    listener: winner.npc,
    cue: winner.cue,
    cueScore: winner.cueScore,
    score: winner.score,
    confidence: clamp(winner.score, 0, 1),
    distance: winner.distance,
    distanceFactor: winner.distanceFactor,
    facingFactor: winner.facingFactor,
    hearingRadius,
    candidates: Object.freeze(candidates.slice()),
  });
}
