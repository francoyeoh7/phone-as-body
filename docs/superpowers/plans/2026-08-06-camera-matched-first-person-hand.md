# Camera-Matched First-Person Hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop first-person hand enter from the lower view edge and match rear-camera hand position, wrist orientation, finger pose, and interaction direction while preserving all existing phone controls.

**Architecture:** Add a pure reach-state module and enrich the existing canonical hand pose with pinch/reach/depth features. Make `FirstPersonHand` retarget the checked-in flat WebXR rig in wrist-relative asset space, with an optional licensed forearm presentation and target-contact anchor. Pass raycast contact data from `PlayerController` through `DesktopApp` and `HandTrackingDirector`; bind the existing gesture gate to a stable target and reach state.

**Tech Stack:** JavaScript ES modules, Three.js, MediaPipe Tasks Vision, Vitest, Vite.

## Global Constraints

- Do not change `PlayerController` gyroscope view math, joystick movement, flashlight toggle, or full-screen touch behavior.
- Rear camera only; request one hand; never transmit raw video.
- Motion/orientation permission remains mandatory for gameplay.
- Pixel-difference motion has no interaction authority.
- Screen tap remains the explicit no-camera fallback.
- No hand pose with non-finite data may reach rendering or task state.
- The virtual forearm starts outside the lower edge; an upper-frame hand cannot acquire reach or trigger an action.
- A focused target must remain stable for 100 ms before a gesture candidate can start; interaction pulses keep the 500 ms cooldown.
- Use the checked-in MIT WebXR hand as guaranteed fallback. Any replacement/forearm asset must have explicit redistribution rights and a recorded source/license.

---

### Task 1: Reach-region state and canonical pose features

**Files:**
- Create: `src/shared/hand-reach.js`
- Modify: `src/shared/hand-pose.js`
- Modify: `src/controller/MediaPipeHandTracker.js`
- Test: `tests/hand-reach.test.js`
- Test: `tests/hand-pose.test.js`
- Test: `tests/media-pipe-hand-tracker.test.js`

**Interfaces:**
- `createReachState(options?)` returns a serializable state object.
- `updateReachState(state, pose, now, options?)` returns `{ state, eligible, progress, entered }`.
- `deriveHandFeatures()` and `createTrackedHandFrame()` add `pinchStrength`, `reachEligible`, `reachProgress`, `depth`, and `palmSpan` while retaining existing fields.
- Tracker requests `numHands: 1`, normalizes video orientation metadata, and maintains a stable lower-entry palm-span calibration.

- [ ] Write failing tests for lower-edge acquisition, upper-frame rejection, hysteresis, 90-degree rotation normalization, pinch scoring, and single-hand landmarker options.
- [ ] Run `npm test -- tests/hand-reach.test.js tests/hand-pose.test.js tests/media-pipe-hand-tracker.test.js`; confirm failures are feature assertions rather than test setup errors.
- [ ] Implement pure reach state with entry wrist Y `>= 0.72`, palm Y `>= 0.50`, coverage `>= 16/21`, three frames over `140 ms`, post-acquisition corridor `Y 0.15..0.96`, top reset after `120 ms`, and inner/outer margins.
- [ ] Add pinch strength from thumb-tip/index-tip distance normalized by palm span, and include it in grab strength without making raw motion authoritative.
- [ ] Add orientation normalization helpers for 0/90/180/270-degree camera frames; apply rear-camera handedness exactly once.
- [ ] Set MediaPipe `numHands: 1` and pass calibration between frames without restarting inference.
- [ ] Run the focused tests and refactor only after green.

### Task 2: Stable WebXR retargeting and lower-edge hand presentation

**Files:**
- Modify: `src/desktop/FirstPersonHand.js`
- Create: `src/desktop/hand-asset-adapter.js`
- Test: `tests/first-person-hand.test.js`
- Test: `tests/hand-asset-adapter.test.js`

**Interfaces:**
- `createFlatWebXRAdapter(scene, side)` records rest positions/quaternions and exposes `applyPose(pose, options)`.
- `FirstPersonHand.setTargetContact({ point, normal }|null)` sets a damped camera-local contact target.
- `FirstPersonHand.applyPose()` preserves the authored rig's coherent span, maps all joints from wrist-relative canonical coordinates, and exposes `reachState`/`armAnchor`.

- [ ] Write failing tests proving raw MediaPipe coordinates do not become asset-local positions, rest-equivalent mapping preserves bind span, wrist basis maps yaw/pitch/roll once, curls do not double-apply, and upper-frame poses stay retracted.
- [ ] Run the focused tests and observe the expected failures against the current center-floating implementation.
- [ ] Implement adapter math: record asset wrist/palm basis/span, transform `point - mpWrist` through tracked basis to rest basis, clamp scale, assign converted local positions, and apply rest-relative quaternion deltas. Keep last stable transform on invalid input.
- [ ] Add a lower-left/lower-right off-screen forearm anchor, camera-local elbow/wrist path, 150 ms target-contact damping, and bounded contact ellipse. Do not synthesize finger curls or wrist orientation from the target.
- [ ] Remove the extra curl quaternion multiplication when landmark segment rotations already encode finger bend.
- [ ] Load optional `public/assets/hands/psx-arms.glb` only when present and licensed; otherwise use WebXR hand plus procedural low-poly forearm sleeve, with no runtime failure.
- [ ] Run focused tests and inspect a Three.js screenshot/geometry bounds for open, fist, grab, retracted, and lost states.

### Task 3: Target contact propagation and gesture/task binding

**Files:**
- Modify: `src/desktop/PlayerController.js`
- Modify: `src/desktop/HandTrackingDirector.js`
- Modify: `src/desktop/HandGestureGate.js`
- Modify: `src/desktop/DesktopApp.js`
- Test: `tests/player-controller.test.js`
- Test: `tests/hand-tracking-director.test.js`
- Test: `tests/hand-gesture-gate.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- `PlayerController` emits `onTarget({ id, focused, contactPoint, contactNormal, focusedAt })`.
- `HandTrackingDirector.setTarget(target|null)` stores target identity/contact and resets the gate when identity changes.
- `HandGestureGate.update(sample, now, target)` returns a one-shot pulse only for a fresh reach-eligible pose bound to the same target.

- [ ] Write failing tests for raycast contact metadata, 100 ms focus stabilization, target-change rearming, reach requirement, pinch/grab hysteresis, and cinematic suppression.
- [ ] Run focused tests and confirm the old ID-only event path fails the new assertions.
- [ ] Emit hit point/normal from the actual raycast; for assisted targets use a stable root contact fallback. Preserve current halo/prompt behavior.
- [ ] Feed target context into the hand director and its hand visual every frame; keep task ownership separate from continuous rendering.
- [ ] Make the gate use smoothed `pinchStrength`/`grabStrength`, 160 ms candidate dwell, three fresh frames, enter `0.64`, release `0.46`, and 500 ms cooldown. Reset on focus loss/change.
- [ ] Route only confirmed pulses to `player.interact('hand')`; leave touch/keyboard paths intact.
- [ ] Run focused tests and then the complete test suite.

### Task 4: Task-state resilience and asset provenance

**Files:**
- Modify: `src/shared/hand-task-state.js`
- Modify: `src/desktop/DoorDefenseDirector.js`
- Modify: `src/desktop/FoundPhoneDirector.js`
- Modify: `public/assets/hands/SOURCE.md`
- Test: `tests/hand-task-state.test.js`
- Test: `tests/door-defense-director.test.js`
- Test: `tests/found-phone-director.test.js`

**Interfaces:**
- Task state machine retains candidate/held state through a single bad frame and pauses progress on sustained low confidence.
- Door/phone directors consume `reachEligible` and stable pose fields, never pixel-presence events.

- [ ] Write failing tests for a 120-180 ms transient loss, upper-frame rejection, sustained brace, held-phone release, and three-second pickup cooldown.
- [ ] Run focused tests and confirm the current state machine fails the transient-loss and reach assertions.
- [ ] Add separate candidate/hold loss timers and use reach eligibility as a prerequisite for action scores.
- [ ] Update directors so task progress/phone UI follows held reach-eligible poses and pauses/releases safely; preserve existing touch fallback and story transitions.
- [ ] Record the checked-in WebXR MIT source and optional CC0 forearm source metadata without claiming an unverified replacement asset.
- [ ] Run focused task tests and the complete suite.

### Task 5: Verification, production build, and public smoke test

**Files:**
- Verify all changed source/tests/assets; no unrelated cleanup.

**Interfaces:**
- Built desktop/controller bundles contain the canonical pose code, hand assets, MediaPipe model/WASM, and Socket.IO routes.

- [ ] Run `npm test` and capture the complete pass/fail count.
- [ ] Run `npm run build`; verify `dist/assets/hands/left.glb`, `right.glb`, MediaPipe model/WASM, and optional forearm asset are present.
- [ ] Start the production server and a temporary HTTPS tunnel, then smoke test `/`, `/controller`, `/socket.io/`, both hand GLBs, model, and WASM with HTTP 200.
- [ ] Use Playwright or an equivalent browser check to capture desktop states: retracted, lower-entry, focused contact, grab, and tracking loss; check for no WebGL blank canvas or console errors.
- [ ] Re-run targeted tests after any smoke-test fix and report exact evidence.

