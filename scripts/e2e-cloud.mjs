import { createServer as createHttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import io from "socket.io-client";
import { createSessionRegistry } from "../server/session-registry.js";
import { createSocketRouter } from "../server/socket-router.js";
import { createRelayBridge } from "../server/relay-bridge.js";

const RELAY_URL = "https://play.tokenxapp.com:8443";

const httpServer = createHttpServer();
const localIo = new SocketIOServer(httpServer, { serveClient: false });
await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const localUrl = `http://127.0.0.1:${httpServer.address().port}`;

const bridge = createRelayBridge({ relayUrl: RELAY_URL, localServerUrl: localUrl, log: (line) => console.log("[bridge]", line) });
createSocketRouter(localIo, createSessionRegistry(), bridge);

const desktop = io(localUrl, { transports: ["websocket"] });
await new Promise((resolve) => desktop.once("connect", resolve));
const created = await new Promise((resolve) => desktop.emit("desktop:create", resolve));
console.log("room:", created.code, "secret:", created.secret);
await new Promise((resolve) => setTimeout(resolve, 500));

const phone = io(RELAY_URL, { transports: ["websocket"] });
await new Promise((resolve) => phone.once("connect", resolve));

const statusPromise = new Promise((resolve) => desktop.once("peer:status", resolve));
const joinResult = await new Promise((resolve) => phone.emit("controller:join", {
  room: created.code,
  k: created.secret,
  deviceToken: "e2e-cloud-test-1",
}, resolve));
console.log("phone1 join ack:", JSON.stringify(joinResult));
console.log("desktop peerStatus:", JSON.stringify(await statusPromise));

const inputPromise = new Promise((resolve) => desktop.once("controller:input", resolve));
phone.emit("controller:input", {
  seq: 1, sentAt: Date.now(), move: { x: 0, y: 1 }, viewDelta: { yaw: 5, pitch: 0 }, clutch: false,
});
console.log("input envelope at desktop:", JSON.stringify(await inputPromise));

const eventPromise = new Promise((resolve) => phone.once("desktop:event", resolve));
desktop.emit("desktop:event", { type: "control-feedback", kind: "step" });
console.log("phone1 got desktop event:", JSON.stringify(await eventPromise));

const phone2 = io(RELAY_URL, { transports: ["websocket"] });
await new Promise((resolve) => phone2.once("connect", resolve));
const join2 = await new Promise((resolve) => phone2.emit("controller:join", {
  room: created.code,
  k: created.secret,
  deviceToken: "e2e-cloud-test-2",
}, resolve));
console.log("phone2 join ack (expect slot 1 / P2):", JSON.stringify(join2));

console.log("E2E-CLOUD-PASS");
phone.close();
phone2.close();
desktop.close();
bridge.close();
localIo.close(() => httpServer.close(() => process.exit(0)));
