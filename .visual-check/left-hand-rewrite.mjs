import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const requireFromTools = createRequire(path.join(process.env.TEMP, "corridor617-playwright", "package.json"));
const { chromium } = requireFromTools("playwright");
const origin = process.env.CORRIDOR_ORIGIN || "http://127.0.0.1:4176";
const output = path.resolve(".visual-check", "latest");
fs.mkdirSync(output, { recursive: true });

const OPEN_POINTS = [
  [0.50, 0.82, 0.000],
  [0.42, 0.72, -0.010], [0.34, 0.64, -0.020], [0.27, 0.56, -0.025], [0.20, 0.49, -0.030],
  [0.42, 0.59, 0.000], [0.40, 0.43, -0.010], [0.39, 0.29, -0.015], [0.38, 0.16, -0.020],
  [0.50, 0.56, 0.000], [0.50, 0.38, -0.010], [0.50, 0.23, -0.015], [0.50, 0.09, -0.020],
  [0.58, 0.59, 0.000], [0.60, 0.43, -0.005], [0.61, 0.30, -0.010], [0.62, 0.18, -0.015],
  [0.65, 0.64, 0.000], [0.68, 0.51, -0.005], [0.70, 0.41, -0.010], [0.72, 0.32, -0.015],
];

function translateLandmarks(points, wristX, wristY) {
  const offsetX = wristX - points[0][0];
  const offsetY = wristY - points[0][1];
  return points.map(([x, y, z]) => [x + offsetX, y + offsetY, z]);
}

async function imageStats(file) {
  const { data, info } = await sharp(file)
    .resize(160, 100, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = 0;
  const colors = new Set();
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (r + g + b >= 21) visible += 1;
    colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  const pixels = data.length / info.channels;
  return { visibleRatio: visible / pixels, quantizedColors: colors.size };
}

async function capturePose(page, name, center, basis, points) {
  const state = await page.evaluate(({ points, centerValue, wristBasis }) => {
    const app = window.__corridor617;
    const hand = app.handTracking.hand;
    const wrist = points[0];
    const worldLandmarks = points.map(([x, y, z]) => [
      (x - wrist[0]) * 0.38,
      (y - wrist[1]) * 0.38,
      (z - wrist[2]) * 0.38,
    ]);
    const pose = {
      state: "tracked",
      handedness: "left",
      inputMirrored: true,
      center: centerValue,
      landmarks: points,
      worldLandmarks,
      wrist: wristBasis,
      relativeScale: 1,
      trackingConfidence: 1,
      handConfidence: 1,
      reachEligible: false,
      reachProgress: 0,
      opacity: 1,
    };
    hand.applyPose(pose, 2);
    app.experience.scene.updateMatrixWorld(true);
    const bones = hand.presentationBones;
    const vector = (bone) => bone.getWorldPosition({
      x: 0,
      y: 0,
      z: 0,
      setFromMatrixPosition(matrix) {
        this.x = matrix.elements[12];
        this.y = matrix.elements[13];
        this.z = matrix.elements[14];
        return this;
      },
      distanceTo(other) {
        return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
      },
    });
    const shoulder = vector(bones.shoulderL);
    const wristPosition = vector(bones.handL);
    const index = vector(bones.palm01L);
    const pinky = vector(bones.palm04L);
    const quaternion = bones.handL.getWorldQuaternion({
      x: 0, y: 0, z: 0, w: 1,
      setFromRotationMatrix(matrix) {
        const te = matrix.elements;
        const trace = te[0] + te[5] + te[10];
        if (trace > 0) {
          const s = 0.5 / Math.sqrt(trace + 1);
          this.w = 0.25 / s;
          this.x = (te[6] - te[9]) * s;
          this.y = (te[8] - te[2]) * s;
          this.z = (te[1] - te[4]) * s;
        } else if (te[0] > te[5] && te[0] > te[10]) {
          const s = 2 * Math.sqrt(1 + te[0] - te[5] - te[10]);
          this.w = (te[6] - te[9]) / s;
          this.x = 0.25 * s;
          this.y = (te[4] + te[1]) / s;
          this.z = (te[8] + te[2]) / s;
        } else if (te[5] > te[10]) {
          const s = 2 * Math.sqrt(1 + te[5] - te[0] - te[10]);
          this.w = (te[8] - te[2]) / s;
          this.x = (te[4] + te[1]) / s;
          this.y = 0.25 * s;
          this.z = (te[9] + te[6]) / s;
        } else {
          const s = 2 * Math.sqrt(1 + te[10] - te[0] - te[5]);
          this.w = (te[1] - te[4]) / s;
          this.x = (te[8] + te[2]) / s;
          this.y = (te[9] + te[6]) / s;
          this.z = 0.25 * s;
        }
        return this;
      },
    });
    const forward = [
      2 * (quaternion.x * quaternion.z + quaternion.w * quaternion.y),
      2 * (quaternion.y * quaternion.z - quaternion.w * quaternion.x),
      1 - 2 * (quaternion.x ** 2 + quaternion.y ** 2),
    ];
    app.experience.renderer.render(app.experience.scene, app.experience.camera);
    return {
      visible: hand.root.visible,
      opacity: hand.opacity,
      root: hand.root.position.toArray(),
      armLength: shoulder.distanceTo(wristPosition),
      palmWidth: index.distanceTo(pinky),
      forward,
    };
  }, { points, centerValue: center, wristBasis: basis });
  const screenshot = path.join(output, `${name}.png`);
  await page.screenshot({ path: screenshot, timeout: 120_000 });
  return { ...state, screenshot, image: await imageStats(screenshot) };
}

async function inspectViewport(browser, name, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?autostart=keyboard`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  try {
    await page.waitForFunction(() => window.__corridor617?.handTracking?.hand?.loaded, null, { timeout: 180_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const app = window.__corridor617;
      return {
        readyState: document.readyState,
        bodyText: document.body?.innerText?.slice(0, 600) ?? "",
        app: Boolean(app),
        started: app?.started ?? null,
        experience: Boolean(app?.experience),
        handTracking: Boolean(app?.handTracking),
        handLoaded: app?.handTracking?.hand?.loaded ?? null,
        handFallback: app?.handTracking?.hand?.fallback ?? null,
        handError: String(app?.handTracking?.hand?.error?.message ?? ""),
        sceneError: String(app?.ui?.elements?.sceneError?.textContent ?? ""),
      };
    });
    throw new Error(`${name} startup timeout: ${JSON.stringify({ diagnostic, errors, cause: error.message })}`);
  }
  await page.waitForTimeout(1_000);
  await page.evaluate(() => {
    const app = window.__corridor617;
    if (app.frame != null) cancelAnimationFrame(app.frame);
    app.frame = null;
    if (app.rightHandFlashlight?.root) app.rightHandFlashlight.root.visible = false;
  });

  const dorsumBasis = { right: [-1, 0, 0], up: [0, -1, 0], forward: [0, 0, 1] };
  const palmBasis = { right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, -1] };
  const shortPoints = translateLandmarks(OPEN_POINTS, 0.12, 0.86);
  const longPoints = translateLandmarks(OPEN_POINTS, 0.82, 0.25);
  const palmPoints = translateLandmarks(OPEN_POINTS, 0.72, 0.35);
  const shortArm = await capturePose(page, `${name}-short`, [0.12, 0.86, 0], dorsumBasis, shortPoints);
  const longArm = await capturePose(page, `${name}-long`, [0.82, 0.25, 0], dorsumBasis, longPoints);
  const palm = await capturePose(page, `${name}-palm`, [0.72, 0.35, 0], palmBasis, palmPoints);

  const lifecycle = await page.evaluate(({ points, basis }) => {
    const app = window.__corridor617;
    const director = app.handTracking;
    const wrist = points[0];
    const worldLandmarks = points.map(([x, y, z]) => [
      (x - wrist[0]) * 0.38,
      (y - wrist[1]) * 0.38,
      (z - wrist[2]) * 0.38,
    ]);
    let accepted = 0;
    let continuouslyVisible = true;
    for (let seq = 1; seq <= 120; seq += 1) {
      const frame = {
        version: 1,
        seq,
        capturedAt: performance.now(),
        modeEpoch: 71,
        state: "tracked",
        handedness: "left",
        inputMirrored: true,
        center: [0.52 + Math.sin(seq / 12) * 0.08, 0.55, 0],
        landmarks: points,
        worldLandmarks,
        wrist: basis,
        relativeScale: 1,
        trackingConfidence: 0.42,
        handConfidence: 0.42,
        reachEligible: false,
        reachProgress: 0,
      };
      accepted += director.acceptFrame(frame) ? 1 : 0;
      director.update(1 / 15);
      continuouslyVisible = continuouslyVisible && director.hand.root.visible;
    }
    const lostAccepted = director.acceptFrame({
      version: 1,
      seq: 121,
      capturedAt: performance.now(),
      modeEpoch: 71,
      state: "lost",
      reason: "no-hand",
    });
    director.update(1 / 15);
    return {
      accepted,
      continuouslyVisible,
      lostAccepted,
      visibleAfterFirstLostFrame: director.hand.root.visible,
      opacityAfterFirstLostFrame: director.hand.opacity,
    };
  }, { points: OPEN_POINTS, basis: dorsumBasis });

  await page.close();
  if (errors.length) throw new Error(`${name} browser errors: ${JSON.stringify(errors)}`);
  if (!shortArm.visible || !longArm.visible || !palm.visible) throw new Error(`${name} hand was not visible`);
  if (longArm.armLength <= shortArm.armLength + 0.05) throw new Error(`${name} arm did not lengthen`);
  if (Math.abs(longArm.palmWidth - shortArm.palmWidth) > 0.01) throw new Error(`${name} palm stretched with arm`);
  const orientationDot = longArm.forward.reduce((sum, value, index) => sum + value * palm.forward[index], 0);
  if (orientationDot > -0.9) throw new Error(`${name} palm/dorsum did not flip: ${orientationDot}`);
  if (lifecycle.accepted !== 120 || !lifecycle.continuouslyVisible) throw new Error(`${name} continuity failed`);
  if (!lifecycle.lostAccepted || lifecycle.visibleAfterFirstLostFrame || lifecycle.opacityAfterFirstLostFrame !== 0) {
    throw new Error(`${name} immediate loss failed`);
  }
  for (const capture of [shortArm, longArm, palm]) {
    if (capture.image.visibleRatio < 0.12 || capture.image.quantizedColors < 12) {
      throw new Error(`${name} blank canvas: ${JSON.stringify(capture.image)}`);
    }
  }
  return { shortArm, longArm, palm, orientationDot, lifecycle };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
try {
  const desktop = await inspectViewport(browser, "left-rewrite-desktop", { width: 1440, height: 900 });
  const mobile = await inspectViewport(browser, "left-rewrite-mobile", { width: 844, height: 390 });
  const report = { origin, desktop, mobile };
  fs.writeFileSync(path.join(output, "left-hand-rewrite-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
