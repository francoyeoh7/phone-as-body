// Starts the egg race demo with a public HTTPS tunnel so real phones can use
// their gyroscopes (DeviceOrientation requires a secure context).
//
//   node scripts/start-egg-race.mjs          tunnel + server
//   node scripts/start-egg-race.mjs --lan    server only (keyboard play / LAN http)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 4174;
const lanOnly = process.argv.includes("--lan");

function log(message) {
  console.log(`[egg-race] ${message}`);
}

function findCloudflared() {
  const candidates = [
    "cloudflared",
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
  ];
  return candidates;
}

function startTunnel() {
  return new Promise((resolve) => {
    const binaries = findCloudflared();
    let attempt = 0;

    const tryNext = () => {
      if (attempt >= binaries.length) {
        log("找不到 cloudflared，退回局域网模式（真机陀螺仪不可用）");
        resolve(null);
        return;
      }
      const binary = binaries[attempt];
      attempt += 1;
      let tunnel;
      try {
        tunnel = spawn(binary, ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        tryNext();
        return;
      }

      let settled = false;
      const finish = (url, child) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve({ url, child });
      };

      const deadline = setTimeout(() => {
        tunnel.kill();
        log("隧道 30 秒内未就绪，退回局域网模式");
        resolve(null);
      }, 30_000);

      const scan = (chunk) => {
        const text = chunk.toString();
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) finish(match[0], tunnel);
      };
      tunnel.stdout.on("data", scan);
      tunnel.stderr.on("data", scan);
      tunnel.on("error", () => {
        clearTimeout(deadline);
        if (!settled) tryNext();
      });
      tunnel.on("exit", () => {
        clearTimeout(deadline);
        if (!settled) tryNext();
      });
    };

    tryNext();
  });
}

function startServer(controllerOrigin) {
  const env = { ...process.env, NODE_ENV: "development", PORT: String(port) };
  if (controllerOrigin) env.PUBLIC_CONTROLLER_ORIGIN = controllerOrigin;
  const server = spawn(process.execPath, [path.join(root, "server", "index.js")], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  return server;
}

let tunnelChild = null;
let controllerOrigin = null;

if (!lanOnly) {
  log("正在创建 HTTPS 隧道（手机陀螺仪需要安全上下文）…");
  const tunnel = await startTunnel();
  if (tunnel) {
    tunnelChild = tunnel.child;
    controllerOrigin = tunnel.url;
    log(`隧道就绪：${controllerOrigin}`);
  }
}

startServer(controllerOrigin);

const origin = controllerOrigin ?? `http://localhost:${port}`;
log("──────────────────────────────────────────────");
log(`电脑打开（大屏 + 二维码）：http://localhost:${port}/egg-race`);
log(`手机扫码进入：${origin}/egg-race/controller?room=房间码`);
log("──────────────────────────────────────────────");

function shutdown() {
  try { tunnelChild?.kill(); } catch { /* noop */ }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
