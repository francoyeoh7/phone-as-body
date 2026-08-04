# Rear-Camera Hand Tracking and L-Corridor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional rear-camera MediaPipe hand tracking that drives a rigged first-person hand and sustained grab/brace tasks, then expand Corridor 617 into a wider L-shaped environment.

**Architecture:** The existing rear-camera detector remains the only camera owner. A task-scoped MediaPipe worker derives and transmits landmark frames over a separate unreliable WebRTC channel with Socket.IO fallback; desktop-only filtering, action hysteresis, GLB hand rendering, and scene directors consume those frames without changing the stable gyro/touch input packet. A data-driven corridor layout supplies both Three.js geometry and Rapier colliders, including a rotated endpoint door.

**Tech Stack:** Vite 6, Three.js 0.178, Rapier 0.19, Socket.IO 4.8, WebRTC DataChannel, MediaPipe Tasks Vision Hand Landmarker, Vitest 3.2, Playwright Core with installed Chrome.

## Global Constraints

- Do not modify `src/controller/MotionController.js`, `src/shared/orientation.js`, or the current gyro math.
- Do not change current phone movement, flashlight, fullscreen touch, click, drag, or virtual-joystick semantics.
- Use exactly one rear camera; never request or accept the front camera.
- Do not send raw camera pixels or video to the desktop.
- Camera denial, unsupported APIs, tracker/model failure, and asset-load failure must preserve legacy gameplay.
- Hand actions require confidence, continuous duration, and hysteresis; no single-frame success or failure.
- The door defense requires a continuously held brace for four seconds; instability pauses and then decays progress.
- The production package must contain the MediaPipe runtime/model and redistributable rigged hand assets.
- The existing public HTTPS preview must remain playable during implementation and be updated only after verification.

---

## File Structure

New focused modules:

- `src/shared/hand-pose.js`: landmark validation and pose/feature extraction.
- `src/shared/hand-task-state.js`: calibration and action hysteresis state machine.
- `src/controller/hand-tracking.worker.js`: MediaPipe worker initialization and inference.
- `src/controller/MediaPipeHandTracker.js`: worker/main-thread lifecycle, sampling, task mode, and lost/unavailable frames.
- `src/desktop/HandPoseStream.js`: receive-time ordering, smoothing, freeze, fade, and handedness stability.
- `src/desktop/FirstPersonHand.js`: GLB loading and WebXR-joint bone transforms.
- `src/desktop/HandTrackingDirector.js`: active task ownership and render/action coordination.
- `src/desktop/CorridorLayout.js`: L-shaped render/collider/door layout data.
- `public/assets/mediapipe/`: local Hand Landmarker model and WASM runtime.
- `public/assets/hands/`: MIT-licensed left/right generic-hand GLBs and license.

Existing integration files:

- `src/shared/protocol.js`, `server/session-registry.js`, `server/index.js`: validate and relay hand frames.
- `src/controller/CameraMotionDetector.js`, `ControllerSocket.js`, `ControllerApp.js`: share the rear video and manage optional tracking.
- `src/desktop/PhoneSession.js`, `DesktopApp.js`: receive hand frames and own desktop hand services.
- `src/desktop/DoorDefenseDirector.js`, `FoundPhoneDirector.js`: interpret contextual hand actions while retaining presence fallback.
- `src/desktop/ExitDoor.js`, `create-scene.js`, `ShadowQuestDirector.js`: transformed door and L-layout integration.

## Task 1: Pin Dependencies and Redistributable Runtime Assets

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `public/assets/mediapipe/hand_landmarker.task`
- Create: `public/assets/mediapipe/wasm/vision_wasm_internal.js`
- Create: `public/assets/mediapipe/wasm/vision_wasm_internal.wasm`
- Create: `public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.js`
- Create: `public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm`
- Create: `public/assets/hands/left.glb`
- Create: `public/assets/hands/right.glb`
- Create: `public/assets/hands/LICENSE.md`
- Create: `public/assets/hands/SOURCE.md`
- Create: `tests/asset-manifest.test.js`

**Interfaces:**
- Produces: stable public URLs `/assets/mediapipe/hand_landmarker.task`, `/assets/mediapipe/wasm`, `/assets/hands/left.glb`, and `/assets/hands/right.glb`.
- Consumes: official MediaPipe model/runtime and WebXR Input Profiles generic-hand assets.

- [ ] **Step 1: Write the failing asset manifest test**

```js
import { describe, expect, it } from "vitest";
import { access, readFile, stat } from "node:fs/promises";

const required = [
  "public/assets/mediapipe/hand_landmarker.task",
  "public/assets/mediapipe/wasm/vision_wasm_internal.js",
  "public/assets/mediapipe/wasm/vision_wasm_internal.wasm",
  "public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "public/assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  "public/assets/hands/left.glb",
  "public/assets/hands/right.glb",
  "public/assets/hands/LICENSE.md",
  "public/assets/hands/SOURCE.md",
];

describe("tracked hand assets", () => {
  it("ships all local runtime and licensed model files", async () => {
    await Promise.all(required.map((path) => access(path)));
    const model = await stat(required[0]);
    const left = await stat(required[5]);
    const right = await stat(required[6]);
    expect(model.size).toBeGreaterThan(1_000_000);
    expect(left.size).toBeGreaterThan(10_000);
    expect(right.size).toBeGreaterThan(10_000);
    expect(await readFile(required[7], "utf8")).toContain("MIT License");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-file failure**

Run: `npm test -- tests/asset-manifest.test.js`

Expected: FAIL with `ENOENT` for `public/assets/mediapipe/hand_landmarker.task`.

- [ ] **Step 3: Install and copy the pinned local runtime assets**

Run as one approved network batch:

```powershell
npm install @mediapipe/tasks-vision@1.0.1
New-Item -ItemType Directory -Force public/assets/mediapipe/wasm,public/assets/hands | Out-Null
Copy-Item node_modules/@mediapipe/tasks-vision/wasm/* public/assets/mediapipe/wasm/
Invoke-WebRequest -UseBasicParsing "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" -OutFile "public/assets/mediapipe/hand_landmarker.task"
Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/immersive-web/webxr-input-profiles/main/packages/assets/profiles/generic-hand/left.glb" -OutFile "public/assets/hands/left.glb"
Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/immersive-web/webxr-input-profiles/main/packages/assets/profiles/generic-hand/right.glb" -OutFile "public/assets/hands/right.glb"
Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/immersive-web/webxr-input-profiles/main/packages/assets/LICENSE.md" -OutFile "public/assets/hands/LICENSE.md"
```

Create `SOURCE.md` with these exact source URLs and state that the generic-hand assets are redistributed under the adjacent MIT license.

- [ ] **Step 4: Run the manifest test and production build**

Run: `npm test -- tests/asset-manifest.test.js && npm run build`

Expected: the test passes; `dist/assets/mediapipe` and `dist/assets/hands` contain the same files.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json public/assets tests/asset-manifest.test.js
git commit -m "build: ship local hand tracking assets"
```

## Task 2: Derive Stable Hand Pose Features

**Files:**
- Create: `src/shared/hand-pose.js`
- Create: `tests/hand-pose.test.js`

**Interfaces:**
- Produces: `HAND_LANDMARK_COUNT`, `normalizeHandedness(value)`, `deriveHandFeatures(sample, previous, calibration)`, `createTrackedHandFrame(input)`, and `createHandStatusFrame(input)`.
- Consumes: MediaPipe normalized landmarks, world landmarks, handedness category, capture timestamp, and the previous derived pose.

- [ ] **Step 1: Write failing tests for open, fist, orientation, continuity, and malformed data**

```js
import { describe, expect, it } from "vitest";
import { createTrackedHandFrame, deriveHandFeatures } from "../src/shared/hand-pose.js";
import { openHand, curledHand } from "./fixtures/hand-landmarks.js";

describe("hand pose features", () => {
  it("separates a naturally open hand from a fist", () => {
    const open = deriveHandFeatures(openHand());
    const fist = deriveHandFeatures(curledHand());
    expect(open.openness).toBeGreaterThan(0.72);
    expect(open.grabStrength).toBeLessThan(0.42);
    expect(fist.openness).toBeLessThan(0.38);
    expect(fist.grabStrength).toBeGreaterThan(0.68);
  });

  it("returns a finite handedness-corrected palm basis", () => {
    const pose = deriveHandFeatures(openHand({ handedness: "Left" }));
    for (const axis of [pose.wrist.right, pose.wrist.up, pose.wrist.forward]) {
      expect(axis).toHaveLength(3);
      expect(axis.every(Number.isFinite)).toBe(true);
    }
  });

  it("rejects missing, degenerate, and non-finite landmarks", () => {
    expect(() => deriveHandFeatures({ landmarks: [] })).toThrow(/21/);
    expect(() => deriveHandFeatures(openHand({ x: Number.NaN }))).toThrow(/finite/);
    expect(() => deriveHandFeatures(openHand({ degenerate: true }))).toThrow(/palm/);
  });

  it("creates a task-scoped frame with no image or video fields", () => {
    const frame = createTrackedHandFrame({ seq: 3, capturedAt: 120, modeEpoch: 2, sample: openHand() });
    expect(frame.modeEpoch).toBe(2);
    expect(frame.landmarks).toHaveLength(21);
    expect(frame.worldLandmarks).toHaveLength(21);
    expect(frame.video).toBeUndefined();
    expect(frame.image).toBeUndefined();
  });
});
```

Create `tests/fixtures/hand-landmarks.js` with deterministic 21-point open and curled hands using the MediaPipe landmark order.

- [ ] **Step 2: Run the tests and confirm import failure**

Run: `npm test -- tests/hand-pose.test.js`

Expected: FAIL because `src/shared/hand-pose.js` does not exist.

- [ ] **Step 3: Implement bounded vector math and derived features**

Implement these exact exports:

```js
export const HAND_LANDMARK_COUNT = 21;

export function normalizeHandedness(value) {
  const label = String(value ?? "").toLowerCase();
  return label === "left" || label === "right" ? label : null;
}

export function deriveHandFeatures(sample, previous = null, calibration = null) {
  // Validate exactly 21 finite normalized and world landmarks; compute center,
  // palm basis, five joint-angle curls, openness, grabStrength, palmFacing,
  // relativeScale, velocity, and a 0..1 continuity confidence.
  // Throw RangeError for malformed or degenerate geometry.
}

export function createTrackedHandFrame({ seq, capturedAt, modeEpoch, sample, previous, calibration }) {
  const pose = deriveHandFeatures(sample, previous, calibration);
  return { version: 1, seq, capturedAt, modeEpoch, state: "tracked", ...pose };
}

export function createHandStatusFrame({ seq, capturedAt, modeEpoch, state, reason }) {
  if (!['lost', 'unavailable'].includes(state)) throw new RangeError('invalid hand state');
  return { version: 1, seq, capturedAt, modeEpoch, state, reason: String(reason ?? 'unknown').slice(0, 48) };
}
```

Use clamped dot products for angles, reject a palm basis whose cross-product length is below `1e-6`, and compute velocity from sender-local timestamp deltas only.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/hand-pose.test.js`

Expected: all hand-pose tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/hand-pose.js tests/hand-pose.test.js tests/fixtures/hand-landmarks.js
git commit -m "feat: derive stable hand pose features"
```

## Task 3: Add Strict Hand Frame Transport

**Files:**
- Modify: `src/shared/protocol.js`
- Modify: `server/session-registry.js`
- Modify: `server/index.js`
- Modify: `src/controller/ControllerSocket.js`
- Modify: `src/desktop/PhoneSession.js`
- Modify: `tests/protocol.test.js`
- Modify: `tests/session-registry.test.js`

**Interfaces:**
- Produces: `EVENTS.controllerHand === "controller:hand"`, `isHandFrame(value)`, `ControllerSocket.sendHandFrame(frame)`, `PhoneSession.acceptHandFrame(frame)`, and `PhoneSession` `hand` events.
- Consumes: Task 2 frame envelopes.

- [ ] **Step 1: Add failing protocol and channel tests**

Add assertions that a tracked frame with exactly 21 finite points passes; 20 points, invalid confidence, unknown state, non-increasing sequence, a `video` key, and serialized payloads over 12 KiB fail. Assert that a hand DataChannel is created with:

```js
{ ordered: false, maxRetransmits: 0 }
```

Assert that `PhoneSession` dispatches only the newest valid hand frame and uses local `performance.now()` as `receivedAt`.

- [ ] **Step 2: Run RED tests**

Run: `npm test -- tests/protocol.test.js tests/session-registry.test.js`

Expected: FAIL because `controllerHand`, `isHandFrame`, and `acceptHandFrame` are absent.

- [ ] **Step 3: Implement the validator and room-owned relay**

Add `controllerHand` to `EVENTS`. Implement `isHandFrame` with these exact rules:

- `version === 1`, integer `seq >= 0`, integer `modeEpoch >= 0`, finite `capturedAt >= 0`;
- `state` is `tracked`, `lost`, or `unavailable`;
- tracked frames contain 21 three-float normalized landmarks, 21 three-float world landmarks, handedness `left|right`, all scalar scores in `[0,1]`, five curls, and a finite orthogonal wrist basis;
- lost/unavailable frames contain no landmark arrays;
- reject raw-media keys `image`, `video`, `pixels`, `frame`, `blob`, and `dataUrl`;
- reject `JSON.stringify(value).length > 12_288`.

Add `acceptHand(code, controllerId, frame)` to the registry with per-room `handSeq`; reset it on controller attach/disconnect. Relay only accepted frames in `server/index.js`.

- [ ] **Step 4: Implement the independent unreliable WebRTC channel**

`PhoneSession.startRtcOffer()` creates both `controls` and `hand` channels. `ControllerSocket.attachDataChannel(channel)` selects by `channel.label`. `sendHandFrame(frame)` sends `{ type: "hand", payload: frame }` through an open hand channel only while `bufferedAmount <= 32_768`; above that threshold it drops the new hand frame instead of affecting the stable controls channel. If the hand channel is unavailable, it emits `EVENTS.controllerHand`. `PhoneSession.acceptHandFrame()` validates and rejects non-increasing sequence numbers before dispatching:

```js
this.dispatchEvent(new CustomEvent("hand", {
  detail: { ...frame, receivedAt: performance.now() },
}));
```

Never queue or accumulate hand frames.

- [ ] **Step 5: Run focused and existing transport tests**

Run: `npm test -- tests/protocol.test.js tests/session-registry.test.js`

Expected: all tests pass, including the unchanged control input/WebRTC assertions.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/protocol.js server/session-registry.js server/index.js src/controller/ControllerSocket.js src/desktop/PhoneSession.js tests/protocol.test.js tests/session-registry.test.js
git commit -m "feat: relay bounded hand landmark frames"
```

## Task 4: Run MediaPipe Against the Existing Rear Camera

**Files:**
- Create: `src/controller/hand-tracking.worker.js`
- Create: `src/controller/MediaPipeHandTracker.js`
- Modify: `src/controller/CameraMotionDetector.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Create: `tests/media-pipe-hand-tracker.test.js`
- Modify: `tests/camera-motion-detector.test.js`
- Modify: `tests/controller-app.test.js`

**Interfaces:**
- Produces: `CameraMotionDetector.getVideoElement()`, `MediaPipeHandTracker.setTask(task)`, `suspend()`, `resume()`, and `destroy()`.
- Consumes: Task 1 local runtime URLs, Task 2 frame constructors, Task 3 `sendHandFrame`.

- [ ] **Step 1: Write lifecycle-first failing tests**

Cover these exact behaviors:

- tracker never calls `getUserMedia`;
- tracker reads the video returned by `getVideo`;
- `setTask({ active: true })` initializes once and samples no faster than 15 Hz;
- a busy inference drops the next capture rather than queuing;
- `numHands` is 2 internally, running mode is `VIDEO`, and only one continuity-selected hand is emitted;
- a valid result emits one tracked frame;
- no result emits one lost state after 250 ms and a 500 ms heartbeat thereafter;
- initialization failure emits one unavailable state and stops retrying for that task;
- suspend/background/destroy cancel sampling and close transferred `ImageBitmap` objects;
- resume does not request a second camera;
- camera stream settings that identify a front camera still fail before tracking begins.

- [ ] **Step 2: Run RED tests**

Run: `npm test -- tests/media-pipe-hand-tracker.test.js tests/camera-motion-detector.test.js tests/controller-app.test.js`

Expected: FAIL because the tracker and video accessor do not exist.

- [ ] **Step 3: Implement the worker**

The worker imports `FilesetResolver` and `HandLandmarker`, initializes with:

```js
{
  baseOptions: {
    modelAssetPath: "/assets/mediapipe/hand_landmarker.task",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numHands: 2,
  minHandDetectionConfidence: 0.62,
  minHandPresenceConfidence: 0.58,
  minTrackingConfidence: 0.58,
}
```

It receives `{ type: "detect", bitmap, capturedAt }`, calls `detectForVideo(bitmap, capturedAt)`, posts serializable landmarks/worldLandmarks/handedness, and closes the bitmap in `finally`. If GPU initialization fails, retry once with no delegate; if both fail, post a single `unavailable` result.

- [ ] **Step 4: Implement the task-scoped tracker client**

Use a module worker when `Worker` and `createImageBitmap` are available. Use a rate-limited main-thread Hand Landmarker only when the worker primitives are absent but the MediaPipe module can load. Set `sampleIntervalMs = 1000 / 15`, keep an `inferencePending` guard, select one candidate using handedness plus nearest prior center, retain the prior hand across brief label flips, and derive Task 2 frames. Increment `modeEpoch` on every task change and include it in every result so late worker/network frames are ignored. `setTask({ active: false })` stops sampling but leaves the camera stream under `CameraMotionDetector` ownership.

- [ ] **Step 5: Integrate without changing stable input code**

Add `getVideoElement()` to `CameraMotionDetector`. Construct the tracker in `ControllerApp.bindControls()` with `getVideo: () => this.cameraMotion.getVideoElement()` and `onFrame: frame => this.socket?.sendHandFrame(frame)`. Handle only the new desktop event:

```js
if (event.type === "hand-task") {
  this.handTracker?.setTask(event);
  this.playSurface.dataset.hand = event.active ? "starting" : "off";
  return;
}
```

Route tracker state to `data-hand` (`starting`, `calibrating`, `tracked`, `lost`, `fallback`) for a small non-interactive status ring. Do not add a button or replace the play surface. Suspend/resume/destroy the tracker alongside, but independently from, camera motion.

- [ ] **Step 6: Run focused tests and existing input regression tests**

Run: `npm test -- tests/media-pipe-hand-tracker.test.js tests/camera-motion-detector.test.js tests/controller-app.test.js tests/orientation.test.js tests/motion-controller.test.js tests/virtual-joystick.test.js tests/joystick.test.js`

Expected: all tests pass with no modifications to orientation or joystick production files.

- [ ] **Step 7: Commit**

```powershell
git add src/controller src/shared tests/media-pipe-hand-tracker.test.js tests/camera-motion-detector.test.js tests/controller-app.test.js
git commit -m "feat: track one hand from the rear camera"
```

## Task 5: Filter Poses and Confirm Actions with Hysteresis

**Files:**
- Create: `src/shared/hand-task-state.js`
- Create: `src/desktop/HandPoseStream.js`
- Create: `tests/hand-task-state.test.js`
- Create: `tests/hand-pose-stream.test.js`

**Interfaces:**
- Produces: `scoreHandAction(action, pose)`, `HandTaskStateMachine`, and `HandPoseStream`.
- `HandTaskStateMachine.begin({ context, requiredAction, now })`, `.update(pose, now)`, `.snapshot()`, `.reset()`.
- `HandPoseStream.accept(frame)`, `.sample(now)`, `.reset()`.

- [ ] **Step 1: Write failing state-machine tests**

Test `untracked -> tracking -> candidate -> confirmed -> held -> success`, plus:

- open-palm calibration requires 900 continuous ms;
- candidate requires 220 continuous ms;
- confidence below 0.62 for one frame does not fail;
- held action remains held down to action score 0.55;
- 250 ms loss enters `unstable`, not `failed`;
- release requires 180 continuous ms;
- grab, fist, open, release, and brace scores are distinct;
- `reset()` removes task ownership and stale calibration.

- [ ] **Step 2: Write failing pose-stream tests**

Assert monotonic sequence rejection, exponential position/curl smoothing, quaternion slerp, 250 ms frozen pose, 350 ms fade, non-teleporting reacquisition, 350 ms network silence loss, and 500 ms handedness-switch evidence.

- [ ] **Step 3: Run RED tests**

Run: `npm test -- tests/hand-task-state.test.js tests/hand-pose-stream.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement exact default thresholds**

```js
export const HAND_TASK_DEFAULTS = Object.freeze({
  trackingEnter: 0.62,
  trackingExit: 0.48,
  actionEnter: 0.72,
  actionExit: 0.55,
  calibrationMs: 900,
  candidateMs: 220,
  releaseMs: 180,
  lossGraceMs: 250,
});
```

`scoreHandAction` maps `open` to openness, `fist` to mean curl, `grab` to grab strength, `release` to `1 - grabStrength`, and `brace` to the minimum of openness, palm-facing stability, and inverse velocity. Every transition records `enteredAt`; only continuous time above/below the corresponding threshold advances it.

- [ ] **Step 5: Implement receive-time smoothing**

Use local `receivedAt` for age. Apply `alpha = 1 - Math.exp(-deltaMs / 85)` to positions/curls, quaternion slerp with the same alpha, freeze the last stable pose for 250 ms, then linearly fade its opacity over 350 ms. Never subtract phone `capturedAt` from desktop `performance.now()`.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/hand-task-state.test.js tests/hand-pose-stream.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/shared/hand-task-state.js src/desktop/HandPoseStream.js tests/hand-task-state.test.js tests/hand-pose-stream.test.js
git commit -m "feat: stabilize continuous hand actions"
```

## Task 6: Drive the Rigged First-Person Hand

**Files:**
- Create: `src/desktop/FirstPersonHand.js`
- Create: `tests/first-person-hand.test.js`

**Interfaces:**
- Produces: `expandMediaPipeJoints(pose)`, `jointQuaternion(joint, child, palmBasis)`, and class `FirstPersonHand` with `load()`, `setContext(context)`, `applyPose(pose, delta)`, `setVisible(active)`, `setFallbackPose(name)`, and `destroy()`.
- Consumes: Task 1 GLBs and Task 5 smoothed poses.

- [ ] **Step 1: Write failing joint mapping and lifecycle tests**

Assert that 21 MediaPipe landmarks expand to all 25 WebXR joint names, non-thumb metacarpals interpolate between wrist and MCP, every joint transform is finite/normalized, center motion changes root position in the same direction, relative scale changes depth without flipping, finger curl changes phalanx quaternions, handedness switches models only after the pose stream stabilizes it, loss fades without a positional jump, and load failure keeps the hand hidden.

- [ ] **Step 2: Run RED tests**

Run: `npm test -- tests/first-person-hand.test.js`

Expected: FAIL because `FirstPersonHand.js` is missing.

- [ ] **Step 3: Implement local GLB loading and bone discovery**

Use `GLTFLoader` and load both `/assets/hands/left.glb` and `/assets/hands/right.glb`. Require these joint names:

```js
const WEBXR_JOINTS = [
  "wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
];
```

Clone loaded scenes with `SkeletonUtils.clone`, set skinned meshes `frustumCulled = false`, enable shadows, and make materials transparent for confidence fading.

- [ ] **Step 4: Implement camera-local continuous driving**

Attach one render root to the camera. Map calibrated center into a bounded `0.62 m x 0.42 m` camera-local window at base depth `-0.62 m`; map relative scale into `-0.42 m` to `-0.86 m`. Expand and drive all 25 bone positions/quaternions. Use `setContext("door-defense")` to bias the hand toward the door center while preserving live relative motion; use `found-phone` without the door bias.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/first-person-hand.test.js`

Expected: all tests pass, including load-failure invisibility.

- [ ] **Step 6: Commit**

```powershell
git add src/desktop/FirstPersonHand.js tests/first-person-hand.test.js
git commit -m "feat: drive a rigged first-person hand"
```

## Task 7: Integrate Hand Tasks, Phone Grab, and Sustained Door Defense

**Files:**
- Create: `src/desktop/HandTrackingDirector.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/FoundPhoneDirector.js`
- Modify: `src/desktop/DoorDefenseDirector.js`
- Modify: `src/desktop/ExitDoor.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Create: `tests/hand-tracking-director.test.js`
- Modify: `tests/desktop-app.test.js`
- Modify: `tests/found-phone-director.test.js`
- Modify: `tests/door-defense-director.test.js`

**Interfaces:**
- Produces: `HandTrackingDirector.beginTask({ context, requiredAction })`, `.endTask(context)`, `.acceptFrame(frame)`, `.update(delta)`, `.snapshot(context)`, `.usesFallback(context)`, `.destroy()`.
- Consumes: Task 3 `PhoneSession` hand events, Task 5 stream/state machine, Task 6 hand renderer.

- [ ] **Step 1: Write failing coordinator tests**

Assert task ownership, controller `hand-task` start/stop events, calibration, tracked/fallback modes, no-frame 1.5-second fallback, lost-frame freeze/fade, context isolation, disconnect cleanup, and exactly-once task end.

- [ ] **Step 2: Write failing found-phone behavior tests**

Assert that a confirmed grab picks up the phone once, held frames do not retrigger, confirmed release hides the phone UI and restores exploration once, unstable frames do not release, tracker unavailable preserves legacy `gesture-presence`, and timeout/abort always calls `endCinematic()` and hides held/UI rigs.

- [ ] **Step 3: Write failing door behavior tests**

Assert:

- a confirmed brace starts haptics and progress;
- exactly four held seconds succeed;
- one low-confidence frame does not fail;
- unstable first pauses, then decays at `0.65 progress-seconds / second`;
- recovery resumes from retained progress;
- zero progress restarts the action attempt without freezing the cinematic;
- haptics stop while unstable;
- unavailable tracking uses the old presence path and Space fallback;
- success and abort both stop hand mode, haptics, progress UI, and restore pose/control.

- [ ] **Step 4: Run RED tests**

Run: `npm test -- tests/hand-tracking-director.test.js tests/found-phone-director.test.js tests/door-defense-director.test.js tests/desktop-app.test.js`

Expected: FAIL on missing coordinator and continuous-hand behavior.

- [ ] **Step 5: Implement the coordinator and DesktopApp ownership**

Create `FirstPersonHand` and `HandTrackingDirector` after the scene loads. Subscribe `PhoneSession` to `hand` in `mount`, route frames to `acceptFrame`, call `handTracking.update(delta)` before task directors each tick, pass the coordinator into both task directors, and remove the listener/destroy both services on cleanup. Do not alter `PlayerController.applyPhoneViewDelta()`.

- [ ] **Step 6: Implement grab/release semantics with fallback**

The found-phone interaction starts a `grab` task and locks cinematic/target ownership. In tracked mode, only `held` performs pickup; confirmed `release` performs release. In fallback mode, retain current presence behavior and three-second recovery. Every exit path sends `{ type: "hand-task", active: false, context: "found-phone" }`, hides the phone UI, clears held geometry, and ends cinematic exactly once.

- [ ] **Step 7: Implement continuous brace progress**

Start a `brace` task after the door intro. During tracked mode, calibration and action snapshots own the phase. Increase `holdElapsed` only while `phase === "held"`; pause during the 250 ms grace; then subtract `delta * 0.65` while unstable. Use `progress = holdElapsed / 4`. Retain `handlePresence()` and `setFallbackHolding()` only when `usesFallback("door-defense")` is true. The legacy primitive `braceRig` is visible only when `FirstPersonHand` reports asset-load failure.

- [ ] **Step 8: Add immersive status feedback**

Extend the existing door progress UI with `calibrating`, `awaiting`, `bracing`, and `unstable` data states. Use the same progress bar; do not add instructional cards or controls. Make the unstable state visibly pulse and pause/retreat so the player can tell whether the hold remains valid.

- [ ] **Step 9: Run focused and gameplay regression tests**

Run: `npm test -- tests/hand-tracking-director.test.js tests/found-phone-director.test.js tests/door-defense-director.test.js tests/desktop-app.test.js tests/player-controller.test.js tests/camera-motion-detector.test.js`

Expected: all tests pass; legacy interaction and player-control tests remain unchanged.

- [ ] **Step 10: Commit**

```powershell
git add src/desktop tests/hand-tracking-director.test.js tests/found-phone-director.test.js tests/door-defense-director.test.js tests/desktop-app.test.js
git commit -m "feat: sustain hand-driven corridor tasks"
```

## Task 8: Build the Wider L-Shaped Corridor and Rotated Endpoint

**Files:**
- Create: `src/desktop/CorridorLayout.js`
- Modify: `src/desktop/create-scene.js`
- Modify: `src/desktop/ExitDoor.js`
- Modify: `src/desktop/DoorDefenseDirector.js`
- Modify: `src/desktop/ShadowQuestDirector.js`
- Create: `tests/corridor-layout.test.js`
- Modify: `tests/scene-props.test.js`
- Modify: `tests/door-defense-director.test.js`
- Modify: `tests/shadow-quest.test.js`

**Interfaces:**
- Produces: `createCorridorLayout()` returning `floors`, `ceilings`, `walls`, `colliders`, `lights`, `door`, and `anchors`.
- `createExitDoor({ position, rotationY })` returns `inwardNormal`, transformed `triggerPosition`, and a rotated collider.

- [ ] **Step 1: Write failing layout topology tests**

```js
import { describe, expect, it } from "vitest";
import { createCorridorLayout } from "../src/desktop/CorridorLayout.js";

describe("L corridor layout", () => {
  it("forms a wider connected ninety-degree route", () => {
    const layout = createCorridorLayout();
    expect(layout.width).toBe(6.4);
    expect(layout.main.bounds).toEqual({ minX: -3.2, maxX: 3.2, minZ: -32.8, maxZ: 3.2 });
    expect(layout.wing.bounds).toEqual({ minX: 3.2, maxX: 23.2, minZ: -32.8, maxZ: -26.4 });
    expect(layout.turnAngle).toBe(90);
    expect(layout.door.position).toEqual([23, 0, -29.6]);
    expect(layout.door.rotationY).toBe(-Math.PI / 2);
  });

  it("leaves the inside corner open and closes the outside perimeter", () => {
    const layout = createCorridorLayout();
    expect(layout.walls.some((wall) => wall.id === "blocked-turn-opening")).toBe(false);
    expect(layout.walls.map((wall) => wall.id)).toEqual(expect.arrayContaining([
      "main-left", "main-right-before-turn", "wing-north", "wing-south", "wing-end",
    ]));
  });
});
```

- [ ] **Step 2: Extend ExitDoor tests for arbitrary yaw**

Construct a door at `[23, 0, -29.6]`, `rotationY = -Math.PI / 2`; assert its inward normal is approximately `[-1, 0, 0]`, trigger is approximately `[20.82, 1.05, -29.6]`, and the fixed-body quaternion rotates its thin collider into the YZ plane.

- [ ] **Step 3: Run RED tests**

Run: `npm test -- tests/corridor-layout.test.js tests/scene-props.test.js tests/door-defense-director.test.js tests/shadow-quest.test.js`

Expected: FAIL because the layout module and transformed door API do not exist.

- [ ] **Step 4: Implement the exact L layout**

Use width `6.4`, height `3.6`, main bounds `x=-3.2..3.2, z=3.2..-32.8`, and wing bounds `x=3.2..23.2, z=-26.4..-32.8`. Generate floor/ceiling and matching fixed cuboids from the same segment data. Stop the main right wall at `z=-26.4`, keep the overlap square open, and close the north/south/east perimeter. Extend non-shadow-casting fixture meshes and reuse the current light materials; add at most three point lights to the wing.

- [ ] **Step 5: Transform props and cinematics from anchors**

Parameterize observation-window wall X, panel wall X, washbasin collider, decoration seams, and ShadowQuest camera anchors from `layout.anchors`. Move the exit door to the wing endpoint. In `DoorDefenseDirector`, derive brace position from `triggerPosition` and `inwardNormal` instead of subtracting Z. Verify the saved-pose return still restores body/camera yaw/pitch.

- [ ] **Step 6: Run focused tests and full movement regressions**

Run: `npm test -- tests/corridor-layout.test.js tests/scene-props.test.js tests/door-defense-director.test.js tests/shadow-quest.test.js tests/player-controller.test.js tests/movement.test.js`

Expected: all tests pass and the 90-degree turn has no collider across its opening.

- [ ] **Step 7: Commit**

```powershell
git add src/desktop/CorridorLayout.js src/desktop/create-scene.js src/desktop/ExitDoor.js src/desktop/DoorDefenseDirector.js src/desktop/ShadowQuestDirector.js tests/corridor-layout.test.js tests/scene-props.test.js tests/door-defense-director.test.js tests/shadow-quest.test.js
git commit -m "feat: expand exploration into an L corridor"
```

## Task 9: Verify, Visual-Test, Publish, and Package

**Files:**
- Create: `scripts/visual-smoke.mjs`
- Create: `tests/fixtures/mock-hand-frame.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: `npm run test:visual`, updated public `dist`, target branch, and a compact GitHub Release archive.
- Consumes: all prior tasks.

- [ ] **Step 1: Add a deterministic debug-only mock hand path**

In development only, `?mockHand=open|grab|brace` feeds the fixture through `PhoneSession`/`HandTrackingDirector`; production ignores the parameter. This makes rendering testable without weakening production validation.

- [ ] **Step 2: Add Playwright desktop/mobile visual smoke checks**

Install `playwright-core` without downloading browsers. `scripts/visual-smoke.mjs` launches installed Chrome, opens desktop at `1440x900` and controller preview at `390x844`, captures screenshots in `D:/tmp/corridor-617-visual/`, reads `canvas.dataset.debugPixels`, asserts at least two samples are nonblack/nontransparent, and checks bounding boxes for reticle, task progress, hand model, phone UI, and controller status ring do not overlap incoherently.

- [ ] **Step 3: Run all automated verification**

Run:

```powershell
npm test
npm run build
npm run test:visual
git diff --check
```

Expected: all Vitest files pass; Vite build succeeds; both screenshots are nonblank; the hand model and L turn are visible; layout checks report no overlap; `git diff --check` is clean apart from existing line-ending warnings.

- [ ] **Step 4: Perform public HTTPS phone smoke validation**

Update the original worktree by fast-forward, build its `dist`, and keep the current Cloudflare process alive. Verify:

- QR URL returns HTTP 200 over HTTPS;
- iOS/Android requests only the rear camera;
- open hand calibrates in about one second;
- open/fist and grab/release do not chatter;
- hand loss freezes/fades instead of jumping;
- found phone returns to exploration after release;
- door progress advances only during a held brace, pauses/decays on loss, and restores view after success;
- gyro view, joystick, flashlight, tap, drag, sink, and fallback play still work.

- [ ] **Step 5: Record licenses and package size**

`THIRD_PARTY_NOTICES.md` must name MediaPipe Tasks Vision/Hand Landmarker (Apache 2.0) and WebXR Input Profiles generic-hand assets (MIT), with source URLs. Build the release archive without `node_modules`, `.git`, tests, screenshots, logs, or prior `.release` archives. Record uncompressed and ZIP byte sizes and confirm the archive contains the server, package lock, `dist`, model, WASM, and both GLBs.

- [ ] **Step 6: Commit, push once, and create/update the GitHub Release once**

```powershell
git add scripts tests/fixtures/mock-hand-frame.js package.json package-lock.json README.md THIRD_PARTY_NOTICES.md
git commit -m "test: verify cross-device hand tracking"
git push origin HEAD:feature/rear-camera-door-phone
```

Use one final authenticated `gh release` batch only after all checks pass. Attach the compact archive and include the exact launch steps plus the public preview URL.
