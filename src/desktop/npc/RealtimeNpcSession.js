function encodeBase64(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export class RealtimeNpcSession {
  constructor({
    npcId,
    context = {},
    spatialVoice,
    PeerConnection = globalThis.RTCPeerConnection,
    fetchImpl = globalThis.fetch?.bind(globalThis),
  } = {}) {
    if (!npcId || !spatialVoice) throw new TypeError("RealtimeNpcSession requires npcId and spatialVoice");
    this.npcId = npcId;
    this.context = context;
    this.spatialVoice = spatialVoice;
    this.PeerConnection = PeerConnection;
    this.fetchImpl = fetchImpl;
    this.peer = null;
    this.channel = null;
    this.queue = [];
    this.opened = false;
    this.closed = false;
    this.transcript = "";
  }

  async connect() {
    if (this.closed || !this.PeerConnection || !this.fetchImpl) throw new Error("Realtime WebRTC is unavailable");
    const peer = new this.PeerConnection();
    this.peer = peer;
    peer.addTransceiver?.("audio", { direction: "recvonly" });
    peer.ontrack = ({ track, streams }) => {
      const stream = streams?.[0] ?? new MediaStream([track]);
      this.spatialVoice.attachMediaStream(this.npcId, stream);
    };
    const channel = peer.createDataChannel("oai-events", { ordered: true });
    this.channel = channel;
    channel.onopen = () => {
      this.opened = true;
      this.send({ type: "session.update", session: { modalities: ["audio", "text"], input_audio_format: "pcm16", output_audio_format: "pcm16", instructions: this.context?.npc?.identity ?? "" } });
      for (const event of this.queue.splice(0)) channel.send(JSON.stringify(event));
    };
    channel.onmessage = ({ data }) => this.handleEvent(data);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await this.fetchImpl(`/api/npc/realtime?npcId=${encodeURIComponent(this.npcId)}`, {
      method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp,
    });
    if (!response.ok) throw new Error(`Realtime session failed: ${response.status}`);
    await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    return true;
  }

  send(event) {
    if (!this.channel || this.channel.readyState !== "open") {
      this.queue.push(event);
      return false;
    }
    this.channel.send(JSON.stringify(event));
    return true;
  }

  handleEvent(raw) {
    let event;
    try { event = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
    if (event?.type === "response.output_audio_transcript.delta" || event?.type === "response.audio_transcript.delta") {
      this.transcript += event.delta ?? "";
    }
    if (event?.type === "response.done" && this.transcript) {
      this.spatialVoice.onSubtitle?.({ npcId: this.npcId, speech: this.transcript });
      this.transcript = "";
    }
    if (event?.type === "input_audio_buffer.speech_started") this.spatialVoice.interrupt(this.npcId);
  }

  submitOpening(utterance) {
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: String(utterance).slice(0, 500) }] } });
    this.send({ type: "response.create", response: { modalities: ["audio", "text"] } });
    return true;
  }

  submitTurn(utterance) { return this.submitOpening(utterance); }

  acceptVoiceFrame(frame) {
    if (frame?.type === "voice-start") {
      this.send({ type: "input_audio_buffer.clear" });
      return true;
    }
    if (frame?.type === "voice-stop") {
      this.send({ type: "input_audio_buffer.commit" });
      this.send({ type: "response.create", response: { modalities: ["audio", "text"] } });
      return true;
    }
    if (frame instanceof ArrayBuffer || ArrayBuffer.isView(frame)) {
      this.send({ type: "input_audio_buffer.append", audio: encodeBase64(frame) });
      return true;
    }
    return false;
  }

  interrupt() {
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
    this.spatialVoice.interrupt(this.npcId);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.spatialVoice.interrupt(this.npcId);
    this.channel?.close?.();
    this.peer?.close?.();
    this.channel = null;
    this.peer = null;
    this.queue.length = 0;
  }
}
