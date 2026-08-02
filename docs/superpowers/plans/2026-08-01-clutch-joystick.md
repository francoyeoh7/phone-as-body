# Clutch Joystick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing movement joystick into an explicit motion clutch without removing continuous locomotion.

**Architecture:** `VirtualJoystick` reports contact state to `ControllerApp`, which engages or disengages `MotionController`. The orientation tracker emits reversible relative deltas only while engaged; all transport and desktop movement code remain unchanged.

**Tech Stack:** JavaScript, Vitest, Device Orientation API, Pointer Events, WebRTC data channel, Vite.

---

### Task 1: Lock The Clutch Contract In Tests

**Files:**
- Modify: `tests/orientation.test.js`
- Modify: `tests/motion-controller.test.js`
- Create: `tests/virtual-joystick.test.js`
- Modify: `tests/controller-app.test.js`

- [ ] Add a tracker test where a 20-degree outward sweep yields positive camera motion and the held return path yields the matching negative motion.
- [ ] Add a motion-controller test where released sensor events emit nothing, engaging calibrates at the latest pose, and disengaging freezes output.
- [ ] Add a joystick test where pointer down reports engagement and pointer up reports release plus zero movement.
- [ ] Add an app test where joystick engagement calls the matching motion-controller methods.
- [ ] Run the focused tests and confirm they fail for the missing clutch behavior.

### Task 2: Implement Explicit Engagement

**Files:**
- Modify: `src/shared/orientation.js`
- Modify: `src/controller/MotionController.js`
- Modify: `src/controller/VirtualJoystick.js`
- Modify: `src/controller/ControllerApp.js`

- [ ] Replace excursion-only output with reversible changes in calibrated aim, using a default gain of three.
- [ ] Add `engage()` and `disengage()` to `MotionController`; recalibrate from the latest orientation on every engagement and suppress samples while released.
- [ ] Add `onEngagementChange` to `VirtualJoystick` and clear it on every pointer-loss lifecycle path.
- [ ] Wire joystick engagement to motion engagement in `ControllerApp` without changing movement packets or action taps.
- [ ] Run the focused tests until they pass.

### Task 3: Expose State And Verify End To End

**Files:**
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/MotionDiagnostics.js`
- Modify: `src/controller/styles.css`

- [ ] Add a `CLUTCH` telemetry row and active-state styling.
- [ ] Run the complete test suite and production build.
- [ ] Inspect controller portrait and desktop pages for overlap and runtime errors.
- [ ] Reuse the running server when possible and provide the fresh controller QR entry.
