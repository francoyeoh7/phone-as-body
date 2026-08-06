# Camera-Matched First-Person Hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rear-camera hand drive a visually continuous first-person hand and forearm that enters from the lower edge, preserves camera hand direction and angles, reaches the focused object, and reliably gates grab/brace/hold interactions.

**Architecture:** Keep the existing landmark-only transport and gyroscope/touch paths. Add a pure reach/rotation-normalization layer in shared code, carry a target contact snapshot from the PlayerController through DesktopApp into HandTrackingDirector, and replace the current raw-coordinate bone writes with a wrist-relative similarity transform calibrated against each GLB's authored rest pose. The hand renderer owns lower-edge arm presentation and target blending; gesture/task state machines own semantic actions.

**Tech Stack:** JavaScript ES modules, Three.js 0.178, MediaPipe Tasks Vision 1.0.1, Vitest 3, Vite, Socket.IO.

## Global Constraints

- Do not modify the established gyroscope view algorithm, joystick movement, flashlight input, or full-screen touch input.
- Use rear camera only, request one hand from MediaPipe, and transmit landmarks/status rather than raw video.
- A hand must acquire through the lower camera edge before it can trigger a gesture.
- Pixel-difference motion never has authority to trigger an interaction or advance a task.
- Keep screen tap as the existing fallback when camera tracking is unavailable; gyroscope permission remains mandatory for gameplay.
- Preserve WebXR generic-hand MIT notices and reject external assets with missing redistribution terms.
- Every implementation task starts with a failing test and ends with a focused green test plus a commit.

---

### Task 1: Add pure orientation normalization and bottom-entry reach state

**Files:**
- Create: `src/shared/hand-reach.js`
- Modify: `src/shared/hand-pose.js`
- Test: `tests/hand-reach.test.js`
- Test: `tests/hand-pose.test.js`

**Interfaces:**
- Consumes: normalized 21-point image landmarks, palm center, handedness, and capture timestamps.
- Produces: `normalizeVideoLandmarks(landmarks, rotation)`, `createReachState()`, and `updateReachState(state, observation)` returning `{ acquired, eligible, entryProgress, reason }`.

- [ ] **Step 1: Write failing reach tests.** Cover initial upper-frame rejection, three-frame bottom entry at `wrist.y >= 0.72` and palm center `y >= 0.50`, active movement up to `y >= 0.15`, top-boundary reset after 120 ms, loss reset after 250 ms, and 0/90/180/270 degree image rotation preserving physical bottom/left/right.
- [ ] **Step 2: Run the focused test.**

  Run: `npm test -- tests/hand-reach.test.js`

  Expected: FAIL because the module and reach state do not exist.
- [ ] **Step 3: Implement the pure state machine.** Keep the state serializable and deterministic. Rotate normalized image points around the unit square before evaluating ROI, invert image Y only in the camera-local mapping helper, and use separate acquisition/active/exit thresholds so edge jitter cannot flap the state.
- [ ] **Step 4: Add pose fields and stable calibration hooks.** Extend `deriveHandFeatures()` with `palmSpan`, `palmCenter`, and optional `reach` data without changing the raw landmark schema. Extend `createTrackedHandFrame({ calibration })` so the tracker can pass the first stable palm span and derive `relativeScale`.
- [ ] **Step 5: Re-run focused tests.**

  Run: `npm test -- tests/hand-reach.test.js tests/hand-pose.test.js`

  Expected: PASS with all existing hand-pose tests still green.
- [ ] **Step 6: Commit.**

  Run: `git add src/shared/hand-reach.js src/shared/hand-pose.js tests/hand-reach.test.js tests/hand-pose.test.js; git commit -m "feat: gate hand input by lower camera reach"`

### Task 2: Make controller tracking rear-camera-only, single-hand, and calibrated

**Files:**
- Modify: `src/controller/MediaPipeHandTracker.js`
- Test: `tests/media-pipe-hand-tracker.test.js`

**Interfaces:**
- Consumes: camera video metadata, MediaPipe result landmarks, and `updateReachState()`.
- Produces: tracked frames with `reach`, `relativeScale`, `rotation`, and one selected hand; all frame payloads remain landmark-only.

- [ ] **Step 1: Write failing tracker tests.** Assert MediaPipe is created with `numHands: 1`, a hand first visible at the top emits no tracked frame until a valid bottom entry, 90-degree rotation is normalized, and a stable lower entry sets the calibration palm span.
- [ ] **Step 2: Run the focused tracker test.**

  Run: `npm test -- tests/media-pipe-hand-tracker.test.js`

  Expected: FAIL on `numHands: 2` and missing reach/calibration fields.
- [ ] **Step 3: Implement tracker integration.** Track reach state per mode epoch, call `normalizeVideoLandmarks()` before candidate selection, pass `{ palmSpan }` into `createTrackedHandFrame()`, and retain the existing front-camera rejection and recoverable unavailable state. Do not add a video or bitmap field to any outbound frame.
- [ ] **Step 4: Re-run focused tracker tests and the current camera tests.**

  Run: `npm test -- tests/media-pipe-hand-tracker.test.js tests/controller-app.test.js`

  Expected: PASS, including existing worker/main-thread fallback assertions.
- [ ] **Step 5: Commit.**

  Run: `git add src/controller/MediaPipeHandTracker.js tests/media-pipe-hand-tracker.test.js; git commit -m "feat: calibrate rear camera hand reach"`

### Task 3: Carry target contact points and focus epochs through desktop interaction

**Files:**
- Modify: `src/desktop/PlayerController.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/HandTrackingDirector.js`
- Test: `tests/player-controller.test.js`
- Test: `tests/desktop-app.test.js`
- Test: `tests/hand-tracking-director.test.js`

**Interfaces:**
- Produces from `PlayerController.updateInteraction()`: `{ id, focused, worldPoint, worldNormal, distance, focusEpoch }`.
- Consumes in `HandTrackingDirector.setTarget(target)`: target snapshot or `null`.
- Produces from `HandTrackingDirector`: `onGesture({ type: "grab", targetId, focusEpoch, pose })`.

- [ ] **Step 1: Write failing target-link tests.** Assert a ray hit reports the hit point/normal, an assisted target uses its `interactionAnchor` when present, focus changes increment the epoch, and a gesture for an obsolete target is rejected by `PlayerController.interact(expectedTargetId)`.
- [ ] **Step 2: Run focused tests.**

  Run: `npm test -- tests/player-controller.test.js tests/desktop-app.test.js tests/hand-tracking-director.test.js`

  Expected: FAIL because focus currently carries only an ID and `interact()` has no expected-target guard.
- [ ] **Step 3: Implement target snapshot propagation.** Preserve hit points in world space, create a conservative anchor only when a ray hit is unavailable, store `currentTarget` and `focusEpoch` in DesktopApp, and call `handTracking.setTarget()` on every focus transition. Add the expected target check before dispatching any hand interaction; touch/keyboard behavior continues to call the existing path without an expected ID.
- [ ] **Step 4: Re-run focused tests.**

  Run: `npm test -- tests/player-controller.test.js tests/desktop-app.test.js tests/hand-tracking-director.test.js`

  Expected: PASS with old touch/keyboard interaction tests unchanged.
- [ ] **Step 5: Commit.**

  Run: `git add src/desktop/PlayerController.js src/desktop/DesktopApp.js src/desktop/HandTrackingDirector.js tests/player-controller.test.js tests/desktop-app.test.js tests/hand-tracking-director.test.js; git commit -m "feat: bind hand gestures to focused target contact"`

### Task 4: Stabilize grab, brace, and hold state machines

**Files:**
- Modify: `src/shared/hand-pose.js`
- Modify: `src/desktop/HandGestureGate.js`
- Modify: `src/shared/hand-task-state.js`
- Modify: `src/desktop/DoorDefenseDirector.js`
- Modify: `src/desktop/FoundPhoneDirector.js`
- Test: `tests/hand-gesture-gate.test.js`
- Test: `tests/hand-task-state.test.js`
- Test: `tests/door-defense-director.test.js`
- Test: `tests/found-phone-director.test.js`

**Interfaces:**
- `HandGestureGate.update(sample, now, { targetId, focusEpoch, reachEligible }) -> boolean`.
- `scoreHandAction("grab", pose)` combines fist and pinch evidence; `scoreHandAction("brace", pose, calibration)` uses calibrated palm sign and bounded settled velocity.
- `HandTaskStateMachine` tolerates a short candidate/confirmed gap and exposes `phase: "unstable"` only after the configured loss grace.

- [ ] **Step 1: Write failing gate/task tests.** Cover focus-epoch reset, natural pinch/fist scores around 0.62, 180 ms/three-frame confirmation, 0.45 release hysteresis, reach-region requirement, candidate frame-gap grace, calibrated brace sign, and sustained phone release/drop behavior.
- [ ] **Step 2: Run focused tests.**

  Run: `npm test -- tests/hand-gesture-gate.test.js tests/hand-task-state.test.js tests/door-defense-director.test.js tests/found-phone-director.test.js`

  Expected: FAIL on the old `.72/.55` gate, target-independent candidates, strict candidate failure, and raw brace sign/velocity score.
- [ ] **Step 3: Implement stable scoring and gating.** Keep the existing 500 ms cooldown, require distinct frame sequence numbers, clear candidates on target epoch changes, and never let stale or pixel-presence events call `onGesture`. Use a 45-55 ms action smoothing path separate from the 90-120 ms visual pose smoothing path.
- [ ] **Step 4: Re-run focused tests and the full hand suite.**

  Run: `npm test -- tests/hand-gesture-gate.test.js tests/hand-task-state.test.js tests/door-defense-director.test.js tests/found-phone-director.test.js tests/hand-tracking-director.test.js`

  Expected: PASS with task progress pausing on sustained loss and no single-frame drop.
- [ ] **Step 5: Commit.**

  Run: `git add src/shared/hand-pose.js src/desktop/HandGestureGate.js src/shared/hand-task-state.js src/desktop/DoorDefenseDirector.js src/desktop/FoundPhoneDirector.js tests/hand-gesture-gate.test.js tests/hand-task-state.test.js tests/door-defense-director.test.js tests/found-phone-director.test.js; git commit -m "fix: stabilize reach-aware hand actions"`

### Task 5: Retarget the hand without tearing and add lower-edge forearm presentation

**Files:**
- Create: `src/desktop/hand-retarget.js`
- Modify: `src/desktop/FirstPersonHand.js`
- Add or modify: `public/assets/hands/forearm.glb` and `public/assets/hands/FOREARM-SOURCE.md` only after license and hierarchy inspection
- Test: `tests/hand-retarget.test.js`
- Modify: `tests/first-person-hand.test.js`

**Interfaces:**
- `captureRestHandRig(root) -> { bones, wrist, palmBasis, palmSpan, bounds }`.
- `mapMediaPipePoseToAsset(pose, rig, options) -> { joints, rotations, wristQuaternion, finite }`.
- `FirstPersonHand.setTarget(target)`, `FirstPersonHand.applyPose(pose, delta)`, and `FirstPersonHand.setReachAcquired(boolean)`.

- [ ] **Step 1: Write failing retarget tests.** Use the checked-in real GLBs to assert a rest-equivalent pose preserves bounds, mapped wrist-relative points stay inside bounded scale, `-Z` follows each segment, tip frames inherit distal orientation, and no transform becomes NaN. Add fake-camera tests proving left/right forearm anchors start below and outside the screen center.
- [ ] **Step 2: Run focused retarget tests.**

  Run: `npm test -- tests/hand-retarget.test.js tests/first-person-hand.test.js`

  Expected: FAIL because current code writes raw MediaPipe positions and maps the root around the screen center.
- [ ] **Step 3: Implement the pure rest-space mapper.** Cache every asset joint's authored position/quaternion. Build MediaPipe palm frames from wrist/index-middle-pinky points, use the calibrated wrist-relative similarity transform, synthesize missing metacarpals from each asset's own rest offsets, and construct desired joint frames with WebXR `-Z`/`-Y` axes. Apply one rest-relative rotation and one mapped armature-local position per flat WebXR joint; remove the extra curl multiplication.
- [ ] **Step 4: Implement the first-person presentation.** Attach a hand presentation root to the camera with left/right lower-edge anchors, clamp the real hand to the acquired reach corridor, blend the focused world contact point over 150 ms, and keep the tracked wrist rotation/finger curls intact. When the hand is not acquired or is lost, retract/fade from the last stable transform. Load a licensed CC0 forearm GLB if its node/skin audit passes; otherwise keep the hand fallback hidden beyond the lower edge rather than ship an unlicensed or broken mesh.
- [ ] **Step 5: Re-run real-asset deformation tests.**

  Run: `npm test -- tests/hand-retarget.test.js tests/first-person-hand.test.js`

  Expected: PASS with no large bind-bound expansion, no fragmented skeleton, correct left/right anchors, and stable loss fade.
- [ ] **Step 6: Commit.**

  Run: `git add src/desktop/hand-retarget.js src/desktop/FirstPersonHand.js public/assets/hands tests/hand-retarget.test.js tests/first-person-hand.test.js; git commit -m "fix: retarget hand in calibrated asset space"`

### Task 6: Integrate continuous pose rendering and target-aware task ownership

**Files:**
- Modify: `src/desktop/HandTrackingDirector.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/FoundPhoneDirector.js`
- Modify: `src/desktop/DoorDefenseDirector.js`
- Test: `tests/hand-tracking-director.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- `HandTrackingDirector.setTarget(targetOrNull)` updates the current contact snapshot and clears stale gesture candidates.
- `HandTrackingDirector.update(delta)` always updates the visual hand when a fresh pose exists, regardless of task owner.
- Task directors consume `snapshot(context)` with `reachEligible`, target identity, and stable pose state.

- [ ] **Step 1: Write failing integration tests.** Assert a tracked lower-entry pose renders during exploration, an upper-only pose stays retracted, target changes clear a candidate, found-phone UI only remains active during held grab, and door progress pauses rather than completes when reach or confidence is lost.
- [ ] **Step 2: Run focused integration tests.**

  Run: `npm test -- tests/hand-tracking-director.test.js tests/desktop-app.test.js tests/found-phone-director.test.js tests/door-defense-director.test.js`

  Expected: FAIL where director currently lacks target context and applies poses without reach ownership.
- [ ] **Step 3: Implement director integration.** Pass target snapshots from DesktopApp, keep visual updates independent from task ownership, pass target/focus epoch/reach eligibility into the gate, and ensure `handleHandGesture()` dispatches the expected target ID. Keep phone and door task ownership mutually exclusive.
- [ ] **Step 4: Re-run focused integration tests.**

  Run: `npm test -- tests/hand-tracking-director.test.js tests/desktop-app.test.js tests/found-phone-director.test.js tests/door-defense-director.test.js`

  Expected: PASS with existing touch and gyro tests unchanged.
- [ ] **Step 5: Commit.**

  Run: `git add src/desktop/HandTrackingDirector.js src/desktop/DesktopApp.js src/desktop/FoundPhoneDirector.js src/desktop/DoorDefenseDirector.js tests/hand-tracking-director.test.js tests/desktop-app.test.js tests/found-phone-director.test.js tests/door-defense-director.test.js; git commit -m "feat: integrate target-aware continuous hand poses"`

### Task 7: Full regression, visual evidence, and public HTTPS deployment

**Files:**
- Verify all modified runtime/test files.
- Modify: `public/assets/hands/FOREARM-SOURCE.md` only if the final accepted asset provenance needs an exact URL or notice.

**Interfaces:**
- Consumes: all green focused suites and production bundles.
- Produces: a verified public HTTPS URL serving the updated desktop and controller builds.

- [ ] **Step 1: Run the complete test suite.**

  Run: `npm test`

  Expected: all test files pass, including the pre-existing gyro, flashlight, touch, phone, door, and Socket.IO suites.
- [ ] **Step 2: Build production assets.**

  Run: `npm run build`

  Expected: Vite succeeds and `dist` contains the MediaPipe task/WASM, both hand GLBs, the accepted forearm asset if used, desktop bundle, controller bundle, and worker/vision resources.
- [ ] **Step 3: Start a production server on port 4176 and verify local routes.**

  Verify HTTP 200 for `/`, `/controller?room=617042`, `/assets/hands/left.glb`, `/assets/hands/right.glb`, `/assets/mediapipe/hand_landmarker.task`, and `/socket.io/` polling.
- [ ] **Step 4: Run browser smoke checks.**

  Use Chrome/Playwright to capture retracted, lower-entry, focused-sink, grab, tracking-loss, and door-brace states. Assert the canvas is nonblank, the hand pixels connect to a lower screen edge, no upper-entry pose triggers an action, and the controller requests rear-camera permission only.
- [ ] **Step 5: Keep a temporary Cloudflare HTTPS tunnel alive.**

  Start the tunnel against the verified port, record its URL, and re-check the same routes through HTTPS. Do not claim real-device gesture success unless the paired mobile/desktop smoke test observes the expected landmark frames and interaction acknowledgements.
- [ ] **Step 6: Commit only any provenance/test fixture update.**

  Run: `git status --short`; preserve the unrelated `.release/` directory and commit only files belonging to this feature.

