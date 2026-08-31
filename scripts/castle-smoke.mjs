import { io } from "socket.io-client";

const base = process.argv[2] ?? "http://localhost:4176";

const host = io(base, { transports: ["websocket"] });
await new Promise((resolve, reject) => {
  host.on("connect", resolve);
  host.on("connect_error", reject);
});
const { code } = await host.emitWithAck("castle:host-create");
console.log("[smoke] room:", code);

const phone = io(base, { transports: ["websocket"] });
await new Promise((resolve, reject) => {
  phone.on("connect", resolve);
  phone.on("connect_error", reject);
});
const joined = await phone.emitWithAck("castle:player-join", { room: code, key: "castle-smoke-key1", name: "测试" });
console.log("[smoke] join:", joined.ok, joined.name);

let inputs = 0;
let actions = 0;
host.on("castle:player-input", () => { inputs += 1; });
host.on("castle:player-action", () => { actions += 1; });

for (let index = 0; index < 30; index += 1) {
  phone.volatile.emit("castle:player-input", { seq: index, sentAt: Date.now(), m: [0, 1], dyaw: 0.5, dpitch: 0, light: true, crouch: false });
  await new Promise((resolve) => setTimeout(resolve, 33));
}
phone.emit("castle:player-action", { action: "grab" });
host.emit("castle:host-phase", { phase: "playing", at: Date.now(), viewMode: "tp" });
host.emit("castle:host-event", { event: "collect", value: 2, total: 5 });

await new Promise((resolve) => setTimeout(resolve, 400));
console.log(`[smoke] inputs: ${inputs}/30, actions: ${actions}`);
console.log(inputs >= 25 && actions === 1 ? "[smoke] PASS" : "[smoke] FAIL");
host.disconnect();
phone.disconnect();
process.exit(inputs >= 25 && actions === 1 ? 0 : 1);
