import { io } from "socket.io-client";
import { EVENTS, isHandFrame } from "../shared/protocol.js";

export class ControllerSocket {
  constructor({ room, onStatus, onEvent, onTelemetry, now = () => performance.now() }) {
    this.room = room;
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.onTelemetry = onTelemetry;
    this.now = now;
    this.socket = null;
    this.joined = false;
    this.sequence = 0;
    this.latest = {
      move: { x: 0, y: 0 },
      clutch: false,
    };
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    this.sentAtBySequence = new Map();
    this.lastSentAt = null;
    this.telemetry = {
      serverRttMs: null,
      appliedRttMs: null,
      sendHz: 0,
      transport: "connecting",
      cameraYaw: 0,
      cameraPitch: 0,
    };
    this.timer = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.handChannel = null;
    this.pendingCandidates = [];
  }

  connect() {
    this.onStatus?.("connecting");
    this.socket = io({ transports: ["websocket", "polling"] });

    this.socket.on("connect", () => {
      this.socket.emit(EVENTS.controllerJoin, { room: this.room }, (result) => {
        this.joined = Boolean(result?.ok);
        this.onStatus?.(this.joined ? "joined" : result?.reason ?? "join-failed");
      });
    });
    this.socket.on("disconnect", () => {
      this.joined = false;
      this.latest = { move: { x: 0, y: 0 }, clutch: false };
      this.clearPendingViewDelta();
      this.closePeerConnection();
      this.onStatus?.("disconnected");
    });
    this.socket.on("connect_error", () => this.onStatus?.("connect-error"));
    this.socket.on(EVENTS.controllerReplaced, () => {
      this.joined = false;
      this.closePeerConnection();
      this.onStatus?.("replaced");
    });
    this.socket.on(EVENTS.sessionEnded, () => {
      this.joined = false;
      this.closePeerConnection();
      this.onStatus?.("session-ended");
    });
    this.socket.on(EVENTS.desktopEvent, (event) => this.onEvent?.(event));
    this.socket.on(EVENTS.rtcSignal, (signal) => this.handleRtcSignal(signal));

    this.timer = window.setInterval(() => this.flush(), 1000 / 15);
  }

  setInput(input, { immediate = false } = {}) {
    if (input.move) this.latest.move = { ...input.move };
    if (typeof input.clutch === "boolean") this.latest.clutch = input.clutch;
    if (input.viewDelta) {
      const delta = input.viewDelta;
      this.pendingViewDelta = {
        yaw: Math.max(-180, Math.min(180, this.pendingViewDelta.yaw + (Number.isFinite(delta.yaw) ? delta.yaw : 0))),
        pitch: Math.max(-180, Math.min(180, this.pendingViewDelta.pitch + (Number.isFinite(delta.pitch) ? delta.pitch : 0))),
      };
    }
    if (immediate) this.flush();
  }

  clearPendingViewDelta() {
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
  }

  flush() {
    if (!this.joined || !this.socket?.connected) return;
    this.sequence += 1;
    const sentAt = this.now();
    const interval = this.lastSentAt === null ? 0 : sentAt - this.lastSentAt;
    this.lastSentAt = sentAt;
    this.sentAtBySequence.set(this.sequence, sentAt);
    while (this.sentAtBySequence.size > 120) {
      this.sentAtBySequence.delete(this.sentAtBySequence.keys().next().value);
    }
    const viewDelta = this.pendingViewDelta;
    this.pendingViewDelta = { yaw: 0, pitch: 0 };
    const payload = {
      seq: this.sequence,
      sentAt,
      viewDelta,
      ...this.latest,
    };
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(JSON.stringify({ type: "input", payload }));
    } else {
      this.socket.emit(EVENTS.controllerInput, payload, () => {
        this.reportTelemetry({ serverRttMs: Math.max(0, this.now() - sentAt) });
      });
    }
    this.reportTelemetry({
      sendHz: interval > 0 ? 1000 / interval : this.telemetry.sendHz,
      transport: this.dataChannel?.readyState === "open"
        ? "webrtc"
        : this.socket.io?.engine?.transport?.name ?? "unknown",
    });
  }

  ensurePeerConnection() {
    if (this.peerConnection || typeof RTCPeerConnection === "undefined") return this.peerConnection;
    const peer = new RTCPeerConnection();
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket?.emit(EVENTS.rtcSignal, { candidate });
    };
    peer.ondatachannel = ({ channel }) => this.attachDataChannel(channel);
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
    channel.onopen = () => {
      if (isControls) this.reportTelemetry({ transport: "webrtc", serverRttMs: null });
    };
    channel.onclose = () => {
      if (isHand) {
        if (this.handChannel === channel) this.handChannel = null;
      } else {
        if (this.dataChannel === channel) this.dataChannel = null;
        this.reportTelemetry({ transport: this.socket?.io?.engine?.transport?.name ?? "unknown" });
      }
    };
    channel.onmessage = ({ data }) => {
      if (!isControls) return;
      try {
        const message = JSON.parse(data);
        if (message?.type === "feedback") this.onEvent?.(message.payload);
      } catch {
        // Ignore malformed peer messages and keep the fallback socket alive.
      }
    };
  }

  sendHandFrame(frame) {
    if (!this.joined || !this.socket?.connected || !isHandFrame(frame)) return false;
    if (this.handChannel?.readyState === "open") {
      if ((this.handChannel.bufferedAmount ?? 0) > 32_768) return false;
      this.handChannel.send(JSON.stringify({ type: "hand", payload: frame }));
      return true;
    }
    this.socket.emit(EVENTS.controllerHand, frame);
    return true;
  }

  async handleRtcSignal(signal) {
    const peer = this.ensurePeerConnection();
    if (!peer) return;
    try {
      if (signal?.description) {
        await peer.setRemoteDescription(signal.description);
        for (const candidate of this.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
        if (signal.description.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.socket?.emit(EVENTS.rtcSignal, { description: peer.localDescription });
        }
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
  }

  markApplied({ seq, cameraYaw, cameraPitch } = {}) {
    if (!Number.isInteger(seq)) return;
    const sentAt = this.sentAtBySequence.get(seq);
    if (!Number.isFinite(sentAt)) return;
    const appliedRttMs = Math.max(0, this.now() - sentAt);
    for (const sequence of this.sentAtBySequence.keys()) {
      if (sequence <= seq) this.sentAtBySequence.delete(sequence);
    }
    this.reportTelemetry({
      appliedRttMs,
      cameraYaw: Number.isFinite(cameraYaw) ? cameraYaw : this.telemetry.cameraYaw,
      cameraPitch: Number.isFinite(cameraPitch) ? cameraPitch : this.telemetry.cameraPitch,
    });
  }

  reportTelemetry(update) {
    this.telemetry = { ...this.telemetry, ...update };
    this.onTelemetry?.({ ...this.telemetry });
  }

  sendAction(action, detail = {}) {
    if (!this.joined || !this.socket?.connected) return;
    this.socket.emit(EVENTS.controllerAction, { action, sentAt: performance.now(), ...detail });
  }

  destroy() {
    window.clearInterval(this.timer);
    this.closePeerConnection();
    this.socket?.disconnect();
  }
}
