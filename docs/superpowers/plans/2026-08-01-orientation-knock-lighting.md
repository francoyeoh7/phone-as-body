# Orientation, Knock, and Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unreliable camera-motion view control with roll-invariant phone orientation gestures, separate taps from joystick input, add optional physical-knock interaction, and brighten the corridor/flashlight.

**Architecture:** `src/shared/orientation.js` will convert device orientation to a phone-long-axis aim vector and emit ratcheted yaw/pitch deltas. `MotionController` will own sensor permission, calibration, gesture filtering, and impact detection; `ControllerSocket` and the desktop session will transport/apply one-shot `viewDelta` values. The scene will expose grouped flashlight layers so the desktop can toggle core, spill, and visual beam together.

**Tech Stack:** Vanilla ES modules, Vitest, Socket.IO, Three.js, Web DeviceMotion/DeviceOrientation APIs, Vite.

---

### Task 1: Replace orientation and motion tracking

**Files:**
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/shared/orientation.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/controller/MotionController.js`
- Delete: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/controller/CameraMotionTracker.js`
- Delete: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/shared/wrist-gesture.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/orientation.test.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/motion-controller.test.js`

- [ ] **Step 1: Write failing orientation tests** for calibration, equivalent face-on/edge-on aim signs, roll-only no-op, outward 20-degree to 80-degree gain, neutral return rearming, and opposite-direction response.
- [ ] **Step 2: Run `npm test -- --run tests/orientation.test.js tests/motion-controller.test.js`** and confirm the old absolute-angle/camera path fails the new cases.
- [ ] **Step 3: Implement vector math**: convert normalized device quaternion into the calibrated frame, transform local long axis `(0, 1, 0)`, unwrap azimuth/elevation, ignore twist around that axis, detect roll-dominant transitions, and emit only increasing outward excursion with a 2.5-degree neutral rearm cone.
- [ ] **Step 4: Implement motion ownership**: request only motion/orientation permission, reset calibration on lifecycle/orientation changes, use 0.8-degree sample deadzone and 25-degree physical clamp, and detect a filtered impact at 13 m/s2 with 140 ms release and 450 ms cooldown.
- [ ] **Step 5: Remove camera tracker, wrist detector, camera permission state, and `jsfeat` imports; rerun the focused tests until they pass.**

### Task 2: Transport view deltas and isolate interaction input

**Files:**
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/controller/ControllerApp.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/controller/ControllerSocket.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/shared/protocol.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/server/session-registry.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/desktop/PhoneSession.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/desktop/PlayerController.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/controller-app.test.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/protocol.test.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/session-registry.test.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/player-controller.test.js`

- [ ] **Step 1: Add failing contract tests** for `{ move, viewDelta }`, bounded degree deltas, accumulated 30 Hz flushes, stale zeroing, and exactly-once desktop application.
- [ ] **Step 2: Implement the contract** so the controller accumulates pending yaw/pitch degrees between flushes, server/session validates and copies them, then clears them after delivery.
- [ ] **Step 3: Apply deltas once** in `PlayerController`, converting degrees to radians, applying sensitivity/invertY, accumulating yaw, and clamping pitch without velocity integration or snap-back.
- [ ] **Step 4: Make pointer ownership explicit**: joystick-started pointers never reach play-surface tap handling; short taps elsewhere send one interaction; action controls stop propagation.
- [ ] **Step 5: Replace the old controller status/copy and rerun all controller/protocol/session/player tests.**

### Task 3: Add physical knock fallback and flashlight grouping

**Files:**
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/controller/ControllerApp.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/desktop/create-scene.js`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/src/desktop/DesktopApp.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/motion-controller.test.js`
- Test: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/horror-director.test.js`

- [ ] **Step 1: Add failing impact tests** for ordinary rotation rejection, one impact/one action, cooldown, and screen-tap/button fallback behavior.
- [ ] **Step 2: Wire one physical impact to `sendAction("interact")`** while keeping taps and the interaction button separate from joystick pointers.
- [ ] **Step 3: Return a flashlight group** containing the shadowed bright core, wider spill, and transparent visual beam; toggle all members together from `DesktopApp`.
- [ ] **Step 4: Add modest renderer/hemisphere/practical/fog changes** and verify light intensities/ranges are finite and the scene still preserves dark pools.
- [ ] **Step 5: Rerun interaction and scene tests.**

### Task 4: Dependency cleanup and full verification

**Files:**
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/package.json`
- Modify: `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/package-lock.json`
- Test: all files under `/Users/francoyeo/Documents/Codex/2026-07-31/ni-h/tests/`

- [ ] **Step 1: Remove `jsfeat` from package manifests** and install the lockfile without the unused dependency.
- [ ] **Step 2: Run `npm test`** and require all tests to pass.
- [ ] **Step 3: Run `npm run build`** and require a successful production bundle with no stale camera/wrist imports.
- [ ] **Step 4: Start the local server, verify the desktop page, generate a fresh QR URL, and smoke-test phone connection, joystick movement, orientation yaw/pitch, tap interaction, knock fallback, flashlight toggle, and brighter corridor.**
- [ ] **Step 5: Commit the implementation with `feat: add roll-invariant phone controls`.**

## Self-review

- Orientation, input transport, interaction separation, knock fallback, lighting, dependency cleanup, automated tests, build, and physical-device smoke testing are all covered.
- No task relies on the removed `viewMotion`, camera tracker, wrist detector, or `jsfeat` APIs after Task 1.
- The `viewDelta` shape, degree units, rearm behavior, and flashlight group name are consistent across controller, server, desktop, and tests.
