const CANCELLATIONS = [
  "没什么",
  "没事",
  "算了",
  "不用了",
  "不是叫你",
  "never mind",
  "nevermind",
  "forget it",
  "not talking to you",
  "wasn't calling you",
];

const FILLERS = new Set(["", "啊", "呃", "嗯", "哦", "诶", "什么", "ah", "uh", "um", "hmm", "what"]);
const GREETINGS = ["你好", "您好", "喂", "在吗", "hello", "hi", "hey", "excuse me"];
const REQUESTS = ["请问", "帮忙", "帮我", "有事", "想问", "我想", "需要", "help", "question", "could you", "can you", "please"];
const DIRECTED = ["你", "您", "那位", "师傅", "老板", "you", "sir", "ma'am", "madam"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLatinAlias(value) {
  return /^[\p{L}\p{N}_ -]+$/u.test(value) && /[A-Za-z0-9]/.test(value);
}

export function normalizeTranscript(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsExactAlias(transcript, aliases = []) {
  const normalized = normalizeTranscript(transcript);
  return aliases.some((alias) => {
    const candidate = normalizeTranscript(alias);
    if (!candidate) return false;
    if (!isLatinAlias(candidate)) return normalized.includes(candidate);
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(candidate)}(?=$|[^\\p{L}\\p{N}_])`, "iu")
      .test(normalized);
  });
}

function containsPhrase(transcript, phrases) {
  const normalized = normalizeTranscript(transcript);
  return phrases.some((phrase) => normalized.includes(normalizeTranscript(phrase)));
}

export function analyzeCallout(transcript, aliases = []) {
  const normalized = normalizeTranscript(transcript);
  const named = containsExactAlias(normalized, aliases);
  return Object.freeze({
    normalized,
    named,
    greeting: containsPhrase(normalized, GREETINGS),
    request: containsPhrase(normalized, REQUESTS),
    directed: named || containsPhrase(normalized, DIRECTED),
  });
}

export function classifyFollowUp(utterance, { confidence = 1 } = {}) {
  const normalized = normalizeTranscript(utterance);
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  if (containsPhrase(normalized, CANCELLATIONS)) {
    return Object.freeze({ kind: "cancel", utterance: normalized, confidence: numericConfidence });
  }
  if (numericConfidence < 0.45 || FILLERS.has(normalized)) {
    return Object.freeze({ kind: "ambiguous", utterance: normalized, confidence: numericConfidence });
  }
  const cues = analyzeCallout(normalized);
  const meaningful = cues.request || normalized.length >= 4;
  return Object.freeze({
    kind: meaningful ? "engage" : "ambiguous",
    utterance: normalized,
    confidence: numericConfidence,
  });
}
