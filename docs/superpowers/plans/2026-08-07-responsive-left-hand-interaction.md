# Responsive Physical Left-Hand Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make only a physically tracked left hand drive the desktop hand, ordinary grab interactions, sustained hand tasks, and target contact without regressing existing controls.

**Architecture:** CameraMotionDetector remains the rear-camera owner. MediaPipeHandTracker accepts only normalized physical-left candidates and emits latest-only derived frames. HandPoseStream exposes independently filtered visual and raw semantic poses; FirstPersonHand renders one left rig; HandGestureGate and HandTaskStateMachine consume the raw pose; PlayerController owns sticky anchor selection and occlusion, then propagates an epoch-bound contact intent through DesktopApp and HandTrackingDirector.

**Tech Stack:** JavaScript ES modules, MediaPipe Tasks Vision 1.0.1, Three.js 0.178, Vitest 3.2, Vite 6.1.

## Global Constraints

- Keep gyro view, virtual joystick, flashlight, full-screen touch, pairing, and mandatory motion permission unchanged.
- Rear camera only; raw video remains on the handset and never enters a hand frame.
- Reject physical-right samples before reach, transport, rendering, gesture classification, or task state.
- Render the left forearm from outside lower-left; do not occupy the flashlight side.
- Camera/model/tracking failure fades the hand and retains touch controls; pixel-motion has no hand authority.
- Prefer a worker when supported, retain a latest-only main-thread fallback, and never queue old frames.
- Preserve 500 ms action cooldown, phone three-second repickup delay, and existing door-defense sustained-progress rules.
- Do not alter village environment, scene assets, layout, lighting, collision, task locations, or manifests.
- Make local commits only; do not push.

---

## File Structure

- Modify src/shared/hand-pose.js, src/shared/hand-reach.js, src/shared/protocol.js for finite left-only pose validation, camera rotation, and continuous reach.
- Modify src/controller/MediaPipeHandTracker.js and src/controller/hand-tracking.worker.js for candidate selection, actual video-frame availability, absolute deadlines, and worker preference.
- Modify src/desktop/HandPoseStream.js, src/desktop/FirstPersonHand.js, and src/desktop/hand-asset-adapter.js for visual filtering and fixed-left independent phalanges.
- Modify src/desktop/HandGestureGate.js, src/shared/hand-task-state.js, and src/desktop/HandTrackingDirector.js for raw gesture semantics, grace, epochs, and candidate-gated contact.
- Modify src/shared/interaction.js, src/desktop/PlayerController.js, src/desktop/DesktopApp.js, and src/desktop/create-scene.js for anchor metadata, sticky focus, occlusion, and epoch propagation.
- Modify only matching current tests: hand-pose, hand-reach, protocol, media-pipe-hand-tracker, hand-tracking-worker, hand-pose-stream, first-person-hand, hand-asset-adapter, hand-gesture-gate, hand-task-state, hand-tracking-director, interaction, player-controller, desktop-app.

## Interfaces

~~~js
export function resolveCameraRotation({ videoWidth, videoHeight, trackRotation, screenAngle });
// 0 | 90 | 180 | 270; invalid dimensions throw RangeError.
export function selectPhysicalLeftCandidate(result);
// { index, label: "left", score } | null.
stream.sample(now);
// { state, fresh, opacity, pose, gesturePose, modeEpoch, seq, ageMs }.
hand.setTargetContact({ point, normal, epoch, engaged } | null);
gate.update(sample, now, target); // boolean confirmed grab
gate.isContactCandidate(targetEpoch); // boolean
chooseAssistedTarget(targets, cameraPosition, forward, options);
~~~

### Task 1: Canonical Left Pose and Rotation

**Files:** Modify src/shared/hand-pose.js, src/shared/hand-reach.js, src/shared/protocol.js. Test tests/hand-pose.test.js, tests/hand-reach.test.js, tests/protocol.test.js.

**Interfaces:** Input is 21 landmarks, inputMirrored, capture time, prior pose, video size, track rotation, and screen angle. Output is finite handedness: "left", continuous reachProgress, and status frames unchanged. Lower-left acquisition uses palm X 0.02..0.55, wrist Y >= 0.66, palm Y >= 0.52, at least 16/21 in-frame landmarks, and three frames spanning 120 ms.

- [ ] **Step 1: Write failing tests**

~~~js
it("rejects physical-right tracked envelopes but accepts status", () => {
  expect(protocol.isHandFrame(handFrame({ handedness: "right" }))).toBe(false);
  expect(protocol.isHandFrame({ version: 1, seq: 2, capturedAt: 1, modeEpoch: 0, state: "lost", reason: "no-hand" })).toBe(true);
});
it.each([
  [{ videoWidth: 1080, videoHeight: 1920, trackRotation: 0, screenAngle: 0 }, 0],
  [{ videoWidth: 1920, videoHeight: 1080, trackRotation: 0, screenAngle: 90 }, 90],
  [{ videoWidth: 1920, videoHeight: 1080, trackRotation: 0, screenAngle: 270 }, 270],
])("normalizes displayed rear-camera rotation", (input, expected) => expect(resolveCameraRotation(input)).toBe(expected));
it("keeps normal reach but rejects a teleport", () => {
  const previous = deriveHandFeatures(openHand({ physicalHandedness: "Left", capturedAt: 0 }));
  expect(deriveHandFeatures(openHand({ physicalHandedness: "Left", capturedAt: 66, translate: [0.05, 0, 0] }), previous).trackingConfidence).toBeGreaterThanOrEqual(0.62);
  expect(deriveHandFeatures(openHand({ physicalHandedness: "Left", capturedAt: 66, translate: [0.95, 0, 0] }), previous).trackingConfidence).toBeLessThan(0.48);
});
~~~

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/hand-pose.test.js tests/hand-reach.test.js tests/protocol.test.js

Expected: FAIL: missing resolveCameraRotation, right frames validate, binary post-acquisition reach, and normal motion confidence is too low.

- [ ] **Step 3: Implement minimal behavior**

~~~js
export function resolveCameraRotation({ videoWidth, videoHeight, trackRotation, screenAngle }) {
  const cardinal = [0, 90, 180, 270];
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0) throw new RangeError("video dimensions must be positive");
  return ((cardinal.includes(trackRotation) ? trackRotation : 0) + (cardinal.includes(screenAngle) ? screenAngle : 0)) % 360;
}
~~~

Rotate normalized and world landmarks once before derivation. Combine evidence, coverage, scale continuity, and a temporal outlier gate: displacement over 0.30 + 2.4 * palmSpan is invalid; normal 15 Hz motion remains at least 0.62. Reset reach/calibration on rotation change. Acquire only when palm X is 0.02..0.55, wrist Y >= 0.66, palm Y >= 0.52, coverage is at least 16/21, and three valid frames span 120 ms. After acquisition compute continuous reach from 65 percent calibrated palm-span depth increase plus 35 percent wrist travel upward from the entry baseline; clamp the weighted result to 0..1 and smooth only this reach scalar over 45 ms. Horizontal movement must not change reachProgress. Protocol accepts tracked frames only when handedness is left, while lost/unavailable remain valid.

- [ ] **Step 4: Verify success**

Run: npm test -- tests/hand-pose.test.js tests/hand-reach.test.js tests/protocol.test.js

Expected: PASS, including finite geometry, mirrored-label, raw-media, and status tests.

- [ ] **Step 5: Commit**

Run: git add src/shared/hand-pose.js src/shared/hand-reach.js src/shared/protocol.js tests/hand-pose.test.js tests/hand-reach.test.js tests/protocol.test.js; git commit -m "feat: require physical left hand frames"

Expected: one local commit; no push.

### Task 2: Latest-Only Rear-Camera Scheduler

**Files:** Modify src/controller/MediaPipeHandTracker.js and src/controller/hand-tracking.worker.js. Test tests/media-pipe-hand-tracker.test.js and tests/hand-tracking-worker.test.js.

**Interfaces:** Input is rear video, getScreenOrientation(), candidates, video frame metadata, scheduler, and worker dependencies. Output is one left frame per completed inference or a rate-limited status. Preserve epochs, suspend/resume, GPU-to-CPU fallback, bitmap closure, numHands: 1, and main-thread fallback.

- [ ] **Step 1: Write failing tests**

~~~js
it("drops physical-right candidate before reach and transport", () => {
  const { tracker, callbacks } = setup(); tracker.active = true; tracker.modeEpoch = 1;
  tracker.handleResult({ result: handResult({ label: "Left" }), capturedAt: 20 });
  expect(callbacks.onFrame).not.toHaveBeenCalledWith(expect.objectContaining({ state: "tracked" }));
  expect(tracker.reachState.acquired).toBe(false);
});
it("uses remaining absolute deadline after 45ms inference", () => {
  const { tracker, scheduler } = setup({ worker: false, sampleIntervalMs: 1000 / 15 });
  tracker.nextSampleDeadline = 66.6667; scheduler.now.mockReturnValue(45); tracker.scheduleFromDeadline();
  expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), expect.closeTo(21.6667, 3));
});
~~~

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/media-pipe-hand-tracker.test.js tests/hand-tracking-worker.test.js

Expected: FAIL: high-confidence right candidate is selected, full interval follows inference, and worker is not preferred.

- [ ] **Step 3: Implement scheduler and selection**

~~~js
export function selectPhysicalLeftCandidate(result) {
  return (result?.landmarks ?? []).map((landmarks, index) => {
    const category = result.handedness?.[index]?.[0];
    return { index, label: normalizeMediaPipeHandedness(category?.categoryName, false), score: Number(category?.score) || 0, landmarks };
  }).filter((candidate) => candidate.label === "left").sort((a, b) => b.score - a.score)[0] ?? null;
}
scheduleFromDeadline(now = this.scheduler.now()) {
  while (this.nextSampleDeadline <= now) this.nextSampleDeadline += this.sampleIntervalMs;
  this.schedule(this.nextSampleDeadline - now);
}
~~~

Set deadline on activation and advance from prior deadline. Use requestVideoFrameCallback only after presentedFrames advances, else the absolute timer. Drop a frame while inferencePending. Default to bundled worker when Worker, OffscreenCanvas, and createImageBitmap exist. Inject screen orientation, combine it with live video dimensions/track rotation, and clear calibration on changes. Worker returns only landmarks/worldLandmarks/handedness.

- [ ] **Step 4: Verify success**

Run: npm test -- tests/media-pipe-hand-tracker.test.js tests/hand-tracking-worker.test.js

Expected: PASS, including no-getUserMedia, front-camera, stale epoch, error, bitmap closure, and fallback tests.

- [ ] **Step 5: Commit**

Run: git add src/controller/MediaPipeHandTracker.js src/controller/hand-tracking.worker.js tests/media-pipe-hand-tracker.test.js tests/hand-tracking-worker.test.js; git commit -m "feat: schedule latest physical left hand frames"

Expected: one local commit; no push.

### Task 3: Visual and Semantic Pose Split

**Files:** Modify src/desktop/HandPoseStream.js, src/desktop/HandGestureGate.js, src/shared/hand-task-state.js. Test tests/hand-pose-stream.test.js, tests/hand-gesture-gate.test.js, tests/hand-task-state.test.js.

**Interfaces:** Stream returns visual pose and raw gesturePose. Gate and task state read gesturePose ?? pose and require left/reachEligible input.

- [ ] **Step 1: Write failing tests**

~~~js
it("rejects right tracked frames without replacing visual left pose", () => {
  const stream = new HandPoseStream();
  stream.accept(pose({ handedness: "left", seq: 1, receivedAt: 0 }));
  expect(stream.accept(pose({ handedness: "right", seq: 2, receivedAt: 66 }))).toBe(false);
  expect(stream.sample(66).pose.handedness).toBe("left");
});
it("renders wrist response within 180ms but retains raw pinch", () => {
  const stream = new HandPoseStream({ wristTimeConstantMs: 60 });
  stream.accept(pose({ handedness: "left", seq: 1, receivedAt: 0, center: [0, 0, 0] }));
  stream.accept(pose({ handedness: "left", seq: 2, receivedAt: 180, center: [1, 0, 0], pinchStrength: 0.9 }));
  expect(stream.sample(180).pose.center[0]).toBeGreaterThanOrEqual(0.9);
  expect(stream.sample(180).gesturePose.pinchStrength).toBe(0.9);
});
~~~

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/hand-pose-stream.test.js tests/hand-gesture-gate.test.js tests/hand-task-state.test.js

Expected: FAIL: right competition remains, no gesturePose exists, and low confidence clears a candidate immediately.

- [ ] **Step 3: Implement filter and grace**

~~~js
return { state: "tracked", fresh: true, opacity: this.visualOpacity(now),
  pose: clone(this.visualPose), gesturePose: clone(this.rawPose),
  modeEpoch: this.lastFrame.modeEpoch, seq: this.lastFrame.seq, ageMs };
const pose = sample?.gesturePose ?? sample?.pose;
const valid = sample?.state === "tracked" && sample?.fresh === true
  && pose?.handedness === "left" && pose?.reachEligible === true;
~~~

Filter wrist center/orientation at adaptive 42-68 ms, finger joints at 28 ms, and retain raw curls/open/pinch/grab semantics. Gate uses median of newest three raw strengths with enter 0.64, exit 0.46, candidate 160 ms, three fresh frames, focus 100 ms, gap 120 ms, cooldown 500 ms. Set task loss grace to 120 ms and do not let loss/release synthesize success.

- [ ] **Step 4: Verify success**

Run: npm test -- tests/hand-pose-stream.test.js tests/hand-gesture-gate.test.js tests/hand-task-state.test.js

Expected: PASS, including stale frame, opacity, pinch-only, release, calibration, and sustained brace tests.

- [ ] **Step 5: Commit**

Run: git add src/desktop/HandPoseStream.js src/desktop/HandGestureGate.js src/shared/hand-task-state.js tests/hand-pose-stream.test.js tests/hand-gesture-gate.test.js tests/hand-task-state.test.js; git commit -m "feat: separate hand visuals from gestures"

Expected: one local commit; no push.

### Task 4: Fixed Left Rig and Candidate-Gated Contact

**Files:** Modify src/desktop/FirstPersonHand.js, src/desktop/hand-asset-adapter.js, src/desktop/HandTrackingDirector.js. Test tests/first-person-hand.test.js, tests/hand-asset-adapter.test.js, tests/hand-tracking-director.test.js.

**Interfaces:** setTargetContact consumes point, normal, epoch, engaged. It renders a neutral lower-left left hand until the matching target epoch is a candidate.

- [ ] **Step 1: Write failing tests**

~~~js
it("loads only left model even when supplied pose says right", async () => {
  const hand = new FirstPersonHand({ camera: new THREE.Group(), loader: assetLoader() });
  await hand.load(); hand.applyPose({ ...leftPose(), handedness: "right", trackingConfidence: 1 }, 0.016);
  expect(hand.handedness).toBe("left"); expect(hand.models.right).toBeUndefined();
});
it("does not reach contact until matching epoch is candidate", async () => {
  const hand = await loadedHandAtCamera();
  hand.setTargetContact({ point: [0.2, 0.1, -1], normal: [0, 0, 1], epoch: 8, engaged: false });
  hand.applyPose(leftPose({ reachEligible: true, reachProgress: 1 }), 0.2); const neutral = hand.root.position.clone();
  hand.setTargetContact({ point: [0.2, 0.1, -1], normal: [0, 0, 1], epoch: 8, engaged: true });
  hand.applyPose(leftPose({ reachEligible: true, reachProgress: 1 }), 0.2);
  expect(hand.root.position.distanceTo(neutral)).toBeGreaterThan(0.15);
});
~~~

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/first-person-hand.test.js tests/hand-asset-adapter.test.js tests/hand-tracking-director.test.js

Expected: FAIL: two hands load/switch and focus/reach alone drives contact.

- [ ] **Step 3: Implement fixed-left presentation**

~~~js
const left = await loadOne("/assets/hands/left.glb");
this.models.left = this.cloneScene(left.scene ?? left.scenes?.[0]);
this.boneSets.left = discoverBones(this.models.left);
this.adapters.left = createFlatWebXRAdapter(this.boneSets.left, "left");
this._activateModel("left");
const contactActive = pose.handedness === "left" && pose.reachEligible === true
  && this.targetContact?.engaged === true;
~~~

Remove right-model and competing-handedness paths. Keep neutral anchor (-0.42, -0.42, -0.68) within x [-0.62, -0.16], y [-0.62, -0.20], z [-0.82, -0.56]. Only contactActive uses the point offset 4 cm by normal and reachProgress. Preserve tracked wrist and per-phalanx mapping; reject non-finite transforms. Director increments target epoch on ID change/focus clear and republishes engaged from gate.isContactCandidate(epoch).

- [ ] **Step 4: Verify success**

Run: npm test -- tests/first-person-hand.test.js tests/hand-asset-adapter.test.js tests/hand-tracking-director.test.js

Expected: PASS, including hierarchy, independent curl, finite transforms, fade, exploration, and task lifecycle tests.

- [ ] **Step 5: Commit**

Run: git add src/desktop/FirstPersonHand.js src/desktop/hand-asset-adapter.js src/desktop/HandTrackingDirector.js tests/first-person-hand.test.js tests/hand-asset-adapter.test.js tests/hand-tracking-director.test.js; git commit -m "feat: render responsive physical left hand"

Expected: one local commit; no push.

### Task 5: Sticky Anchor Aim Assist and Occlusion

**Files:** Modify src/shared/interaction.js, src/desktop/PlayerController.js, src/desktop/DesktopApp.js, src/desktop/create-scene.js. Test tests/interaction.test.js, tests/player-controller.test.js, tests/desktop-app.test.js.

**Interfaces:** Interactable metadata is interaction = { anchor, contactRadius, maxUseDistance, approachDirection }. Target event is { id, focused, epoch, contactPoint, contactNormal, focusedAt }.

- [ ] **Step 1: Write failing tests**

~~~js
it("keeps current near-equal target but rejects its occluded anchor", () => {
  const targets = [
    { id: "fuse", enabled: true, visible: true, anchor: { x: 0.05, y: 1.6, z: -1.4 }, contactRadius: 0.22, maxUseDistance: 2.35, occluded: false },
    { id: "panel", enabled: true, visible: true, anchor: { x: 0.04, y: 1.6, z: -1.45 }, contactRadius: 0.22, maxUseDistance: 2.35, occluded: false },
  ];
  expect(chooseAssistedTarget(targets, camera, forward, { currentId: "fuse" })?.id).toBe("fuse");
  targets[0].occluded = true;
  expect(chooseAssistedTarget(targets, camera, forward, { currentId: "fuse" })?.id).toBe("panel");
});
it("rejects hand grab with stale target epoch", () => {
  app.handleTargetFocus({ id: "fuse", focused: true, epoch: 12, contactPoint: { x: 0, y: 1, z: -1 }, contactNormal: { x: 0, y: 0, z: 1 }, focusedAt: 40 });
  expect(app.handleHandGesture({ type: "grab", targetId: "fuse", targetEpoch: 11 })).toBe(false);
});
~~~

- [ ] **Step 2: Verify failure**

Run: npm test -- tests/interaction.test.js tests/player-controller.test.js tests/desktop-app.test.js

Expected: FAIL: root-origin ranking has no hysteresis/occlusion and authorization checks only ID.

- [ ] **Step 3: Implement anchor ranking and occlusion**

~~~js
export function chooseAssistedTarget(targets, cameraPosition, forward, {
  currentId = null, maxDistance = 2.6, minAlignment = 0.84, hysteresisScore = 0.08,
} = {}) {
  // Exclude disabled, hidden, occluded, distant, and invalid-approach anchors.
  // Rank alignment then distance; retain currentId inside hysteresisScore.
}
entry.interaction ??= { anchor: entry.interactionAnchor ?? entry.root,
  contactRadius: 0.22, maxUseDistance: 2.35, approachDirection: null };
~~~

Return static occluder roots from createScene and pass to PlayerController. Raycast camera-to-anchor; an occluder nearer than anchor distance minus contactRadius blocks selection. Preserve direct-interactable raycast priority and existing capped aim-assist strength/rate. Increment targetEpoch only on ID change/focus clear; forward it to director; require target ID and epoch match before player.interact("hand").

- [ ] **Step 4: Verify success**

Run: npm test -- tests/interaction.test.js tests/player-controller.test.js tests/desktop-app.test.js

Expected: PASS, including raycast normals, prompt/halo, aim-assist rate, gyro settings, joystick fallback, target-focus event, and valid hand routing.

- [ ] **Step 5: Commit**

Run: git add src/shared/interaction.js src/desktop/PlayerController.js src/desktop/DesktopApp.js src/desktop/create-scene.js tests/interaction.test.js tests/player-controller.test.js tests/desktop-app.test.js; git commit -m "feat: bind left hand contact to visible targets"

Expected: one local commit; no push.

### Task 6: Regression and Device Verification

**Files:** Verify only source/tests from Tasks 1-5. Do not modify village/environment assets, manifests, layout, task locations, MotionController, joystick code, flashlight rig, or touch UI.

- [ ] **Step 1: Run full suite**

Run: npm test

Expected: PASS with hand, protocol, controller, interaction, motion, joystick, flashlight, and task-director suites.

- [ ] **Step 2: Build**

Run: npm run build

Expected: PASS with dist output and no missing MediaPipe model/WASM or left-hand GLB errors.

- [ ] **Step 3: Verify retained controls**

Run: npm run dev

Expected: local URL; gyro view, virtual joystick, flashlight, and touch/click interaction continue working when tracking is unavailable.

- [ ] **Step 4: Paired rear-camera acceptance**

Expected: right never renders/activates; left needs lower-left three-frame acquisition; portrait/90/270 preserve authority; neutral hand stays lower-left; focus alone never contacts; candidate grasp contacts/triggers once; walls occlude focus; 100-120 ms loss freezes/pauses; sustained loss fades; phone release keeps its delay; and door brace follows current sustained-loss rules.

- [ ] **Step 5: Inspect worktree**

Run: git status --short

Expected: only intended changes and explicit verification evidence; no push.

## Plan Self-Review

**Spec coverage:** Physical-left selection before state/transport, exact lower-left acquisition in portrait and both landscapes, depth/vertical continuous reach that is invariant under horizontal movement, fixed latest-only cadence, worker fallback, motion tolerance, visual/semantic filters, independent fixed-left phalanges, candidate-gated contact, shared hysteresis/grace, sustained tasks, sticky anchor focus, occlusion, target epochs, and non-blocking camera failure are covered. Village work is deliberately excluded.

**Placeholder scan:** No unresolved placeholder or undefined interface appears. Every task names paths, concrete tests, red/green commands, thresholds, and a local commit boundary.

**Type consistency:** Transport permits only left; sample.pose is visual and sample.gesturePose semantic; targetEpoch flows PlayerController to DesktopApp to HandTrackingDirector to gate/hand to final authorization.

Plan complete and saved to docs/superpowers/plans/2026-08-07-responsive-left-hand-interaction.md. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task with review between tasks.
2. Inline Execution - execute the tasks in this session with checkpoints.
