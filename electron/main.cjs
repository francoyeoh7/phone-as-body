const { app, BrowserWindow } = require("electron");
const { fork, spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

// 机器环境可能全局设置了 ELECTRON_RUN_AS_NODE（VS Code 等工具的常见副作用），
// 它会让 Electron 以纯 Node 模式启动并导致 app 为 undefined。
// 检测到时剥离该变量后重新拉起自身。
if (process.env.ELECTRON_RUN_AS_NODE) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const relaunched = spawn(process.execPath, process.argv.slice(1), {
    env,
    detached: true,
    stdio: "inherit",
  });
  relaunched.on("exit", (code) => process.exit(code ?? 0));
} else {

const SERVER_PORT = Number(process.env.PORT) || 4174;
const PUBLIC_CONTROLLER_ORIGIN = process.env.PUBLIC_CONTROLLER_ORIGIN || "https://play.tokenxapp.com:8443";
const RELAY_URL = process.env.RELAY_URL || "https://play.tokenxapp.com:8443";
const SERVER_READY_TIMEOUT_MS = 30_000;
const MAX_RESTARTS = 5;

let mainWindow = null;
let serverChild = null;
let restartAttempts = 0;
let quitting = false;

const rootDir = path.join(__dirname, "..");

function startServer() {
  serverChild = fork(path.join(rootDir, "server", "index.js"), [], {
    cwd: rootDir,
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: process.env.NODE_ENV || "production",
      PORT: String(SERVER_PORT),
      PUBLIC_CONTROLLER_ORIGIN,
      RELAY_URL,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serverChild.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverChild.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverChild.on("exit", () => {
    serverChild = null;
    if (quitting || restartAttempts >= MAX_RESTARTS) return;
    restartAttempts += 1;
    const delay = Math.min(1000 * 2 ** restartAttempts, 15_000);
    setTimeout(startServer, delay);
  });
}

function waitForServer(timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${SERVER_PORT}/api/config`, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else retry();
      });
      request.on("error", retry);
      request.setTimeout(2_000, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("server did not become ready in time"));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0e100f",
    title: "手机即身体",
    autoHideMenuBar: true,
    show: false,
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    startServer();
    try {
      await waitForServer();
      await createWindow();
    } catch (error) {
      console.error(error);
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", () => {
    quitting = true;
    if (serverChild) serverChild.kill();
  });
}
}
