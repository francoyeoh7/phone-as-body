import QRCode from "qrcode";
import { io } from "socket.io-client";
import { EVENTS, isControllerInput, isHandFrame } from "../shared/protocol.js";

const stoppedInput = () => ({
  seq: -1,
  move: { x: 0, y: 0 },
  viewDelta: { yaw: 0, pitch: 0 },
  clutch: false,
  receivedAt: 0,
});

export class PhoneSession extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.room = null;
    this.input = stoppedInput();
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.connected = false;
    this.peerConnection = null;
    this.dataChannel = null;
    this.handChannel = null;
    this.handSeq = -1;
    this.handEpoch = 0;
    this.pendingCandidates = [];
  }

  start() {
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => this.createRoom());
    this.socket.on("disconnect", () => this.setPeerConnected(false));
    this.socket.on(EVENTS.peerStatus, ({ connected }) => this.setPeerConnected(Boolean(connected)));
    this.socket.on(EVENTS.controllerInput, (input) => this.acceptInput(input));
    this.socket.on(EVENTS.controllerHand, (frame) => this.acceptHandFrame(frame));
    this.socket.on(EVENTS.controllerAction, (action) => {
      this.dispatchEvent(new CustomEvent("action", { detail: action }));
    });
    this.socket.on(EVENTS.rtcSignal, (signal) => this.handleRtcSignal(signal));
  }

  acceptInput(input) {
    if (!isControllerInput(input) || input.seq <= this.input.seq) return;
    this.pendingViewDelta = {
      yaw: this.pendingViewDelta.yaw + input.viewDelta.yaw,
      pitch: this.pendingViewDelta.pitch + input.viewDelta.pitch,
    };
    this.input = {
      ...input,
      move: { ...input.move },
      viewDelta: { ...input.viewDelta },
      clutch: input.clutch,
      receivedAt: performance.now(),
    };
    this.dispatchEvent(new CustomEvent("input", { detail: this.input }));
  }

  acceptHandFrame(frame) {
    if (!isHandFrame(frame)) return false;
    if (frame.modeEpoch < this.handEpoch
      || (frame.modeEpoch === this.handEpoch && frame.seq <= this.handSeq)
      || (frame.modeEpoch > this.handEpoch && frame.seq <= this.handSeq)) return false;
    this.handEpoch = frame.modeEpoch;
    this.handSeq = frame.seq;
    this.dispatchEvent(new CustomEvent("hand", {
      detail: { ...frame, receivedAt: performance.now() },
    }));
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
      const url = await this.buildControllerUrl(result.code);
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 360,
        margin: 2,
        color: { dark: "#121413", light: "#f1f0e8" },
        errorCorrectionLevel: "M",
      });
      this.dispatchEvent(new CustomEvent("room", { detail: { code: result.code, url, qrDataUrl } }));
    });
  }

  async buildControllerUrl(code) {
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
    return url.toString();
  }

  setPeerConnected(connected) {
    const wasConnected = this.connected;
    this.connected = connected;
    if (connected && !wasConnected) {
      this.input = stoppedInput();
      this.pendingViewDelta = { yaw: 0, pitch: 0 };
      this.resetHandOrdering();
    } else if (!connected) {
      this.input = {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
        clutch: false,
      };
      this.pendingViewDelta = { yaw: 0, pitch: 0 };
      this.resetHandOrdering();
    }
    this.dispatchEvent(new CustomEvent("peer", { detail: { connected } }));
    if (connected) this.startRtcOffer();
    else this.closePeerConnection();
  }

  createPeerConnection() {
    if (typeof RTCPeerConnection === "undefined") return null;
    this.closePeerConnection();
    const peer = new RTCPeerConnection();
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket?.emit(EVENTS.rtcSignal, { candidate });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") this.closePeerConnection();
    };
    this.peerConnection = peer;
    return peer;
  }

  attachDataChannel(channel) {
    const isControls = !channel?.label || channel.label === "controls";
    const isHand = channel?.label === "hand";
    if (!isControls && !isHand) return;
    if (isHand) this.handChannel = channel;
    else this.dataChannel = channel;
    channel.onclose = () => {
      if (isHand) {
        if (this.handChannel === channel) this.handChannel = null;
      } else if (this.dataChannel === channel) this.dataChannel = null;
    };
    channel.onmessage = ({ data }) => {
      if (!isControls) return;
      try {
        const message = JSON.parse(data);
        if (message?.type === "input") this.acceptInput(message.payload);
      } catch {
        // Ignore malformed peer messages; Socket.IO remains the fallback.
      }
    };
  }

  async startRtcOffer() {
    const peer = this.createPeerConnection();
    if (!peer) return;
    try {
      this.attachDataChannel(peer.createDataChannel("controls", { ordered: false }));
      this.attachDataChannel(peer.createDataChannel("hand", { ordered: false, maxRetransmits: 0 }));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.socket?.emit(EVENTS.rtcSignal, { description: peer.localDescription });
    } catch {
      this.closePeerConnection();
    }
  }

  async handleRtcSignal(signal) {
    const peer = this.peerConnection;
    if (!peer) return;
    try {
      if (signal?.description) {
        await peer.setRemoteDescription(signal.description);
        for (const candidate of this.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
      } else if (signal?.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else this.pendingCandidates.push(signal.candidate);
      }
    } catch {
      this.closePeerConnection();
    }
  }

  closePeerConnection() {
    const controls = this.dataChannel;
    const hand = this.handChannel;
    controls?.close?.();
    if (hand && hand !== controls) hand.close?.();
    this.peerConnection?.close?.();
    this.dataChannel = null;
    this.handChannel = null;
    this.peerConnection = null;
    this.pendingCandidates = [];
    this.resetHandOrdering();
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
    this.closePeerConnection();
    this.socket?.disconnect();
  }
}
