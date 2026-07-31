import { io } from "socket.io-client";
import { EVENTS } from "../shared/protocol.js";

export class ControllerSocket {
  constructor({ room, onStatus, onEvent }) {
    this.room = room;
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.socket = null;
    this.joined = false;
    this.sequence = 0;
    this.latest = {
      move: { x: 0, y: 0 },
      viewMotion: { x: 0, y: 0, confidence: 0 },
    };
    this.timer = null;
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
      this.onStatus?.("disconnected");
    });
    this.socket.on("connect_error", () => this.onStatus?.("connect-error"));
    this.socket.on(EVENTS.controllerReplaced, () => {
      this.joined = false;
      this.onStatus?.("replaced");
    });
    this.socket.on(EVENTS.sessionEnded, () => {
      this.joined = false;
      this.onStatus?.("session-ended");
    });
    this.socket.on(EVENTS.desktopEvent, (event) => this.onEvent?.(event));

    this.timer = window.setInterval(() => this.flush(), 1000 / 30);
  }

  setInput(input) {
    this.latest = {
      move: { ...input.move },
      viewMotion: { ...input.viewMotion },
    };
  }

  flush() {
    if (!this.joined || !this.socket?.connected) return;
    this.sequence += 1;
    this.socket.emit(EVENTS.controllerInput, {
      seq: this.sequence,
      sentAt: performance.now(),
      ...this.latest,
    });
  }

  sendAction(action, detail = {}) {
    if (!this.joined || !this.socket?.connected) return;
    this.socket.emit(EVENTS.controllerAction, { action, sentAt: performance.now(), ...detail });
  }

  destroy() {
    window.clearInterval(this.timer);
    this.socket?.disconnect();
  }
}
