const TARGET_SAMPLE_RATE = 24_000;
const PROCESSOR_BUFFER_SIZE = 2048;

export function resampleToPcm16(samples, inputRate, outputRate = TARGET_SAMPLE_RATE) {
  if (!samples?.length || !Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) {
    return new Int16Array(0);
  }
  const outputLength = Math.max(1, Math.round(samples.length * outputRate / inputRate));
  const output = new Int16Array(outputLength);
  const scale = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * scale;
    const leftIndex = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    const value = samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
    const clipped = Math.max(-1, Math.min(1, Number(value) || 0));
    output[index] = clipped < 0 ? Math.round(clipped * 32_768) : Math.round(clipped * 32_767);
  }
  return output;
}

export function pcm16FramesToWav(frames, sampleRate = TARGET_SAMPLE_RATE) {
  const chunks = (Array.isArray(frames) ? frames : []).map((frame) => {
    if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
    if (ArrayBuffer.isView(frame)) return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    return new Uint8Array(0);
  }).filter((chunk) => chunk.byteLength > 0 && chunk.byteLength % 2 === 0);
  const dataBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : TARGET_SAMPLE_RATE;
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return wav;
}

function disconnect(node) {
  try { node?.disconnect?.(); } catch { /* already disconnected */ }
}

export class PcmVoiceStreamer {
  constructor({
    AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext,
    onFrame,
    bufferSize = PROCESSOR_BUFFER_SIZE,
    targetSampleRate = TARGET_SAMPLE_RATE,
  } = {}) {
    this.AudioContext = AudioContext;
    this.onFrame = onFrame;
    this.bufferSize = bufferSize;
    this.targetSampleRate = targetSampleRate;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.mute = null;
    this.resumePromise = null;
    this.started = false;
    this.stopped = false;
  }

  prime() {
    if (this.stopped || !this.AudioContext) return false;
    if (this.context) return true;
    try {
      this.context = new this.AudioContext();
      // Mobile Safari only permits AudioContext activation from the direct
      // pointer task. Start resume here, before microphone permission awaits.
      this.resumePromise = Promise.resolve(this.context.resume?.()).catch(() => false);
      return true;
    } catch {
      this.context = null;
      this.resumePromise = null;
      return false;
    }
  }

  async start(stream) {
    if (this.started || !stream || !this.AudioContext) return false;
    let context = this.context;
    try {
      if (!context) {
        context = new this.AudioContext();
        this.context = context;
        this.resumePromise = Promise.resolve(context.resume?.()).catch(() => false);
      }
      await this.resumePromise;
      if (this.stopped) {
        await context.close?.().catch?.(() => {});
        if (this.context === context) this.context = null;
        this.resumePromise = null;
        return false;
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(this.bufferSize, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      processor.onaudioprocess = (event) => {
        if (!this.started || this.stopped) return;
        const samples = event.inputBuffer?.getChannelData?.(0);
        const pcm = resampleToPcm16(samples, context.sampleRate, this.targetSampleRate);
        if (pcm.byteLength > 0) this.onFrame?.(pcm.buffer);
      };
      this.source = source;
      this.processor = processor;
      this.mute = mute;
      this.started = true;
      this.onFrame?.({ type: "voice-start", sampleRate: this.targetSampleRate, format: "pcm16" });
      return true;
    } catch {
      disconnect(this.source ?? context);
      await context?.close?.().catch?.(() => {});
      if (this.context === context) this.context = null;
      this.resumePromise = null;
      return false;
    }
  }

  async stop() {
    if (this.stopped) return false;
    this.stopped = true;
    if (!this.started) {
      const context = this.context;
      this.context = null;
      this.resumePromise = null;
      await context?.close?.().catch?.(() => {});
      return Boolean(context);
    }
    this.processor && (this.processor.onaudioprocess = null);
    this.onFrame?.({ type: "voice-stop" });
    disconnect(this.source);
    disconnect(this.processor);
    disconnect(this.mute);
    await this.context?.close?.().catch?.(() => {});
    this.context = null;
    this.resumePromise = null;
    this.started = false;
    return true;
  }
}
