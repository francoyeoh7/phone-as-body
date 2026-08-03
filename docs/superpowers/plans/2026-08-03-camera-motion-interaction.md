# Camera Motion Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add local front-camera motion-triggered interaction with startup permission and reticle aim assist to the existing Corridor 617 browser game.

**Architecture:** The desktop keeps authoritative target selection. `PlayerController` applies bounded aim attraction and `DesktopApp` sends a target-focus event through `PhoneSession`. The phone requests its camera during the existing sensor-enable gesture, keeps a low-resolution stream warm, and runs a local canvas frame differ only while a target is focused; a qualifying motion emits the existing `interact` action.

**Tech Stack:** JavaScript ES modules, browser `getUserMedia`, canvas `ImageData`, Socket.IO/RTC event relay, Three.js, Vitest, Vite.

## Global Constraints

- Raw camera frames never leave the phone and no camera recording is stored.
- Camera permission is requested during the first explicit sensor-enable action.
- Camera failure always preserves the current short-tap interaction fallback.
- Motion detection is local frame difference, not a hand-pose model or semantic intent classifier.
- Desktop target validation remains authoritative.

---

### Task 1: Frame-Difference Detector Contract

**Files:**
- Create: `src/controller/CameraMotionDetector.js`
- Create: `tests/camera-motion-detector.test.js`

**Interfaces:**
- Produces `measureFrameMotion(previous, current, width, height)` returning `{ meanDifference, activeRatio }`.
- Produces `shouldTriggerMotion(metrics, options)` returning a boolean.
- Produces `CameraMotionDetector` with `start()`, `setFocused(focused)`, `suspend()`, `resume()`, `destroy()`.

- [ ] Write tests first for local motion acceptance, global motion rejection, cooldown, one trigger per focus, focus disarm, and camera permission failure.
- [ ] Run `npm test -- tests/camera-motion-detector.test.js`; expect failure because the detector module does not exist.
- [ ] Implement grayscale/downsampled frame metrics, threshold gating, camera stream setup, requestAnimationFrame sampling, and lifecycle cleanup.
- [ ] Run the focused test; expect all detector tests to pass.

### Task 2: Desktop Aim Assist and Target-Focus Event

**Files:**
- Modify: `src/desktop/PlayerController.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `tests/player-controller.test.js`

**Interfaces:**
- `PlayerController` accepts optional `onTarget({ id, focused })`.
- `DesktopApp` sends `{ type: "target-focus", id }` via `PhoneSession.send`.

- [ ] Add a failing test proving selected target changes emit focus and clear events.
- [ ] Run the focused player tests and verify the new assertion fails.
- [ ] Apply `setAimAssist()` for the selected target with a bounded strength and clear it when no target is selected.
- [ ] Emit target-focus only when selection changes and wire the DesktopApp callback to PhoneSession.
- [ ] Run player tests and verify the new target/aim behavior passes.

### Task 3: Controller Permission and Camera Lifecycle

**Files:**
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Modify: `tests/controller-app.test.js`

**Interfaces:**
- `ControllerApp` creates `CameraMotionDetector` with `onMotion: () => socket.sendAction("interact")`.
- `ControllerApp.handleDesktopEvent({ type: "target-focus", id })` calls `cameraMotion.setFocused(Boolean(id))`.

- [ ] Add failing tests proving sensor enable requests camera startup, focus arms detection, and page hide/destroy suspend or release the detector.
- [ ] Run the focused controller tests and verify failure.
- [ ] Request camera and motion permission together from `enableSensors()` without making camera denial fatal to touch/orientation control.
- [ ] Handle target-focus, camera states, visibility, and destroy; preserve the existing interaction tap path.
- [ ] Run controller tests and verify pass.

### Task 4: Verification and Documentation

**Files:**
- Modify: `README.md`

- [ ] Document HTTPS/camera permission, local-only frame analysis, the target-focus flow, and tap fallback.
- [ ] Run `npm test` and confirm the full suite passes.
- [ ] Run `npm run build` and confirm Vite production build succeeds.
- [ ] Run `git diff --check` and inspect `git status` to confirm only scoped files changed besides the user's existing HTML artifact.
