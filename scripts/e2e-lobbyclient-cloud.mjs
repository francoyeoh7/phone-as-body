// 用真实 LobbyClient + 真实本地服务 + 真实云端跑大厅流程（桌面客户端完整路径）
import { spawn } from "node:child_process";
import http from "node:http";
import { LobbyClient } from "../src/desktop/LobbyClient.js";

const PORT = 4590;
const CLOUD = "https://play.tokenxapp.com:8443";

const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), PUBLIC_CONTROLLER_ORIGIN: CLOUD },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

await new Promise((resolve, reject) => {
  const startedAt = Date.now();
  const attempt = () => {
    const request = http.get(`http://127.0.0.1:${PORT}/api/config`, (response) => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else retry();
    });
    request.on("error", retry);
    function retry() {
      if (Date.now() - startedAt > 15_000) reject(new Error("local server not ready"));
      else setTimeout(attempt, 300);
    }
  };
  attempt();
});
console.log("local server ready");

const origin = `http://127.0.0.1:${PORT}`;
const fetchImpl = (url, options) => fetch(new URL(url, origin), options);

const host = new LobbyClient({ fetchImpl });
const guest = new LobbyClient({ fetchImpl });

const hostStates = [];
host.addEventListener("state", (event) => hostStates.push(event.detail));

const created = await host.create("房主电脑");
console.log("create:", JSON.stringify(created));
if (!created.ok) {
  server.kill();
  process.exit(1);
}

const guestStates = [];
guest.addEventListener("state", (event) => guestStates.push(event.detail));
const joined = await guest.join(created.code, "玩家电脑");
console.log("join:", JSON.stringify(joined));
if (!joined.ok) {
  server.kill();
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, 500));
const roster = hostStates.at(-1)?.players.map((player) => `${player.name}${player.isHost ? "(主机)" : ""}`);
console.log("roster:", roster.join(", "));
if (roster.length !== 2) {
  server.kill();
  process.exit(1);
}

const startedEvents = [];
guest.addEventListener("started", (event) => startedEvents.push(event.detail));
const started = await host.start();
console.log("start:", JSON.stringify(started));
await new Promise((resolve) => setTimeout(resolve, 500));
console.log("guest got started broadcast:", JSON.stringify(startedEvents[0]));

host.destroy();
guest.destroy();
server.kill();
console.log(startedEvents.length === 1 ? "E2E-LOBBYCLIENT-CLOUD-PASS" : "E2E-LOBBYCLIENT-CLOUD-FAIL");
setTimeout(() => process.exit(startedEvents.length === 1 ? 0 : 1), 500);
