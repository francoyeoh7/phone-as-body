import * as THREE from "three";

function createVoiceTone(context, text) {
  if (!context?.createBuffer) return null;
  const sampleRate = context.sampleRate || 48_000;
  const duration = Math.min(1.8, Math.max(0.32, String(text).length * 0.045));
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const seed = [...String(text)].reduce((total, character) => total + character.codePointAt(0), 0);
  const base = 145 + (seed % 45);
  for (let index = 0; index < data.length; index += 1) {
    const time = index / sampleRate;
    const syllable = Math.floor(time * 7);
    const frequency = base + ((seed >> (syllable % 8)) & 31);
    const envelope = Math.sin(Math.min(1, time / 0.025) * Math.PI / 2)
      * Math.sin(Math.min(1, (duration - time) / 0.05) * Math.PI / 2)
      * (0.58 + 0.42 * Math.max(0, Math.sin(time * Math.PI * 7)));
    data[index] = envelope * (
      Math.sin(Math.PI * 2 * frequency * time) * 0.11
      + Math.sin(Math.PI * 2 * frequency * 2.1 * time) * 0.045
      + Math.sin(Math.PI * 2 * 620 * time) * 0.018
    );
  }
  return buffer;
}

export class NpcSpatialVoice {
  constructor({
    camera,
    npcSystem,
    listener = null,
    voiceFactory = null,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    onSubtitle = null,
  } = {}) {
    if (!camera || !npcSystem) throw new TypeError("NpcSpatialVoice requires camera and npcSystem");
    this.camera = camera;
    this.npcSystem = npcSystem;
    this.listener = listener ?? new THREE.AudioListener();
    this.fetchImpl = fetchImpl;
    this.onSubtitle = onSubtitle;
    this.entries = new Map();
    this.bufferCache = new Map();
    this.generation = 0;
    this.destroyed = false;
    camera.add(this.listener);

    for (const id of npcSystem.actors.keys()) {
      const voice = voiceFactory ? voiceFactory(id, this.listener) : new THREE.PositionalAudio(this.listener);
      voice.setRefDistance(1.6);
      voice.setMaxDistance(14);
      voice.setRolloffFactor(1.45);
      voice.setDistanceModel("inverse");
      voice.setDirectionalCone(120, 230, 0.35);
      const filter = this.listener.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 18_000;
      filter.Q.value = 0.35;
      voice.setFilter(filter);
      const mouth = npcSystem.mouthFor(id);
      mouth?.add(voice);
      this.entries.set(id, { id, voice, filter, mouth, hasSource: false, mediaStream: null });
    }
  }

  async loadBuffer(url) {
    if (this.bufferCache.has(url)) return this.bufferCache.get(url);
    if (!this.fetchImpl) throw new Error("Audio fetch is unavailable");
    const request = (async () => {
      const response = await this.fetchImpl(url);
      if (!response?.ok) throw new Error(`Voice clip failed: ${response?.status ?? "network"}`);
      const bytes = await response.arrayBuffer();
      return this.listener.context.decodeAudioData(bytes.slice(0));
    })();
    this.bufferCache.set(url, request);
    try {
      return await request;
    } catch (error) {
      this.bufferCache.delete(url);
      throw error;
    }
  }

  stopEntry(entry) {
    if (!entry?.hasSource && !entry?.voice?.isPlaying) return false;
    try {
      entry.voice.stop?.();
    } catch {
      entry.voice.disconnect?.();
    }
    entry.hasSource = false;
    entry.mediaStream = null;
    return true;
  }

  async speak(npcId, { speech = "", audioUrl = null, buffer = null } = {}) {
    const entry = this.entries.get(npcId);
    if (!entry || this.destroyed) return false;
    const generation = ++this.generation;
    this.onSubtitle?.({ npcId, speech: String(speech) });
    this.stopEntry(entry);
    try {
      const decoded = buffer
        ?? (audioUrl ? await this.loadBuffer(audioUrl) : createVoiceTone(this.listener.context, speech));
      if (generation !== this.generation || this.destroyed || !decoded) return false;
      entry.voice.setBuffer(decoded);
      entry.voice.play();
      entry.hasSource = true;
      return true;
    } catch {
      if (generation !== this.generation || this.destroyed) return false;
      const fallback = createVoiceTone(this.listener.context, speech);
      if (!fallback) return false;
      entry.voice.setBuffer(fallback);
      entry.voice.play();
      entry.hasSource = true;
      return true;
    }
  }

  attachMediaStream(npcId, stream) {
    const entry = this.entries.get(npcId);
    if (!entry || !stream || this.destroyed) return false;
    this.interrupt();
    entry.voice.setMediaStreamSource(stream);
    entry.hasSource = true;
    entry.mediaStream = stream;
    return true;
  }

  setOccluded(npcId, occluded) {
    const entry = this.entries.get(npcId);
    if (!entry) return false;
    entry.filter.frequency.value = occluded ? 1_150 : 18_000;
    entry.voice.setVolume(occluded ? 0.58 : 1);
    return true;
  }

  updateOcclusion(testOcclusion) {
    if (typeof testOcclusion !== "function") return;
    for (const [id, entry] of this.entries) {
      const blocked = testOcclusion(id, entry.mouth, this.camera) === true;
      this.setOccluded(id, blocked);
    }
  }

  interrupt(npcId = null) {
    this.generation += 1;
    let interrupted = false;
    for (const [id, entry] of this.entries) {
      if (npcId && id !== npcId) continue;
      interrupted = this.stopEntry(entry) || interrupted;
    }
    return interrupted;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.interrupt();
    for (const entry of this.entries.values()) {
      entry.mouth?.remove?.(entry.voice);
      entry.voice.disconnect?.();
    }
    this.entries.clear();
    this.bufferCache.clear();
    this.camera.remove?.(this.listener);
  }
}
