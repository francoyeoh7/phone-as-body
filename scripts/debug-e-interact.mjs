// Throwaway diagnostic: drives the desktop game in Electron and reports each
// layer of the E-interaction chain. Not part of the build.
import { app, BrowserWindow } from "electron";

const URL = process.env.DEBUG_URL ?? "http://localhost:4174/?autostart=keyboard";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("[probe] main alive, waiting ready");

async function main() {

const win = new BrowserWindow({
  width: 1280,
  height: 760,
  show: true,
  webPreferences: { contextIsolation: true, backgroundThrottling: false },
});
win.focus();
win.setAlwaysOnTop(true, "screen-saver");
win.setAlwaysOnTop(false);
win.webContents.on("console-message", (_e, _level, message) => console.log("[page]", message));
win.webContents.on("did-start-loading", () => console.log("[probe] did-start-loading"));
win.webContents.on("dom-ready", () => console.log("[probe] dom-ready"));
win.webContents.on("did-fail-load", (_e, code, desc) => console.log("[probe] did-fail-load", code, desc));
win.webContents.on("render-process-gone", (_e, details) => {
  console.log("[fatal] renderer gone:", JSON.stringify(details));
  app.exit(2);
});

console.log("[probe] loadURL begin");
await win.loadURL(URL);
console.log("[probe] loaded", URL);

const evalInPage = (code) => win.webContents.executeJavaScript(code, true);

// Wait until the scene is up and bots are loaded.
let ready = false;
for (let i = 0; i < 120; i += 1) {
  const state = await evalInPage(`(() => {
    const app = window.__desktopApp;
    if (!app) return { stage: "no-app" };
    return {
      stage: "poll",
      started: app.started,
      paused: app.paused,
      hasPlayer: Boolean(app.player),
      director: app.director?.constructor?.name ?? null,
      botsLoaded: app.director?.bots?.loaded ?? null,
      botCount: app.director?.bots?.bots?.length ?? 0,
      phase: app.director?.state?.phase ?? null,
      hidden: document.hidden,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
    };
  })()`);
  if (i % 10 === 0 || state.botsLoaded) console.log("[probe] poll", JSON.stringify(state));
  if (state.started && state.hasPlayer && state.botsLoaded) { ready = true; break; }
  await sleep(500);
}
if (!ready) {
  console.log("[probe] TIMEOUT waiting for scene/bots");
  app.exit(3);
}

// Teleport the player in front of bot-1 and aim at it.
const aim = await evalInPage(`(() => {
  const app = window.__desktopApp;
  const bot = app.director.bots.bots[0];
  const bp = bot.root.position;
  const px = bp.x, pz = bp.z + 1.6;
  app.player.body.setTranslation({ x: px, y: 1.05, z: pz }, true);
  app.player.body.setNextKinematicTranslation({ x: px, y: 1.05, z: pz });
  const dx = bp.x - px, dz = bp.z - pz;
  const yaw = Math.atan2(-dx, -dz);
  app.player.cameraYaw = yaw; app.player.cameraRenderYaw = yaw;
  app.player.cameraPitch = 0; app.player.cameraRenderPitch = 0;
  return { bot: bot.id, botPos: { x: bp.x, z: bp.z }, yaw };
})()`);
console.log("[probe] teleported:", JSON.stringify(aim));

await sleep(800); // let updateInteraction run a few frames

const before = await evalInPage(`(() => {
  const app = window.__desktopApp;
  return {
    selected: app.player.selected?.id ?? null,
    crouchAmount: app.player.crouchAmount,
    debugText: document.querySelector("#interaction-debug")?.textContent ?? null,
    menuHidden: document.querySelector("#option-menu")?.hidden ?? "missing",
    tradeHidden: document.querySelector("#trade-overlay")?.hidden ?? "missing",
    paused: app.paused,
    hidden: document.hidden,
    hasFocus: document.hasFocus(),
    frames: app.debugFrames,
    pauseOverlayHidden: document.querySelector("#pause")?.hidden ?? "missing",
    panelsOpen: app.panels?.isOpen ?? null,
    tradeOpen: app.trade?.isOpen ?? null,
    presentationOpen: app.presentation?.isOpen?.() ?? null,
    foundPhoneInspecting: app.foundPhone?.isInspecting?.() ?? null,
  };
})()`);
console.log("[probe] before E:", JSON.stringify(before));

// If the game auto-paused, resume the way a player would: Escape.
if (before.paused) {
  await evalInPage(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }))`);
  await sleep(300);
}

// Drive interaction frames manually — the Electron window is unfocused and
// Chromium throttles rAF to ~1fps, which pollutes every measurement.
const manual = await evalInPage(`(() => {
  const app = window.__desktopApp;
  const THREE_NS = app.player.camera.constructor; // not needed; use player internals
  for (let i = 0; i < 30; i += 1) app.player.update(1 / 60);
  const ray = app.player.raycaster;
  const enabledRoots = app.player.interactables.filter((e) => e.enabled && e.root.visible).map((e) => e.root);
  const hits = ray.intersectObjects(enabledRoots, true).slice(0, 3).map((h) => ({
    name: h.object?.name, type: h.object?.type, dist: Number(h.distance.toFixed(2)),
    chainInteractableId: (() => { let o = h.object; while (o && !o.userData?.interactableId) o = o.parent; return o?.userData?.interactableId ?? null; })(),
  }));
  return {
    selected: app.player.selected?.id ?? null,
    debug: document.querySelector("#interaction-debug")?.textContent ?? null,
    hitCount: hits.length,
    hits,
    interactableCount: app.player.interactables.length,
    enabledCount: enabledRoots.length,
    occluderCount: app.player.staticOccluderRoots?.length ?? 0,
    camPos: app.player.camera.position.toArray().map((v) => Number(v.toFixed(2))),
    camYaw: Number(app.player.cameraRenderYaw.toFixed(2)),
    botPos: app.director.bots.bots[0].root.position.toArray().map((v) => Number(v.toFixed(2))),
  };
})()`);
console.log("[probe] manual 30 frames:", JSON.stringify(manual, null, 1));

// Positive control: freeze the bot, stand 1.5m dead ahead, re-test selection.
const control = await evalInPage(`(() => {
  const app = window.__desktopApp;
  const bot = app.director.bots.bots[0];
  bot.pauseUntil = 1e9; bot.speed = 0;
  const bp = bot.root.position;
  const px = bp.x, pz = bp.z + 1.5;
  app.player.body.setTranslation({ x: px, y: 1.05, z: pz }, true);
  app.player.body.setNextKinematicTranslation({ x: px, y: 1.05, z: pz });
  app.player.cameraYaw = 0; app.player.cameraRenderYaw = 0;
  app.player.cameraPitch = 0; app.player.cameraRenderPitch = 0;
  for (let i = 0; i < 10; i += 1) app.player.update(1 / 60);
  const entry = app.player.interactables.find((e) => e.id === "bot-1");
  const anchorPos = bot.root.getWorldPosition(new (app.player.camera.position.constructor)());
  const occluded = app.player.isAnchorOccluded(anchorPos, 0.4);
  return {
    selected: app.player.selected?.id ?? null,
    occluded,
    anchor: anchorPos.toArray().map((v) => Number(v.toFixed(2))),
    camPos: app.player.camera.position.toArray().map((v) => Number(v.toFixed(2))),
    entryEnabled: entry?.enabled,
    rootVisible: entry?.root?.visible,
    debug: document.querySelector("#interaction-debug")?.textContent ?? null,
  };
})()`);
console.log("[probe] positive control:", JSON.stringify(control));

await evalInPage(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", bubbles: true }))`);
await sleep(300);
const controlAfter = await evalInPage(`(() => {
  const menu = document.querySelector("#option-menu");
  const cs = menu ? getComputedStyle(menu) : null;
  return {
    debugText: document.querySelector("#interaction-debug")?.textContent ?? null,
    menuHidden: menu?.hidden ?? "missing",
    menuDisplay: cs?.display ?? null,
    menuVisible: Boolean(menu && !menu.hidden && cs && cs.display !== "none"),
    menuButtons: [...(document.querySelectorAll("#option-menu .option-button") ?? [])].map((b) => b.textContent.trim()),
    panelsOpen: window.__desktopApp.panels?.isOpen ?? null,
  };
})()`);
console.log("[probe] control E:", JSON.stringify(controlAfter));

// Close the menu again so later probes see a clean state.
await evalInPage(`window.__desktopApp.panels?.close?.()`);

// Press E via a real key event.
await evalInPage(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", bubbles: true }))`);
await sleep(300);

const after = await evalInPage(`(() => {
  const app = window.__desktopApp;
  return {
    debugText: document.querySelector("#interaction-debug")?.textContent ?? null,
    menuHidden: document.querySelector("#option-menu")?.hidden ?? "missing",
    menuButtons: [...(document.querySelectorAll("#option-menu .option-button") ?? [])].map((b) => b.textContent.trim()),
    panelsOpen: app.panels?.isOpen ?? null,
  };
})()`);
console.log("[probe] after E:", JSON.stringify(after));

// Freeze probes: right-click path and visibility toggle.
const flashBefore = await evalInPage(`(() => {
  const app = window.__desktopApp;
  const group = app.experience?.objects?.flashlight;
  return { enabled: group?.userData?.flashlightEnabled ?? null, core: app.experience?.objects?.flashlightCore?.intensity ?? null, visible: group?.visible ?? null, frames: app.debugFrames };
})()`);
await evalInPage(`window.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }))`);
await sleep(300);
const flash = await evalInPage(`(() => {
  const app = window.__desktopApp;
  const group = app.experience?.objects?.flashlight;
  return { enabled: group?.userData?.flashlightEnabled ?? null, core: app.experience?.objects?.flashlightCore?.intensity ?? null, visible: group?.visible ?? null, frames: app.debugFrames };
})()`);
await sleep(700);
const flash2 = await evalInPage(`(() => ({ frames: window.__desktopApp.debugFrames }))()`);
console.log("[probe] right-click:", JSON.stringify(flashBefore), "->", JSON.stringify(flash), "frames advanced:", flash2.frames - flash.frames);

await win.webContents.executeJavaScript(`void 0`);
app.exit(0);
}

app.whenReady().then(() => main().catch((error) => {
  console.log("[fatal]", error?.stack ?? error);
  app.exit(5);
}));