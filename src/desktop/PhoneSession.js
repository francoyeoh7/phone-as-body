import QRCode from "qrcode";
import { io } from "socket.io-client";
import { EVENTS, isControllerInput, isHandFrame, isVoiceClip, isVoiceStreamFrame } from "../shared/protocol.js";

const stoppedInput = () => ({
  seq: -1,
  sentAt: 0,
  move: { x: 0, y: 0 },
  viewDelta: { yaw: 0, pitch: 0 },
  clutch: false,
  crouch: false,
  receivedAt: 0,
});

function createSlotState() {
  return {
    connected: false,
    input: stoppedInput(),
    handSeq: -1,
    handEpoch: 0,
    peerConnection: null,
    dataChannel: null,
    handChannel: null,
    voiceChannel: null,
    pendingCandidates: [],
  };
}

export class PhoneSession extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.room = null;
    this.secret = null;
    this.slotStates = new Map();
    this.primarySlotId = null;
    this.input = stoppedInput();
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.connected = false;
    this.handSeq = -1;
    this.handEpoch = 0;
    this.peerConnection = null;
    this.dataChannel = null;
    this.handChannel = null;
    this.voiceChannel = null;
    this.pendingCandidates = [];
  }

  slotState(slot) {
    let state = this.slotStates.get(slot);
    if (!state) {
      state = createSlotState();
      this.slotStates.set(slot, state);
    }
    return state;
  }

  primarySlot() {
    let best = null;
    for (const [slot, state] of this.slotStates) {
      if (state.connected && (best === null || slot < best)) best = slot;
    }
    return best;
  }

  effectivePrimarySlot() {
    return this.primarySlot() ?? this.primarySlotId ?? 0;
  }

  slots() {
    return [...this.slotStates.entries()]
      .filter(([, state]) => state.connected)
      .map(([slot]) => slot)
      .sort((a, b) => a - b);
  }

  syncPrimaryMirrors() {
    const state = this.slotState(this.effectivePrimarySlot());
    this.peerConnection = state.peerConnection;
    this.dataChannel = state.dataChannel;
    this.handChannel = state.handChannel;
    this.voiceChannel = state.voiceChannel;
    this.pendingCandidates = state.pendingCandidates;
  }

  start() {
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => this.createRoom());
    this.socket.on("disconnect", () => this.setAllPeersDisconnected());
    this.socket.on(EVENTS.peerStatus, ({ connected, slot }) => {
      this.setPeerConnected(Boolean(connected), Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerInput, ({ slot, input }) => {
      this.acceptInput(input, Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerHand, ({ slot, frame }) => {
      this.acceptHandFrame(frame, Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerVoiceClip, ({ slot, clip }) => {
      this.acceptVoiceClip(clip, Number.isInteger(slot) ? slot : 0);
    });
    this.socket.on(EVENTS.controllerAction, ({ slot, action }) => {
      if (slot === this.effectivePrimarySlot()) {
        this.dispatchEvent(new CustomEvent("action", { detail: action }));
      }
    });
    this.socket.on(EVENTS.rtcSignal, (signal) => this.handleRtcSignal(signal));
  }

  acceptInput(input, slot = 0) {
    if (!isControllerInput(input)) return;
    const state = this.slotState(slot);
    if (input.seq <= state.input.seq) return;

    state.input = {
      ...input,
      move: { ...input.move },
      viewDelta: { ...input.viewDelta },
      crouch: input.crouch === true,
      receivedAt: performance.now(),
    };
    if (slot === this.effectivePrimarySlot()) {
      this.pendingViewDelta = {
        yaw: this.pendingViewDelta.yaw + input.viewDelta.yaw,
        pitch: this.pendingViewDelta.pitch + input.viewDelta.pitch,
      };
      this.input = { ...state.input };
      this.dispatchEvent(new CustomEvent("input", { detail: this.input }));
    }
  }

  acceptHandFrame(frame, slot = 0) {
    if (!isHandFrame(frame)) return false;
    const state = this.slotState(slot);
    if (frame.modeEpoch < state.handEpoch
      || (frame.modeEpoch === state.handEpoch && frame.seq <= state.handSeq)) return false;
    state.handEpoch = frame.modeEpoch;
    state.handSeq = frame.seq;
    if (slot === this.effectivePrimarySlot()) {
      this.handEpoch = state.handEpoch;
      this.handSeq = state.handSeq;
      this.dispatchEvent(new CustomEvent("hand", {
        detail: { ...frame, receivedAt: performance.now() },
      }));
    }
    return true;
  }

  acceptVoiceClip(clip, _slot = 0) {
    if (!isVoiceClip(clip)) return false;
    this.dispatchEvent(new CustomEvent("voice-clip", { detail: { ...clip } }));
    return true;
  }

  resetHandOrdering() {
    this.handSeq = -1;
    this.handEpoch = 0;
  }

  createRoom() {
    this.socket.emit(EVENTS.desktopCreate, async (result) => {
      if (!result?.ok) {
        this.dispatchEvent(new CustomEvent("error", { detail: result?.reason ?? "room-failed" }));
        return;
      }
      this.room = result.code;
      this.secret = result.secret ?? null;
      const url = await this.buildControllerUrl(result.code, this.secret);
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 360,
        margin: 2,
        color: { dark: "#121413", light: "#f1f0e8" },
        errorCorrectionLevel: "M",
      });
      this.dispatchEvent(new CustomEvent("room", { detail: { code: result.code, url, qrDataUrl } }));
    });
  }

  async buildControllerUrl(code, secret = null) {
    let origin = location.origin;
    try {
      const response = await fetch("/api/config");
      const config = await response.json();
      if (config.controllerOrigin) origin = config.controllerOrigin;
    } catch {
      origin = location.origin;
    }
    const url = new URL("/controller", origin);
    url.searchParams.set("room", code);
    if (secret) url.searchParams.set("k", secret);
    return url.toString();
  }

  maybeSwapPrimary() {
    const primary = this.primarySlot();
    if (primary === this.primarySlotId) return;
    this.primarySlotId = primary;
    this.input = stoppedInput();
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.connected = primary !== null;
    this.syncPrimaryMirrors();
  }

  setPeerConnected(connected, slot = 0) {
    const state = this.slotState(slot);
    state.connected = Boolean(connected);

    if (connected) {
      state.input = stoppedInput();
      state.handSeq = -1;
      state.handEpoch = 0;
      const wasConnected = this.connected;
      this.maybeSwapPrimary();
      if (slot === this.primarySlotId) {
        if (!wasConnected) {
          this.input = stoppedInput();
          this.pendingViewDelta = { yaw: 0, pitch: 0 };
          this.resetHandOrdering();
        }
        this.startRtcOffer(slot);
        this.dispatchEvent(new CustomEvent("peer", { detail: { connected: true, slot } }));
      }
      return;
    }

    const wasPrimary = this.primarySlotId === slot;
    state.connected = false;
    state.input = {
      ...state.input,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
      crouch: false,
    };
    state.handSeq = -1;
    state.handEpoch = 0;
    this.closePeerConnection(slot);
    this.maybeSwapPrimary();
    if (wasPrimary || this.primarySlotId === null) {
      this.input = {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
        clutch: false,
        crouch: false,
      };
      this.pendingViewDelta = { yaw: 0, pitch: 0 };
      this.resetHandOrdering();
      this.dispatchEvent(new CustomEvent("peer", { detail: { connected: false, slot } }));
    }
  }

  setAllPeersDisconnected() {
    for (const slot of [...this.slotStates.keys()]) {
      this.closePeerConnection(slot);
      this.slotState(slot).connected = false;
    }
    this.primarySlotId = null;
    this.connected = false;
    this.input = {
      ...this.input,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
      crouch: false,
    };
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.resetHandOrdering();
    this.syncPrimaryMirrors();
    this.dispatchEvent(new CustomEvent("peer", { detail: { connected: false } }));
  }

  createPeerConnection(slot) {
    if (typeof RTCPeerConnection === "undefined") return null;
    this.closePeerConnection(slot);
    const peer = new RTCPeerConnection();
    const state = this.slotState(slot);
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket?.emit(EVENTS.rtcSignal, { slot, candidate });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") this.closePeerConnection(slot);
    };
    state.peerConnection = peer;
    if (slot === this.effectivePrimarySlot()) this.peerConnection = peer;
    return peer;
  }

  attachDataChannel(channel, slot = 0) {
    const isControls = !channel?.label || channel.label === "controls";
    const isHand = channel?.label === "hand";
    const isVoice = channel?.label === "voice";
    if (!isControls && !isHand && !isVoice) return;
    const state = this.slotState(slot);
    if (isHand) state.handChannel = channel;
    else if (isVoice) state.voiceChannel = channel;
    else state.dataChannel = channel;
    if (slot === this.effectivePrimarySlot()) {
      if (isHand) this.handChannel = channel;
      else if (isVoice) this.voiceChannel = channel;
      else this.dataChannel = channel;
    }
    channel.onclose = () => {
      if (isHand) {
        if (state.handChannel === channel) state.handChannel = null;
      } else if (isVoice) {
        if (state.voiceChannel === channel) state.voiceChannel = null;
      } else if (state.dataChannel === channel) state.dataChannel = null;
      if (slot === this.effectivePrimarySlot()) this.syncPrimaryMirrors();
    };
    channel.onmessage = ({ data }) => {
      if (isVoice) {
        let frame = data;
        if (typeof data === "string") {
          try {
            frame = JSON.parse(data);
          } catch {
            return;
          }
        }
        if (isVoiceStreamFrame(frame)) this.dispatchEvent(new CustomEvent("voice-stream", { detail: frame }));
        return;
      }
      try {
        const message = JSON.parse(data);
        if (isControls) {
          if (message?.type === "input" && slot === this.effectivePrimarySlot()) {
            this.acceptInput(message.payload, slot);
          }
        } else if (message?.type === "hand") {
          this.acceptHandFrame(message.payload, slot);
        }
      } catch {
        // Ignore malformed peer messages; Socket.IO remains the fallback.
      }
    };
  }

  async startRtcOffer(slot = 0) {
    const peer = this.createPeerConnection(slot);
    if (!peer) return;
    try {
      // Movement and view packets are disposable state snapshots. Dropping a
      // late packet is preferable to retransmitting it and making controls
      // feel delayed after a brief network hiccup.
      this.attachDataChannel(peer.createDataChannel("controls", { ordered: false, maxRetransmits: 0 }), slot);
      this.attachDataChannel(peer.createDataChannel("hand", { ordered: false, maxRetransmits: 0 }), slot);
      this.attachDataChannel(peer.createDataChannel("voice", { ordered: true }), slot);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.socket?.emit(EVENTS.rtcSignal, { slot, description: peer.localDescription });
    } catch {
      this.closePeerConnection(slot);
    }
  }

  async handleRtcSignal(signal) {
    const slot = Number.isInteger(signal?.slot) ? signal.slot : 0;
    const state = this.slotState(slot);
    const peer = state.peerConnection;
    if (!peer) return;
    try {
      if (signal?.description) {
        await peer.setRemoteDescription(signal.description);
        for (const candidate of state.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
      } else if (signal?.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else state.pendingCandidates.push(signal.candidate);
      }
    } catch {
      this.closePeerConnection(slot);
    }
  }

  closePeerConnection(slot) {
    const state = this.slotStates.get(slot);
    if (!state) return;
    state.dataChannel?.close?.();
    if (state.handChannel && state.handChannel !== state.dataChannel) state.handChannel.close?.();
    if (state.voiceChannel && state.voiceChannel !== state.dataChannel && state.voiceChannel !== state.handChannel) {
      state.voiceChannel.close?.();
    }
    state.peerConnection?.close?.();
    state.dataChannel = null;
    state.handChannel = null;
    state.voiceChannel = null;
    state.peerConnection = null;
    state.pendingCandidates = [];
    if (slot === this.effectivePrimarySlot()) {
      this.peerConnection = null;
      this.dataChannel = null;
      this.handChannel = null;
      this.voiceChannel = null;
      this.pendingCandidates = [];
    }
  }

  currentInput(maxAgeMs = 500) {
    const fresh = this.connected && performance.now() - this.input.receivedAt <= maxAgeMs;
    const viewDelta = fresh ? this.pendingViewDelta : { yaw: 0, pitch: 0 };
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    if (!fresh) {
      return {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta,
        clutch: false,
        crouch: false,
      };
    }
    return { ...this.input, viewDelta };
  }

  send(event) {
    if (event?.type === "control-feedback" && this.dataChannel?.readyState === "open") {
      this.dataChannel.send(JSON.stringify({ type: "feedback", payload: event }));
      return;
    }
    if (this.room && this.socket?.connected) this.socket.emit(EVENTS.desktopEvent, event);
  }

  destroy() {
    for (const slot of [...this.slotStates.keys()]) this.closePeerConnection(slot);
    this.socket?.disconnect();
  }
}
