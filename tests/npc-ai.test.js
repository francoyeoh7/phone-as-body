import { describe, expect, it, vi } from "vitest";
import { createNpcAi } from "../server/npc-ai.js";

function responseHarness() {
  const response = {
    statusCode: 200, body: null, headers: {},
    status: vi.fn((code) => { response.statusCode = code; return response; }),
    json: vi.fn((body) => { response.body = body; return response; }),
    send: vi.fn((body) => { response.body = body; return response; }),
    set: vi.fn((name, value) => { response.headers[name] = value; return response; }),
  };
  return response;
}

describe("NPC AI server", () => {
  it("reports configuration without exposing the API key and fails fast when missing", async () => {
    const api = createNpcAi({ apiKey: "" });
    const configResponse = responseHarness();
    api.config({}, configResponse);
    expect(configResponse.body).toEqual(expect.objectContaining({ aiConfigured: false }));
    expect(JSON.stringify(configResponse.body)).not.toContain("apiKey");
    const response = responseHarness();
    await api.transcribe({ body: Buffer.from([1]), headers: { "content-type": "audio/webm" } }, response);
    expect(response.statusCode).toBe(503);
  });

  it("transcribes a phone recording through the configured OpenAI model", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.body.get("language")).toBe("zh");
      expect(options.body.get("prompt")).toContain("PPT");
      expect(options.body.get("prompt")).toContain("有人看到我的PPT吗");
      return { ok: true, json: async () => ({ text: "玛拉，你好" }) };
    });
    const api = createNpcAi({ apiKey: "secret", fetchImpl });
    const response = responseHarness();
    await api.transcribe({ body: Buffer.from([1, 2, 3]), headers: { "content-type": "audio/webm" } }, response);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/audio/transcriptions", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer secret" } }));
    expect(response.body).toEqual({ transcript: "玛拉，你好", confidence: 0.9, voiceLevel: 0.6 });
  });

  it("preserves an iPhone MP4 recording as an MP4 multipart file", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const file = options.body.get("file");
      expect(file.name).toBe("voice.mp4");
      expect(file.type).toBe("audio/mp4");
      return { ok: true, json: async () => ({ text: "玛拉，你好" }) };
    });
    const api = createNpcAi({ apiKey: "secret", fetchImpl });
    const response = responseHarness();

    await api.transcribe({
      body: Buffer.from([1, 2, 3]),
      headers: { "content-type": "audio/mp4;codecs=mp4a.40.2" },
    }, response);

    expect(response.body.transcript).toBe("玛拉，你好");
  });

  it("falls back to the local Windows recognizer when the configured API key is rejected", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    const localTranscribe = vi.fn(async () => ({ text: "我在门外", confidence: 0.42 }));
    const api = createNpcAi({ apiKey: "invalid", fetchImpl, localTranscribe });
    const response = responseHarness();

    await api.transcribe({
      body: Buffer.from([1, 2, 3]),
      headers: { "content-type": "audio/wav" },
    }, response);

    expect(localTranscribe).toHaveBeenCalledWith(expect.any(Buffer), "audio/wav");
    expect(response.body).toEqual({ transcript: "我在门外", confidence: 0.42, voiceLevel: 0.6 });
  });

  it("forwards SDP to a realtime call and returns the answer", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => "answer-sdp" }));
    const api = createNpcAi({ apiKey: "secret", fetchImpl });
    const response = responseHarness();
    await api.realtime({ body: "offer-sdp-01234567890123456789", query: { npcId: "bram" } }, response);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/realtime/calls", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer secret" }, body: expect.any(FormData) }));
    expect(response.headers["Content-Type"]).toBe("application/sdp");
    expect(response.body).toBe("answer-sdp");
  });
});
