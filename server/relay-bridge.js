import { io } from "socket.io-client";
import { EVENTS } from "../src/shared/protocol.js";

const CONTROLLER_RECEIVES = [
  EVENTS.desktopEvent,
  EVENTS.controllerReplaced,
  EVENTS.sessionEnded,
  EVENTS.rtcSignal,
];

export function createRelayBridge({ relayUrl, localServerUrl, log = () => {} }) {
  const relay = io(relayUrl, { transports: ["websocket"], reconnectionDelayMax: 10_000 });
  const rooms = new Map();
  const remotes = new Map();

  function registerRoom(code, secret) {
    if (!code || typeof secret !== "string") return;
    rooms.set(code, secret);
    if (relay.connected) {
      relay.emit("relayRegister", { code, secret }, (result) => log(`relay register ${code}: ${result?.ok}`));
    }
  }

  function unregisterRoom(code) {
    if (!rooms.has(code)) return;
    rooms.delete(code);
    for (const [cid, remote] of remotes) {
      if (remote.code === code) {
        remote.socket.disconnect();
        remotes.delete(cid);
      }
    }
    if (relay.connected) relay.emit("relayUnregister", { code });
  }

  relay.on("connect", () => {
    for (const [code, secret] of rooms) {
      relay.emit("relayRegister", { code, secret }, (result) => log(`relay register ${code}: ${result?.ok}`));
    }
  });

  relay.on("relay:c2d", (message, acknowledge) => {
    const { code, cid, event, payload } = message ?? {};
    if (event === EVENTS.controllerJoin) {
      if (remotes.has(cid)) {
        acknowledge?.({ ok: false, reason: "duplicate-controller" });
        return;
      }
      const socket = io(localServerUrl, { transports: ["websocket"] });
      remotes.set(cid, { code, socket });
      for (const forwarded of CONTROLLER_RECEIVES) {
        socket.on(forwarded, (data) => {
          if (relay.connected) relay.emit("relay:d2c", { code, cid, event: forwarded, payload: data });
          if (forwarded === EVENTS.controllerReplaced || forwarded === EVENTS.sessionEnded) {
            socket.disconnect();
          }
        });
      }
      socket.on("connect", () => {
        socket.emit(EVENTS.controllerJoin, { room: code, deviceToken: payload?.deviceToken ?? null }, (result) => {
          acknowledge?.(result);
        });
      });
      socket.on("disconnect", () => {
        if (remotes.get(cid)?.socket === socket) remotes.delete(cid);
      });
      return;
    }

    const remote = remotes.get(cid);
    if (!remote) {
      acknowledge?.({ ok: false, reason: "unknown-controller" });
      return;
    }
    if (typeof acknowledge === "function") {
      remote.socket.emit(event, payload, (result) => acknowledge(result));
    } else {
      remote.socket.emit(event, payload);
    }
  });

  return {
    registerRoom,
    unregisterRoom,
    close() {
      for (const remote of remotes.values()) remote.socket.disconnect();
      remotes.clear();
      rooms.clear();
      relay.disconnect();
    },
  };
}
