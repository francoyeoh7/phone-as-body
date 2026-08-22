import { io } from "socket.io-client";

export const LOBBY_EVENTS = Object.freeze({
  create: "lobby:create",
  join: "lobby:join",
  leave: "lobby:leave",
  start: "lobby:start",
  state: "lobby:state",
  started: "lobby:started",
  ended: "lobby:ended",
});

const ACK_TIMEOUT_MS = 8_000;

export class LobbyClient extends EventTarget {
  constructor({ fetchImpl = globalThis.fetch?.bind(globalThis), ioImpl = io } = {}) {
    super();
    this.fetchImpl = fetchImpl;
    this.ioImpl = ioImpl;
    this.socket = null;
    this.code = null;
    this.selfSocketId = null;
  }

  async resolveOrigin() {
    try {
      const response = await this.fetchImpl("/api/config");
      const config = await response.json();
      if (typeof config?.controllerOrigin === "string" && config.controllerOrigin) {
        return config.controllerOrigin;
      }
    } catch {
      // fall through to unavailable
    }
    return null;
  }

  async #ensureSocket() {
    if (this.socket?.connected) return this.socket;
    const origin = await this.resolveOrigin();
    if (!origin) return null;
    if (!this.socket) {
      this.socket = this.ioImpl(origin, { transports: ["websocket"] });
      this.selfSocketId = this.socket.id;
      this.socket.on(LOBBY_EVENTS.state, (state) => {
        this.code = state?.code ?? this.code;
        this.dispatchEvent(new CustomEvent("state", { detail: state }));
      });
      this.socket.on(LOBBY_EVENTS.started, (detail) => {
        this.dispatchEvent(new CustomEvent("started", { detail }));
      });
      this.socket.on(LOBBY_EVENTS.ended, (detail) => {
        this.code = null;
        this.dispatchEvent(new CustomEvent("ended", { detail }));
      });
      this.socket.on("connect", () => {
        this.selfSocketId = this.socket.id;
      });
    }
    if (!this.socket.connected) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("lobby-connect-timeout")), ACK_TIMEOUT_MS);
        this.socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        this.socket.once("connect_error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }
    return this.socket;
  }

  async #emitAck(event, payload) {
    const socket = await this.#ensureSocket();
    if (!socket) return { ok: false, reason: "cloud-unavailable" };
    return new Promise((resolve) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error, responses) => {
        if (error) resolve({ ok: false, reason: "timeout" });
        else resolve(responses?.[0] ?? { ok: false, reason: "no-ack" });
      });
    });
  }

  create(name) {
    return this.#emitAck(LOBBY_EVENTS.create, { name });
  }

  join(code, name) {
    return this.#emitAck(LOBBY_EVENTS.join, { code, name });
  }

  start() {
    if (!this.code) return Promise.resolve({ ok: false, reason: "not-in-lobby" });
    return this.#emitAck(LOBBY_EVENTS.start, { code: this.code });
  }

  leave() {
    if (this.socket?.connected) this.socket.emit(LOBBY_EVENTS.leave);
    this.code = null;
  }

  destroy() {
    this.socket?.disconnect();
    this.socket = null;
    this.code = null;
  }
}
