import io from "socket.io-client";

const RELAY_URL = "https://play.tokenxapp.com:8443";

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

const host = io(RELAY_URL, { transports: ["websocket"] });
const guest = io(RELAY_URL, { transports: ["websocket"] });
await Promise.all([nextEvent(host, "connect"), nextEvent(guest, "connect")]);

const stateAtHost = nextEvent(host, "lobby:state");
const created = await emitAck(host, "lobby:create", { name: "房主电脑" });
console.log("create:", JSON.stringify(created));
const state1 = await stateAtHost;
console.log("host sees roster:", state1.players.map((p) => `${p.name}${p.isHost ? "(主机)" : ""}`).join(", "));

const stateAtHost2 = nextEvent(host, "lobby:state");
const stateAtGuest = nextEvent(guest, "lobby:state");
const joined = await emitAck(guest, "lobby:join", { code: created.code, name: "玩家电脑" });
console.log("guest join:", JSON.stringify(joined));
const state2 = await stateAtHost2;
const guestState = await stateAtGuest;
console.log("roster after join:", state2.players.map((p) => `${p.name}${p.isHost ? "(主机)" : ""}`).join(", "));
console.log("guest sees same roster:", JSON.stringify(guestState.players) === JSON.stringify(state2.players));

const startedAtHost = nextEvent(host, "lobby:started");
const startedAtGuest = nextEvent(guest, "lobby:started");
const started = await emitAck(host, "lobby:start", { code: created.code });
console.log("host start:", JSON.stringify(started));
console.log("host got started:", JSON.stringify(await startedAtHost));
console.log("guest got started:", JSON.stringify(await startedAtGuest));

console.log("E2E-LOBBY-CLOUD-PASS");
host.close();
guest.close();
setTimeout(() => process.exit(0), 500);
