import QRCode from "qrcode";
import { io } from "socket.io-client";
import { EVENTS } from "../shared/protocol.js";

const stoppedInput = () => ({
  seq: -1,
  move: { x: 0, y: 0 },
  viewDelta: { yaw: 0, pitch: 0 },
  receivedAt: 0,
});

export class PhoneSession extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.room = null;
    this.input = stoppedInput();
    this.connected = false;
  }

  start() {
    this.socket = io({ transports: ["websocket", "polling"] });
    this.socket.on("connect", () => this.createRoom());
    this.socket.on("disconnect", () => this.setPeerConnected(false));
    this.socket.on(EVENTS.peerStatus, ({ connected }) => this.setPeerConnected(Boolean(connected)));
    this.socket.on(EVENTS.controllerInput, (input) => {
      this.input = {
        ...input,
        move: { ...input.move },
        viewDelta: { ...input.viewDelta },
        receivedAt: performance.now(),
      };
      this.dispatchEvent(new CustomEvent("input", { detail: this.input }));
    });
    this.socket.on(EVENTS.controllerAction, (action) => {
      this.dispatchEvent(new CustomEvent("action", { detail: action }));
    });
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
    this.connected = connected;
    if (!connected) {
      this.input = {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
      };
    }
    this.dispatchEvent(new CustomEvent("peer", { detail: { connected } }));
  }

  currentInput(maxAgeMs = 500) {
    if (!this.connected || performance.now() - this.input.receivedAt > maxAgeMs) {
      return {
        ...this.input,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
      };
    }
    return this.input;
  }

  send(event) {
    if (this.room && this.socket?.connected) this.socket.emit(EVENTS.desktopEvent, event);
  }

  destroy() {
    this.socket?.disconnect();
  }
}
