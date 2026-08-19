import { describe, expect, it, vi } from "vitest";
import { PcmVoiceStreamer, pcm16FramesToWav, resampleToPcm16 } from "../src/controller/PcmVoiceStreamer.js";

function createAudioHarness({ sampleRate = 48_000 } = {}) {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  const context = {
    sampleRate,
    state: "suspended",
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => source),
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => gain),
  };
  const AudioContext = vi.fn(() => context);
  return { AudioContext, context, source, processor, gain };
}

describe("resampleToPcm16", () => {
  it("resamples 48k float audio to 24k signed PCM without wrapping clipped samples", () => {
    const pcm = resampleToPcm16(new Float32Array([-1.4, -0.5, 0.5, 1.4]), 48_000, 24_000);

    expect([...pcm]).toEqual([-32_768, 16_384]);
  });

  it("preserves the expected duration when converting 44.1k audio", () => {
    const pcm = resampleToPcm16(new Float32Array(441), 44_100, 24_000);

    expect(pcm).toHaveLength(240);
  });
});

describe("pcm16FramesToWav", () => {
  it("builds one standard mono 24kHz WAV from streamed PCM frames", () => {
    const wav = pcm16FramesToWav([
      new Int16Array([1, -2]).buffer,
      new Int16Array([3]).buffer,
    ], 24_000);
    const view = new DataView(wav);
    const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(wav, offset, length));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
    expect([...new Int16Array(wav, 44)]).toEqual([1, -2, 3]);
  });
});

describe("PcmVoiceStreamer", () => {
  it("primes and resumes the audio context inside the press activation task", async () => {
    const audio = createAudioHarness();
    const streamer = new PcmVoiceStreamer({ AudioContext: audio.AudioContext });

    expect(streamer.prime()).toBe(true);
    expect(audio.AudioContext).toHaveBeenCalledOnce();
    expect(audio.context.resume).toHaveBeenCalledOnce();
    await streamer.start({ id: "microphone" });

    expect(audio.AudioContext).toHaveBeenCalledOnce();
    expect(audio.context.resume).toHaveBeenCalledOnce();
  });

  it("closes a primed context when recording is cancelled before it starts", async () => {
    const audio = createAudioHarness();
    const streamer = new PcmVoiceStreamer({ AudioContext: audio.AudioContext });
    streamer.prime();

    await streamer.stop();

    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("announces a 24k stream, emits binary PCM frames, then announces stop", async () => {
    const audio = createAudioHarness();
    const frames = [];
    const streamer = new PcmVoiceStreamer({
      AudioContext: audio.AudioContext,
      onFrame: (frame) => frames.push(frame),
    });
    const stream = { id: "microphone" };

    await streamer.start(stream);
    audio.processor.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0, 0.25, 0.5, 0.75]) },
    });
    await streamer.stop();

    expect(audio.context.resume).toHaveBeenCalledOnce();
    expect(audio.context.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(audio.context.createScriptProcessor).toHaveBeenCalledWith(2048, 1, 1);
    expect(audio.gain.gain.value).toBe(0);
    expect(frames[0]).toEqual({ type: "voice-start", sampleRate: 24_000, format: "pcm16" });
    expect(frames[1]).toBeInstanceOf(ArrayBuffer);
    expect([...new Int16Array(frames[1])]).toEqual([0, 16_384]);
    expect(frames[2]).toEqual({ type: "voice-stop" });
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.processor.disconnect).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("does not emit duplicate stop frames", async () => {
    const audio = createAudioHarness();
    const onFrame = vi.fn();
    const streamer = new PcmVoiceStreamer({ AudioContext: audio.AudioContext, onFrame });

    await streamer.start({});
    await streamer.stop();
    await streamer.stop();

    expect(onFrame.mock.calls.filter(([frame]) => frame?.type === "voice-stop")).toHaveLength(1);
  });
});
