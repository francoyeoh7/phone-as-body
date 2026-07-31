# Camera Translation and Double-Twist Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace quaternion camera aiming with camera-observed phone translation and trigger interaction only after a fast opposite-direction double wrist twist.

**Architecture:** The phone tracks sparse visual features locally and converts their robust frame-to-frame motion into normalized view velocity. Device motion is a separate channel that freezes visual tracking during any rotation and feeds a pure double-twist state machine. The server relays normalized input snapshots, while the desktop integrates view velocity into persistent camera yaw and pitch.

**Tech Stack:** JavaScript ES modules, Vite, Vitest, jsfeat sparse optical flow, MediaDevices camera capture, DeviceMotion/DeviceOrientation APIs, Socket.IO, Three.js.

---

## File Map

- Create `src/shared/view-motion.js`: pure normalization, dead-zone, grip alignment, transform summarization, and desktop velocity damping math.
- Create `src/shared/wrist-gesture.js`: pure double-twist detector state machine.
- Create `src/controller/CameraMotionTracker.js`: camera lifecycle, frame sampling, jsfeat feature detection and optical flow.
- Modify `src/controller/MotionController.js`: sensor permissions, angular-motion gating, grip alignment, and coordination of camera and wrist channels.
- Modify `src/controller/ControllerApp.js`: consume view samples, dispatch double-twist interaction, expose tracking state, and manage resume/recenter.
- Modify `src/controller/ControllerSocket.js`: send `viewMotion` snapshots instead of quaternions.
- Modify `src/controller/styles.css`: add a compact tracking state in the existing header without changing the control layout.
- Modify `src/shared/protocol.js`: validate normalized `viewMotion` input.
- Modify `server/session-registry.js`: store and clear `viewMotion` snapshots.
- Modify `src/desktop/PhoneSession.js`: clear stale/disconnected view motion.
- Modify `src/desktop/PlayerController.js`: integrate view velocity into yaw and pitch; remove quaternion tracking from phone input.
- Modify `package.json` and `package-lock.json`: add pinned `jsfeat@0.0.8`.
- Create `tests/view-motion.test.js`, `tests/wrist-gesture.test.js`, and `tests/protocol.test.js`.
- Modify `tests/session-registry.test.js` and `tests/orientation.test.js` to reflect the new input contract.

### Task 1: Migrate the controller input contract

**Files:**
- Create: `tests/protocol.test.js`
- Modify: `src/shared/protocol.js`
- Modify: `src/controller/ControllerSocket.js`
- Modify: `server/session-registry.js`
- Modify: `src/desktop/PhoneSession.js`
- Modify: `tests/session-registry.test.js`

- [ ] **Step 1: Write failing protocol and registry tests**

Add tests that define the new snapshot and reject missing, out-of-range, or non-finite values:

```js
import { describe, expect, it } from "vitest";
import { isControllerInput, isViewMotion } from "../src/shared/protocol.js";

const valid = {
  seq: 1,
  sentAt: 100,
  move: { x: 0, y: 0 },
  viewMotion: { x: 0.25, y: -0.5, confidence: 0.8 },
};

describe("view motion protocol", () => {
  it("accepts normalized view velocity", () => {
    expect(isViewMotion(valid.viewMotion)).toBe(true);
    expect(isControllerInput(valid)).toBe(true);
  });

  it("rejects malformed view velocity", () => {
    expect(isViewMotion({ x: 2, y: 0, confidence: 1 })).toBe(false);
    expect(isViewMotion({ x: 0, y: Number.NaN, confidence: 1 })).toBe(false);
    expect(isViewMotion({ x: 0, y: 0, confidence: -0.1 })).toBe(false);
    expect(isControllerInput({ ...valid, viewMotion: null })).toBe(false);
  });
});
```

Update the session fixture to use:

```js
viewMotion: { x: 0.25, y: -0.5, confidence: 0.8 },
```

and assert disconnect resets it to `{ x: 0, y: 0, confidence: 0 }`.

- [ ] **Step 2: Run tests and verify contract failure**

Run: `npm test -- tests/protocol.test.js tests/session-registry.test.js`

Expected: FAIL because `isViewMotion` does not exist and registry snapshots still use `orientation`.

- [ ] **Step 3: Implement the snapshot migration**

Add protocol validation:

```js
export function isViewMotion(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    [value.x, value.y, value.confidence].every(isFiniteNumber) &&
    value.x >= -1 && value.x <= 1 &&
    value.y >= -1 && value.y <= 1 &&
    value.confidence >= 0 && value.confidence <= 1
  );
}
```

Require `isViewMotion(value.viewMotion)` inside `isControllerInput`. Change each stopped/default input and socket copy to:

```js
viewMotion: { x: 0, y: 0, confidence: 0 },
```

When `PhoneSession.currentInput()` is stale or disconnected, zero both `move` and `viewMotion` while retaining sequence metadata.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- tests/protocol.test.js tests/session-registry.test.js`

Expected: PASS.

Run: `npm test`

Expected: the protocol and registry tests pass; orientation tests remain unchanged until the sensor replacement task.

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.js src/controller/ControllerSocket.js server/session-registry.js src/desktop/PhoneSession.js tests/protocol.test.js tests/session-registry.test.js
git commit -m "refactor: relay normalized phone view motion"
```

### Task 2: Implement the double-twist state machine

**Files:**
- Create: `src/shared/wrist-gesture.js`
- Create: `tests/wrist-gesture.test.js`

- [ ] **Step 1: Write failing gesture tests**

Use deterministic timestamps and rates:

```js
import { describe, expect, it, vi } from "vitest";
import { createWristGestureDetector } from "../src/shared/wrist-gesture.js";

function twist(detector, start, direction = 1) {
  detector.update({ timeMs: start, twistRate: direction * 220 });
  detector.update({ timeMs: start + 130, twistRate: direction * 220 });
  detector.update({ timeMs: start + 170, twistRate: 0 });
}

describe("double wrist twist", () => {
  it("does not interact after one fast twist", () => {
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onInteract });
    twist(detector, 0, 1);
    detector.update({ timeMs: 1000, twistRate: 0 });
    expect(onInteract).not.toHaveBeenCalled();
  });

  it("interacts once after an opposite-direction double twist", () => {
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onInteract });
    twist(detector, 0, 1);
    twist(detector, 320, -1);
    expect(onInteract).toHaveBeenCalledOnce();
  });

  it("rejects slow, late, and same-direction pairs", () => {
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onInteract });
    detector.update({ timeMs: 0, twistRate: 100 });
    detector.update({ timeMs: 500, twistRate: 100 });
    detector.update({ timeMs: 550, twistRate: 0 });
    twist(detector, 1000, 1);
    twist(detector, 1300, 1);
    twist(detector, 2400, -1);
    expect(onInteract).not.toHaveBeenCalled();
  });
});
```

Add cases for 120 ms minimum separation, 900 ms pair window, 700 ms success cooldown, `reset()`, and `rotating` state.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/wrist-gesture.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the detector**

Export a configurable factory:

```js
export function createWristGestureDetector({
  startSpeed = 170,
  releaseSpeed = 70,
  minimumExcursion = 24,
  pairWindowMs = 900,
  minimumSeparationMs = 120,
  cooldownMs = 700,
  onCandidate,
  onInteract,
} = {})
```

The implementation must:

1. Clamp sample delta time to 50 ms.
2. Integrate `abs(twistRate) * deltaSeconds` only while rate remains above `startSpeed` and keeps the same sign.
3. Register one candidate when integrated excursion reaches `minimumExcursion`.
4. Require rate below `releaseSpeed` before rearming.
5. Pair only opposite directions within the time window and outside minimum separation.
6. Clear pair state after success or expiration and block candidates during cooldown.
7. Return `{ rotating, stage }`, where `stage` is `idle`, `first`, or `interact`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/wrist-gesture.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/wrist-gesture.js tests/wrist-gesture.test.js
git commit -m "feat: detect opposite-direction double wrist twists"
```

### Task 3: Build pure visual-motion math

**Files:**
- Create: `src/shared/view-motion.js`
- Create: `tests/view-motion.test.js`

- [ ] **Step 1: Write failing transform and normalization tests**

```js
import { describe, expect, it } from "vitest";
import {
  alignMotionToGrip,
  blendVerticalMotion,
  gravityAlignedRoll,
  normalizeViewMotion,
  summarizePointMotion,
} from "../src/shared/view-motion.js";

const square = [
  { x: 10, y: 10 }, { x: 50, y: 10 },
  { x: 50, y: 50 }, { x: 10, y: 50 },
];

describe("visual view motion", () => {
  it("recovers robust frame translation", () => {
    const current = square.map(({ x, y }) => ({ x: x - 3, y: y + 2 }));
    current.push({ x: 100, y: -100 });
    const previous = [...square, { x: 0, y: 0 }];
    expect(summarizePointMotion(previous, current)).toMatchObject({ dx: -3, dy: 2 });
  });

  it("keeps controller directions stable after a quarter roll", () => {
    const aligned = alignMotionToGrip({ x: 0, y: 1 }, 90);
    expect(aligned.x).toBeCloseTo(1, 5);
    expect(aligned.y).toBeCloseTo(0, 5);
    expect(gravityAlignedRoll({ x: 9.81, y: 0 }, 0)).toBeCloseTo(90, 5);
  });

  it("uses visual scale as vertical motion when the camera faces the floor", () => {
    expect(blendVerticalMotion({ imageY: 0.2, scaleVelocity: 0.4, screenUpWeight: 1 })).toBeCloseTo(0.6, 5);
    expect(blendVerticalMotion({ imageY: 0.2, scaleVelocity: 0.4, screenUpWeight: 0 })).toBeCloseTo(0.2, 5);
  });

  it("applies confidence, dead zone, and bounds", () => {
    expect(normalizeViewMotion({ x: 0.05, y: -0.08, confidence: 0.9 })).toEqual({ x: 0, y: 0, confidence: 0.9 });
    expect(normalizeViewMotion({ x: 4, y: -4, confidence: 0.2 })).toEqual({ x: 0, y: 0, confidence: 0.2 });
    expect(normalizeViewMotion({ x: 4, y: -4, confidence: 0.9 })).toEqual({ x: 1, y: -1, confidence: 0.9 });
  });
});
```

Also test scale, rotation, too few inliers, and one gross outlier among valid tracks.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/view-motion.test.js`

Expected: FAIL because `view-motion.js` does not exist.

- [ ] **Step 3: Implement robust motion summarization**

Implement:

```js
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizePointMotion(previous, current) {
  const pairs = previous
    .slice(0, current.length)
    .map((from, index) => ({ from, to: current[index] }))
    .filter(({ from, to }) => [from.x, from.y, to.x, to.y].every(Number.isFinite))
    .map((pair) => ({ ...pair, dx: pair.to.x - pair.from.x, dy: pair.to.y - pair.from.y }));
  if (pairs.length < 6) return { dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0, inliers: 0 };

  const centerDx = median(pairs.map(({ dx }) => dx));
  const centerDy = median(pairs.map(({ dy }) => dy));
  const residuals = pairs.map(({ dx, dy }) => Math.hypot(dx - centerDx, dy - centerDy));
  const centerResidual = median(residuals);
  const mad = median(residuals.map((value) => Math.abs(value - centerResidual)));
  const threshold = Math.max(0.75, centerResidual + 2.5 * Math.max(mad, 0.1));
  const inliers = pairs.filter((_, index) => residuals[index] <= threshold);
  if (inliers.length < 6) return { dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0, inliers: 0 };

  const fromCenter = {
    x: inliers.reduce((sum, pair) => sum + pair.from.x, 0) / inliers.length,
    y: inliers.reduce((sum, pair) => sum + pair.from.y, 0) / inliers.length,
  };
  const toCenter = {
    x: inliers.reduce((sum, pair) => sum + pair.to.x, 0) / inliers.length,
    y: inliers.reduce((sum, pair) => sum + pair.to.y, 0) / inliers.length,
  };
  let dot = 0;
  let cross = 0;
  let denominator = 0;
  for (const pair of inliers) {
    const px = pair.from.x - fromCenter.x;
    const py = pair.from.y - fromCenter.y;
    const qx = pair.to.x - toCenter.x;
    const qy = pair.to.y - toCenter.y;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    denominator += px * px + py * py;
  }
  const scale = denominator > Number.EPSILON ? Math.hypot(dot, cross) / denominator : 1;
  const rotation = denominator > Number.EPSILON ? (Math.atan2(cross, dot) * 180) / Math.PI : 0;
  const spread = Math.sqrt(denominator / inliers.length);
  const confidence = clamp((inliers.length / pairs.length) * (inliers.length / 36) * (spread / 18), 0, 1);
  return {
    dx: median(inliers.map(({ dx }) => dx)),
    dy: median(inliers.map(({ dy }) => dy)),
    scale,
    rotation,
    confidence,
    inliers: inliers.length,
  };
}

export function alignMotionToGrip(motion, rollDegrees) {
  const angle = (-rollDegrees * Math.PI) / 180;
  return {
    x: motion.x * Math.cos(angle) - motion.y * Math.sin(angle),
    y: motion.x * Math.sin(angle) + motion.y * Math.cos(angle),
  };
}

export function gravityAlignedRoll(gravity, fallbackRoll = 0) {
  if (![gravity?.x, gravity?.y].every(Number.isFinite) || Math.hypot(gravity.x, gravity.y) < 2) return fallbackRoll;
  return (Math.atan2(gravity.x, gravity.y) * 180) / Math.PI;
}

export function blendVerticalMotion({ imageY, scaleVelocity, screenUpWeight }) {
  const weight = clamp(Number.isFinite(screenUpWeight) ? screenUpWeight : 0, 0, 1);
  return imageY + scaleVelocity * weight;
}

export function normalizeViewMotion(
  sample,
  { deadZone = 0.1, fullSpeed = 1.4, minimumConfidence = 0.45 } = {},
) {
  if (![sample.x, sample.y, sample.confidence].every(Number.isFinite) || sample.confidence < minimumConfidence) {
    return { x: 0, y: 0, confidence: Number.isFinite(sample.confidence) ? Math.max(0, sample.confidence) : 0 };
  }
  const shape = (value) => {
    const magnitude = Math.abs(value);
    if (magnitude <= deadZone) return 0;
    return Math.sign(value) * Math.min(1, (magnitude - deadZone) / (fullSpeed - deadZone));
  };
  return { x: shape(sample.x), y: shape(sample.y), confidence: Math.min(1, sample.confidence) };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/view-motion.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/view-motion.js tests/view-motion.test.js
git commit -m "feat: normalize camera-observed phone motion"
```

### Task 4: Track sparse camera motion locally

**Files:**
- Create: `src/controller/CameraMotionTracker.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/view-motion.test.js`

- [ ] **Step 1: Install the pinned optical-flow dependency**

Run: `npm install jsfeat@0.0.8`

Expected: `jsfeat` appears under dependencies and the lockfile records version `0.0.8`.

- [ ] **Step 2: Add a failing lifecycle test around injected browser adapters**

Add a test that constructs `CameraMotionTracker` with injected browser adapters:

```js
it("owns and releases the local camera stream", async () => {
  const stop = vi.fn();
  const requestCamera = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  const video = { muted: false, playsInline: false, srcObject: null, play: vi.fn().mockResolvedValue() };
  const tracker = new CameraMotionTracker({
    requestCamera,
    createVideo: () => video,
    createCanvas: () => ({ getContext: () => ({ drawImage: vi.fn(), getImageData: vi.fn() }) }),
    scheduleFrame: vi.fn(() => 17),
    cancelFrame: vi.fn(),
    onSample: vi.fn(),
  });
  await tracker.start();
  expect(requestCamera).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  tracker.stop();
  expect(stop).toHaveBeenCalledOnce();
});
```

Assert separately that `setFrozen(true)` emits zero and clears visual history.

Run: `npm test -- tests/view-motion.test.js`

Expected: FAIL because `CameraMotionTracker` does not exist.

- [ ] **Step 3: Implement `CameraMotionTracker`**

Use this public surface:

```js
export class CameraMotionTracker {
  constructor({ onSample, onState, requestCamera, createVideo, createCanvas, scheduleFrame, cancelFrame } = {})
  async start()
  setFrozen(frozen)
  reset()
  stop()
  destroy()
}
```

`start()` requests:

```js
{
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 30, max: 30 },
  },
}
```

Create a muted inline video and a private 96 by 72 canvas. Each analysis frame must:

1. Draw the current video frame and convert RGBA pixels to a jsfeat grayscale matrix.
2. Build a three-level image pyramid.
3. Detect up to 80 YAPE06 corners when history is empty or fewer than 24 tracks remain.
4. Track corners with `jsfeat.optical_flow_lk.track` using a 15-pixel window.
5. Pass valid previous/current pairs to `summarizePointMotion`.
6. Convert displacement to controller velocity using measured frame time: `x = -dx / (deltaSeconds * 70)`, `y = -dy / (deltaSeconds * 70)`, and `scaleVelocity = (scale - 1) / deltaSeconds`. Emit `{ x, y, scaleVelocity, rotation, confidence }`.
7. Emit zero while frozen, for the first three post-freeze stable frames, or below confidence.
8. Swap/reuse preallocated matrices and arrays to avoid per-frame allocation.

- [ ] **Step 4: Run focused tests and build**

Run: `npm test -- tests/view-motion.test.js`

Expected: PASS.

Run: `npm run build`

Expected: Vite builds successfully and bundles jsfeat locally with no CDN request.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/controller/CameraMotionTracker.js tests/view-motion.test.js
git commit -m "feat: track phone translation with local optical flow"
```

### Task 5: Coordinate camera tracking and wrist sensors

**Files:**
- Modify: `src/controller/MotionController.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Modify: `tests/orientation.test.js`

- [ ] **Step 1: Replace quaternion conversion tests with sensor coordination tests**

Remove the `deviceOrientationToQuaternion` assertion. Add tests for exported helpers:

```js
import { chooseTwistRate, normalizeRoll } from "../src/controller/MotionController.js";

expect(chooseTwistRate({ gamma: 215 }, 0)).toBe(215);
expect(chooseTwistRate({ gamma: null }, -180)).toBe(-180);
expect(normalizeRoll(95, 90)).toBeCloseTo(5);
expect(normalizeRoll(-179, 179)).toBeCloseTo(2);
```

Run: `npm test -- tests/orientation.test.js tests/wrist-gesture.test.js tests/view-motion.test.js`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 2: Rewrite `MotionController` as an orchestrator**

Constructor surface:

```js
constructor({ onSample, onState, onTwistCandidate, onInteract, cameraTracker })
```

Behavior:

- Request `DeviceMotionEvent` and `DeviceOrientationEvent` permissions when their static request methods exist.
- Start `deviceorientation` and `devicemotion` listeners plus `CameraMotionTracker` only after permission succeeds.
- Use `rotationRate.gamma`; when absent, derive a wrapped gamma rate from consecutive orientation samples.
- Feed rates into `createWristGestureDetector`.
- Freeze camera tracking whenever total angular speed exceeds 55 degrees per second or the detector reports `rotating`.
- Use projected `accelerationIncludingGravity.x/y` through `gravityAlignedRoll`, falling back to wrapped orientation gamma when gravity projection is too small. The result is used only for `alignMotionToGrip`; it never directly changes the camera.
- Compute `screenUpWeight = clamp(abs(gravity.z) / 9.81, 0, 1)` and pass visual image-Y plus `scaleVelocity` through `blendVerticalMotion`.
- Normalize and emit `{ x, y, confidence }` through `onSample`.
- `reset()` clears camera history, detector state, roll baseline, and emits zero.
- `suspend()` emits zero and stops the camera stream.
- `resume()` restarts the camera and requires three stable frames.

- [ ] **Step 3: Wire the controller UI**

Replace `this.orientation` with:

```js
this.viewMotion = { x: 0, y: 0, confidence: 0 };
```

Create `MotionController` callbacks so the first twist pulses `10`, a successful pair pulses `[18, 36, 18]` and sends `interact`, and samples call `sendInput()`. Update transient status labels to include `camera-denied`, `camera-unavailable`, and `tracking-weak`. On hidden pages call `motion.suspend()`; the explicit Continue button calls `motion.resume()`.

Keep the existing touch interaction button as fallback.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- tests/orientation.test.js tests/wrist-gesture.test.js tests/view-motion.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller/MotionController.js src/controller/ControllerApp.js src/controller/styles.css tests/orientation.test.js
git commit -m "feat: coordinate camera movement and double-twist input"
```

### Task 6: Integrate persistent desktop camera velocity

**Files:**
- Modify: `src/shared/view-motion.js`
- Modify: `tests/view-motion.test.js`
- Modify: `src/desktop/PlayerController.js`

- [ ] **Step 1: Add failing camera integration math tests**

```js
import { integrateViewMotion } from "../src/shared/view-motion.js";

it("integrates normalized view velocity without snapping to center", () => {
  const first = integrateViewMotion({ yaw: 0, pitch: 0, vx: 0, vy: 0 }, { x: 1, y: 1 }, 0.1, { smoothing: 0 });
  expect(first.yaw).toBeLessThan(0);
  expect(first.pitch).toBeGreaterThan(0);
  const settled = integrateViewMotion(first, { x: 0, y: 0 }, 0.1, { smoothing: 0 });
  expect(settled.yaw).toBe(first.yaw);
  expect(settled.pitch).toBe(first.pitch);
});

it("clamps pitch and supports vertical inversion", () => {
  const result = integrateViewMotion({ yaw: 0, pitch: 1.24, vx: 0, vy: 0 }, { x: 0, y: 1 }, 1, { smoothing: 0, invertY: true });
  expect(result.pitch).toBeLessThan(1.24);
  expect(Math.abs(result.pitch)).toBeLessThanOrEqual(1.25);
});
```

Run: `npm test -- tests/view-motion.test.js`

Expected: FAIL because `integrateViewMotion` does not exist.

- [ ] **Step 2: Implement frame-time-independent integration**

Add a pure helper that maps normalized x/y to target angular velocity, damps velocity according to smoothing, integrates yaw/pitch, clamps pitch to 1.25 radians, and returns zero velocity exactly when both input and damped velocity are below `0.001`. Zero input must preserve yaw/pitch.

- [ ] **Step 3: Replace quaternion aiming in `PlayerController`**

- Remove `createOrientationTracker`, calibration, and degree conversion.
- Change default phone input to `viewMotion`.
- Store `viewVelocity = { x: 0, y: 0 }`.
- In `update(delta)`, call `integrateViewMotion` when the phone is connected and not in fallback mode.
- Preserve mouse fallback behavior.
- Change `recenter()` to clear view velocity only; it must not reset current yaw or pitch.
- Clear view velocity on pause and disconnect.

- [ ] **Step 4: Run all tests and build**

Run: `npm test && npm run build`

Expected: all tests pass and Vite produces a production bundle.

- [ ] **Step 5: Commit**

```bash
git add src/shared/view-motion.js tests/view-motion.test.js src/desktop/PlayerController.js
git commit -m "feat: drive desktop view from phone translation velocity"
```

### Task 7: Browser verification and physical-device handoff

**Files:**
- Modify only files required by observed defects.

- [ ] **Step 1: Verify desktop and controller previews**

Start the development server on an unused port and open both the desktop pairing page and `/controller?room=617042&preview=1`. Confirm the existing control layout has no overlap at iPhone portrait and landscape sizes and the 3D canvas is nonblank at desktop sizes.

- [ ] **Step 2: Verify permission and lifecycle behavior**

Using a browser context with fake media where available, confirm enabling requests a camera, hiding/suspending emits zero view input, and destruction stops every media track. Confirm denying camera leaves joystick and touch interaction usable.

- [ ] **Step 3: Run final automated checks**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build succeeds.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Run physical iPhone checks**

Connect through the HTTPS QR URL and verify:

1. Left/right and up/down translation move yaw/pitch responsively in the screen-up grip.
2. The same directions remain coherent in the side grip.
3. Slowly or quickly changing grips does not move the desktop view.
4. One quick twist does not interact.
5. A quick twist and quick opposite return within 900 ms interacts exactly once.
6. Covering the lens yields zero view input and a weak-tracking state.
7. Backgrounding and resuming releases/reacquires camera tracking safely.

Record any threshold-only tuning in named constants, rerun all automated checks, and do not alter the gesture contract.

- [ ] **Step 5: Commit verified tuning, if any**

```bash
git add src tests package.json package-lock.json
git commit -m "fix: tune phone translation and twist thresholds"
```

Skip this commit when no verification changes are needed.
