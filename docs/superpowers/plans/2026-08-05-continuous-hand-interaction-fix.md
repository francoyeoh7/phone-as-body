# Continuous Hand Interaction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rear-camera MediaPipe tracking persistent, show the game hand during exploration, and make confirmed hand poses the only camera-driven interaction source.

**Architecture:** The controller owns one persistent tracker session. The desktop hand director separates continuous pose rendering from optional task interpretation, while a hysteresis gate produces one-shot grab actions for focused ordinary targets.

**Tech Stack:** JavaScript, Three.js, MediaPipe Tasks Vision, Socket.IO/WebRTC, Vitest, Vite.

## Global Constraints

- Do not change the gyroscope view algorithm or joystick movement, and do not break the flashlight toggle or full-screen touch controls.
- Motion/orientation permission is mandatory for gameplay.
- Use only the rear camera and never transmit raw video.
- Keep screen tap as the no-camera fallback.
- Never let pixel-difference motion complete an interaction or task.

---

### Task 1: Persistent controller tracking

**Files:**
- Modify: `src/controller/ControllerApp.js`
- Test: `tests/controller-app.test.js`

**Interfaces:**
- Consumes: `MediaPipeHandTracker.setTask({ active: boolean })`, `suspend()`, and `resume()`.
- Produces: one active tracker session after rear-camera permission; task events update UI context without restarting inference.

- [ ] Add tests asserting camera permission starts tracking once, `hand-task` events do not restart it, and `handleCameraMotion()` never sends `interact`.
- [ ] Run `npm test -- tests/controller-app.test.js` and confirm the new assertions fail for the current task-scoped/pixel-trigger behavior.
- [ ] Start the tracker after `cameraGranted`, preserve it across task messages, and remove interaction authority from `handleCameraMotion()`.
- [ ] Re-run the focused test and commit the green change.

### Task 2: Persistent desktop hand and recoverable startup

**Files:**
- Modify: `src/desktop/HandTrackingDirector.js`
- Test: `tests/hand-tracking-director.test.js`

**Interfaces:**
- Consumes: ordered tracked/lost/unavailable hand frames.
- Produces: `update(delta)` always drives the hand visual; `beginTask()` and `endTask()` only own/reset semantic state.

- [ ] Add tests that accept/apply a pose without a task owner, keep visibility through `endTask()`, and recover when a tracked frame arrives after more than 1.5 seconds.
- [ ] Run `npm test -- tests/hand-tracking-director.test.js` and confirm failures expose the current owner gate and permanent fallback.
- [ ] Separate visual stream state from task state, make silence recoverable, and reserve fallback for explicit unavailable/model failure.
- [ ] Re-run the focused test and commit the green change.

### Task 3: Focused grab interaction gate

**Files:**
- Create: `src/desktop/HandGestureGate.js`
- Modify: `src/desktop/HandTrackingDirector.js`
- Modify: `src/desktop/DesktopApp.js`
- Test: `tests/hand-gesture-gate.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- Consumes: fresh pose samples with `trackingConfidence` and `grabStrength`.
- Produces: one `grab` pulse after 220 ms above 0.72, rearms after 180 ms below 0.55, and enforces a 500 ms cooldown.

- [ ] Add failing tests for hysteresis, one-shot behavior, cooldown, loss handling, focus requirement, and cinematic suppression.
- [ ] Implement `HandGestureGate.update(sample, now): boolean` and expose pulses from `HandTrackingDirector`.
- [ ] Route a pulse through `DesktopApp` to `player.interact()` only when a target is focused and no hand task/cinematic owns input.
- [ ] Run both focused test files and commit the green change.

### Task 4: Door and sustained found-phone tasks

**Files:**
- Modify: `src/desktop/DoorDefenseDirector.js`
- Modify: `src/desktop/FoundPhoneDirector.js`
- Modify: `src/desktop/FoundPhoneProp.js`
- Test: `tests/door-defense-director.test.js`
- Test: `tests/found-phone-director.test.js`

**Interfaces:**
- Consumes: `HandTrackingDirector.snapshot(context)` and explicit `usesFallback(context)`.
- Produces: door progress only from fresh confirmed poses; phone content exists only during a sustained grab and the dropped phone has a three-second pickup cooldown.

- [ ] Add failing tests proving pixel presence cannot start/advance a tracked task, delayed tracked poses can still enter/hold brace, and phone release/loss drops the prop and starts a three-second cooldown.
- [ ] Remove legacy presence-mode completion, keep door progress paused during lost/unstable observations, and require a pre-calibrated sustained grab for phone inspection.
- [ ] Run focused task tests and commit the green change.

### Task 5: Flashlight range and inertial follow

**Files:**
- Modify: `src/desktop/create-scene.js`
- Test: `tests/scene-props.test.js`

**Interfaces:**
- Consumes: the final rendered camera quaternion and frame delta.
- Produces: a brighter long-range flashlight rig with short frame-rate-independent follow lag.

- [ ] Add failing tests for the new light profile and follow interpolation without changing `PlayerController.applyPhoneViewDelta()`.
- [ ] Move the flashlight rig to a scene-space follow pivot, raise core/spill intensity and range, and update it each scene frame.
- [ ] Run focused scene/player tests and commit the green change.

### Task 6: Integration and deployment

**Files:**
- Verify all modified files and production assets.

**Interfaces:**
- Consumes: built desktop/controller bundles and public HTTPS origin.
- Produces: a public playable URL using the corrected hand pipeline.

- [ ] Run `npm test` and require all tests to pass without warnings.
- [ ] Run `npm run build` and confirm MediaPipe model/WASM and both hand GLBs are present in `dist`.
- [ ] Run a desktop/controller browser smoke test and verify no console errors, nonblank WebGL output, and successful public asset/network requests.
- [ ] Restart the public production server, keep the Cloudflare HTTPS tunnel alive, and verify `/`, `/controller`, Socket.IO, model, WASM, and hand assets return HTTP 200.
