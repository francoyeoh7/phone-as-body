import { MAX_VOICE_CLIP_BYTES } from "../src/shared/protocol.js";
import { transcribeWithWindowsSpeech } from "./local-speech.js";

const OPENAI_ORIGIN = "https://api.openai.com";
const NPC_TEXT_MODEL = process.env.OPENAI_NPC_TEXT_MODEL || "gpt-4.1-mini";
const NPC_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const NPC_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

const NPC_PERSONAS = Object.freeze({
  mara: "玛拉，村口旅店老板。谨慎、观察力强，保护被封存的二楼客房；只在证据足够时谈秘密。",
  bram: "布拉姆，村里铁匠。直截了当，相信工具痕迹和金属证据，不传播未经证实的传闻。",
  elowen: "艾洛温，草药师。温和但严谨，关注水、植物和伤势，不凭猜测下结论。",
});

function safeText(value, limit = 500) { return String(value ?? "").slice(0, limit); }
function fail(response, status, message) { return response.status(status).json({ ok: false, error: message }); }
function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output ?? []) for (const content of item?.content ?? []) {
    if (typeof content?.text === "string") return content.text;
  }
  return "";
}

function recordingUpload(contentType = "audio/webm") {
  const mimeType = String(contentType).split(";", 1)[0].trim().toLowerCase();
  const extensions = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  return {
    mimeType: extensions[mimeType] ? mimeType : "audio/webm",
    filename: `voice.${extensions[mimeType] ?? "webm"}`,
  };
}

export function createNpcAi({
  apiKey = process.env.OPENAI_API_KEY || "",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  localTranscribe = transcribeWithWindowsSpeech,
} = {}) {
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : null;
  const configured = Boolean(auth && fetchImpl);
  return {
    config(_request, response) {
      response.json({ aiConfigured: configured, textModel: NPC_TEXT_MODEL, transcriptionModel: NPC_TRANSCRIPTION_MODEL, realtimeModel: NPC_REALTIME_MODEL });
    },
    async transcribe(request, response) {
      const bytes = request.body;
      if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_VOICE_CLIP_BYTES) return fail(response, 400, "Invalid voice recording");
      const upload = recordingUpload(request.headers["content-type"]);
      if (configured) {
        const form = new FormData();
        form.set("file", new Blob([bytes], { type: upload.mimeType }), upload.filename);
        form.set("model", NPC_TRANSCRIPTION_MODEL);
        form.set("language", "zh");
        form.set("prompt", "中文村庄游戏语音。可能出现：有人看到我的PPT吗、PPT、幻灯片、演示文稿、抓取、敲门、老奶奶。请完整保留玩家原句。");
        try {
          const result = await fetchImpl(`${OPENAI_ORIGIN}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
          if (result.ok) {
            const payload = await result.json();
            const transcript = safeText(payload?.text).trim();
            if (transcript) return response.json({ transcript, confidence: 0.9, voiceLevel: 0.6 });
          }
        } catch { /* local recognizer remains available for WAV input */ }
      }
      try {
        const local = await localTranscribe?.(bytes, upload.mimeType);
        const transcript = safeText(local?.text).trim();
        if (transcript) {
          const confidence = Math.min(1, Math.max(0, Number(local?.confidence) || 0.35));
          return response.json({ transcript, confidence, voiceLevel: 0.6 });
        }
      } catch { /* return the appropriate stable API error below */ }
      return fail(response, configured ? 502 : 503, configured ? "NPC transcription failed" : "NPC AI is not configured");
    },
    async perform(request, response) {
      if (!configured) return fail(response, 503, "NPC AI is not configured");
      const npcId = safeText(request.body?.npcId, 24);
      const phase = safeText(request.body?.phase, 24);
      const persona = NPC_PERSONAS[npcId];
      if (!persona || !["notice", "clarify", "dismiss", "conversation"].includes(phase)) return fail(response, 400, "Invalid NPC request");
      const schema = {
        type: "object", additionalProperties: false,
        properties: {
          npcId: { type: "string", enum: [npcId] },
          speech: { type: "string", minLength: 1, maxLength: 180 },
          action: { type: "string", enum: ["notice", "clarify", "dismiss", "speak", "idle"] },
          emotion: { type: "string", enum: ["neutral", "warm", "guarded", "concerned", "angry", "curious"] },
          gesture: { type: "string", enum: ["turn", "nod", "shake-head", "explain", "idle"] },
        },
        required: ["npcId", "speech", "action", "emotion", "gesture"],
      };
      try {
        const result = await fetchImpl(`${OPENAI_ORIGIN}/v1/responses`, {
          method: "POST", headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: NPC_TEXT_MODEL,
            instructions: `${persona} 只输出符合 JSON schema 的单次回应。保持角色独立，不泄露其他 NPC 的私密记忆。`,
            input: JSON.stringify({ npcId, phase, playerUtterance: safeText(request.body?.utterance), privateContext: request.body?.context?.npc ?? {} }),
            max_output_tokens: 260,
            text: { format: { type: "json_schema", name: "npc_performance", strict: true, schema } },
          }),
        });
        if (!result.ok) return fail(response, 502, "NPC performance failed");
        return response.json(JSON.parse(extractResponseText(await result.json())));
      } catch { return fail(response, 502, "NPC performance unavailable"); }
    },
    async realtime(request, response) {
      if (!configured) return fail(response, 503, "NPC AI is not configured");
      const npcId = safeText(request.query?.npcId, 24);
      const persona = NPC_PERSONAS[npcId];
      if (!persona || typeof request.body !== "string" || request.body.length < 20) return fail(response, 400, "Invalid realtime session");
      const session = {
        type: "realtime", model: NPC_REALTIME_MODEL,
        instructions: `${persona} 与玩家进行一对一村庄调查对话。一次只回答当前问题，保持空间场景中的自然停顿。`,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true },
            transcription: { model: NPC_TRANSCRIPTION_MODEL, language: "zh" },
          },
          output: { format: { type: "audio/pcm" }, voice: "marin" },
        },
      };
      const form = new FormData();
      form.set("sdp", request.body);
      form.set("session", JSON.stringify(session));
      try {
        const result = await fetchImpl(`${OPENAI_ORIGIN}/v1/realtime/calls`, { method: "POST", headers: auth, body: form });
        if (!result.ok) return fail(response, 502, "Realtime NPC unavailable");
        response.set("Content-Type", "application/sdp");
        return response.send(await result.text());
      } catch { return fail(response, 502, "Realtime NPC unavailable"); }
    },
  };
}
