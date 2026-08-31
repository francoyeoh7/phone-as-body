import { io } from "socket.io-client";

const base = process.argv[2] ?? "http://localhost:4176";
const log = (...args) => console.log("[smoke]", ...args);

const host = io(base, { transports: ["websocket"] });
await new Promise((resolve, reject) => {
  host.on("connect", resolve);
  host.on("connect_error", reject);
});

const { code } = await host.emitWithAck("egg:host-create");
log("room created:", code);

host.on("egg:room-update", ({ players }) => {
  log("roster:", players.map((p) => `${p.slot}:${p.name}${p.connected ? "" : "(off)"}`).join(" "));
});

let received = 0;
host.on("egg:player-tilt", (payload) => {
  received += 1;
  if (received === 1 || received % 50 === 0) {
    log(`tilt #${received} slot=${payload.slot} g=${payload.g.map((v) => v.toFixed(2)).join(",")}`);
  }
});

host.on("egg:host-phase", () => {});
host.on("egg:host-event", () => {});

async function joinPlayer(name, key) {
  const socket = io(base, { transports: ["websocket"] });
  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  const result = await socket.emitWithAck("egg:player-join", { room: code, key, name });
  log(`join ${name}:`, JSON.stringify({ ok: result.ok, slot: result.slot }));
  return socket;
}

const p1 = await joinPlayer("玩家一", "smoke-key-aaaaaa");
const p2 = await joinPlayer("玩家二", "smoke-key-bbbbbb");

const gravity = [0, -0.3, 0.95];
const length = Math.hypot(...gravity);
const g = gravity.map((v) => v / length);

for (let index = 0; index < 120; index += 1) {
  p1.volatile.emit("egg:player-tilt", { seq: index, sentAt: Date.now(), g, r: [0, 0, 0, 1], m: [0, 1] });
  p2.volatile.emit("egg:player-tilt", { seq: index, sentAt: Date.now(), g, r: [0, 0, 0, 1], m: [0, 1] });
  await new Promise((resolve) => setTimeout(resolve, 16));
}

host.emit("egg:host-phase", { phase: "racing", at: Date.now() });
host.emit("egg:host-event", { event: "drop", slot: 0 });
host.emit("egg:host-event", { event: "collide", slot: 1 });

await new Promise((resolve) => setTimeout(resolve, 500));
log(`tilt relayed: ${received}/240`);
log(received >= 200 ? "PASS" : "FAIL");
host.disconnect();
p1.disconnect();
p2.disconnect();
process.exit(received >= 200 ? 0 : 1);
