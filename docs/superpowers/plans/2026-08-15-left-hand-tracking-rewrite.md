# Left-Hand Tracking Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstable left-hand path with immediate camera-presence rendering, correct palm/dorsum orientation, and camera-driven arm length.

**Architecture:** Keep `MediaPipeHandTracker` as the controller boundary and replace its candidate/loss lifecycle with an idle/tracking state machine. Make `HandPoseStream` a visibility-neutral interpolator, then derive wrist placement, palm orientation, and arm-chain extension in the existing Three.js hand adapter and renderer. Preserve reliable Socket.IO transport and the current public controller origin.

**Tech Stack:** JavaScript ES modules, MediaPipe Tasks Vision 1.0.1, Three.js 0.178, Socket.IO 4.8, Vitest 3.2, Vite 6.1, Playwright over the existing CDP test browser.

**Status:** Implementation and automated verification are complete. The final
real-phone observation remains, and the durable results are recorded in
`docs/superpowers/notes/left-hand-rewrite-handoff.md`.

## Global Constraints

- A valid physical left hand appears on the first valid inference result.
- The first inference result with no hand hides the render immediately; there is no visual freeze or fade.
- A temporary handedness-label flip cannot interrupt an already tracked spatially continuous left hand.
- A right hand cannot acquire tracking from idle.
- Confidence continues to gate gestures but never visual existence.
- Camera coordinates convert to Three.js exactly once as `(x, -y, -z)`.
- The arm enters from the lower-left and changes length without stretching the palm or fingers.
- Keep reliable Socket.IO hand transport and keep the current public URL unchanged.
- Do not modify village, NPC, voice, right-hand flashlight, environment, or public-origin behavior.
- User preference overrides frequent-commit guidance: use the existing design checkpoint and one final verified Git commit only.

## File Map

- `src/controller/ControllerApp.js`: selects the verified real-phone camera handedness convention.
- `src/controller/MediaPipeHandTracker.js`: owns inference scheduling, left-hand acquisition/retention, immediate loss, and frame emission.
- `src/shared/hand-pose.js`: derives one canonical left-hand basis from world landmarks.
- `src/desktop/HandPoseStream.js`: orders and smooths valid poses; clears visual state immediately on loss.
- `src/desktop/HandTrackingDirector.js`: passes visual state to the renderer while leaving gesture confidence gates intact.
- `src/desktop/hand-asset-adapter.js`: converts palm basis and computes arm direction, chain extension, and dynamic wrist offset.
- `src/desktop/FirstPersonHand.js`: maps camera wrist position, applies arm transforms, and hides immediately on loss.
- `tests/media-pipe-hand-tracker.test.js`: tracker state-machine regression coverage.
- `tests/left-hand-restore.test.js`: real rear-camera convention and reliable transport contract.
- `tests/hand-pose.test.js`: palm/dorsum canonical basis coverage.
- `tests/hand-pose-stream.test.js`: low-confidence visibility and immediate loss coverage.
- `tests/hand-asset-adapter.test.js`: palm normal and arm-chain extension coverage.
- `tests/first-person-hand.test.js`: renderer placement, bone length, and immediate hide coverage.
- `.visual-check/left-hand-rewrite.mjs`: browser sequence and screenshot verification.
- `docs/superpowers/notes/left-hand-rewrite-handoff.md`: durable recovery checkpoint.

---

### Task 1: Controller Acquisition, Retention, And Immediate Loss

**Files:**
- Modify: `tests/media-pipe-hand-tracker.test.js`
- Modify: `tests/left-hand-restore.test.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/MediaPipeHandTracker.js`

**Interfaces:**
- Consumes: MediaPipe result shape `{ landmarks, worldLandmarks, handedness }`.
- Produces: `selectPhysicalLeftCandidate(result, previous, inputMirrored)` and protocol-compatible `tracked`/`lost` frames.

- [ ] **Step 0: Create the pre-implementation filesystem backup**

Create `D:\蝴蝶效应\backups\corridor-617-before-left-hand-rewrite-<timestamp>`
and copy the controller, shared pose/protocol, desktop hand modules, focused
tests, design, and plan into their relative paths. Record file count, total
bytes, and SHA-256 hashes in the backup directory. Do not stop or restart the
running Node or cloudflared processes.

- [ ] **Step 1: Write failing acquisition and retention tests**

Add tests equivalent to:

```js
it("acquires the verified rear-camera left label on the first result", () => {
  const { tracker, callbacks } = setup({ inputMirrored: true });
  tracker.active = true;
  tracker.modeEpoch = 1;
  tracker.handleResult({ result: handResult({ label: "Left" }), capturedAt: 20 });
  expect(callbacks.onFrame).toHaveBeenLastCalledWith(expect.objectContaining({
    state: "tracked", handedness: "left",
  }));
});

it("retains the same visible candidate through one handedness label flip", () => {
  const { tracker, callbacks } = setup({ inputMirrored: true });
  tracker.active = true;
  tracker.modeEpoch = 1;
  tracker.handleResult({ result: handResult({ label: "Left" }), capturedAt: 20 });
  tracker.handleResult({ result: handResult({ label: "Right" }), capturedAt: 87 });
  expect(callbacks.onFrame.mock.calls.filter(([frame]) => frame.state === "tracked")).toHaveLength(2);
  expect(callbacks.onFrame.mock.calls.at(-1)[0].handedness).toBe("left");
});
```

- [ ] **Step 2: Write the failing immediate-loss and right-hand tests**

```js
it("emits lost on the first empty result and clears the tracking lock", () => {
  const { tracker, callbacks } = setup({ inputMirrored: true });
  tracker.active = true;
  tracker.modeEpoch = 1;
  tracker.handleResult({ result: handResult({ label: "Left" }), capturedAt: 20 });
  tracker.handleResult({ result: { landmarks: [] }, capturedAt: 87 });
  expect(callbacks.onFrame.mock.calls.at(-1)[0]).toMatchObject({ state: "lost", capturedAt: 87 });
  expect(tracker.previous).toBeNull();
});

it("does not acquire a physical right hand from idle", () => {
  const { tracker, callbacks } = setup({ inputMirrored: true });
  tracker.active = true;
  tracker.modeEpoch = 1;
  tracker.handleResult({ result: handResult({ label: "Right" }), capturedAt: 20 });
  expect(callbacks.onFrame).not.toHaveBeenCalledWith(expect.objectContaining({ state: "tracked" }));
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/media-pipe-hand-tracker.test.js tests/left-hand-restore.test.js
```

Expected: the new rear-camera, label-flip, and immediate-loss assertions fail against the current strict selector and 250 ms loss delay.

- [ ] **Step 4: Implement the minimal tracker state machine**

Use a canonical label for retained left frames and emit loss on transition:

```js
function canonicalMediaPipeLeft(inputMirrored) {
  return inputMirrored ? "Left" : "Right";
}

export function selectPhysicalLeftCandidate(result, previous, inputMirrored = true) {
  const candidates = (result?.landmarks ?? []).map((points, index) => ({
    index,
    points,
    center: points?.[0] ? [points[0].x, points[0].y, points[0].z ?? 0] : null,
    category: result?.handedness?.[index]?.[0],
  })).filter((candidate) => candidate.center);
  if (!candidates.length) return null;
  if (!previous) {
    return candidates.find((candidate) => (
      normalizeMediaPipeHandedness(candidate.category?.categoryName, inputMirrored) === "left"
    )) ?? null;
  }
  return candidates.sort((left, right) => (
    distance2D(left.center, previous.center) - distance2D(right.center, previous.center)
  ))[0] ?? null;
}
```

In `handleResult`, replace a retained mismatched raw category with the canonical
left category before calling `deriveHandFeatures`. Replace the 250 ms loss gate
with one transition emission and remove tracked-frame status scheduling.

Set `inputMirrored: true` explicitly in `ControllerApp` because this is the
verified real-device convention, not an inferred browser default.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Task 1 command again. Expected: all tracker and restoration tests pass.

---

### Task 2: Visual Pose Continuity And Immediate Clear

**Files:**
- Modify: `tests/hand-pose-stream.test.js`
- Modify: `tests/first-person-hand.test.js`
- Modify: `src/desktop/HandPoseStream.js`
- Modify: `src/desktop/FirstPersonHand.js`
- Confirm unchanged behavior: `src/desktop/HandGestureGate.js`
- Confirm unchanged behavior: `src/desktop/HeldEquipmentGate.js`

**Interfaces:**
- Consumes: ordered protocol hand frames with `receivedAt`.
- Produces: stream samples `{ state, pose, gesturePose, opacity, fresh }`.

- [ ] **Step 1: Write failing low-confidence visual test**

```js
it("renders every structurally valid tracked frame regardless of confidence", () => {
  const stream = new HandPoseStream();
  stream.accept(pose({ seq: 1, receivedAt: 0, center: [0, 0, 0] }));
  stream.accept(pose({ seq: 2, receivedAt: 67, trackingConfidence: 0.25, center: [1, 0, 0] }));
  const sample = stream.sample(67);
  expect(sample).toMatchObject({ state: "tracked", fresh: true, opacity: 1 });
  expect(sample.pose.center[0]).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Write failing immediate-clear tests**

```js
it("returns zero opacity on an explicit lost frame", () => {
  const stream = new HandPoseStream();
  stream.accept(pose({ seq: 1, receivedAt: 0 }));
  stream.accept(pose({ seq: 2, receivedAt: 67, state: "lost" }));
  expect(stream.sample(67)).toMatchObject({ state: "lost", opacity: 0, fresh: false });
});

it("hides the rendered hand in the same lost update", () => {
  const hand = loadedHandFixture();
  hand.applyPose({ ...openHandPose(), opacity: 1, state: "tracked" }, 0.016);
  hand.applyPose({ state: "lost", opacity: 0 }, 0.016);
  expect(hand.opacity).toBe(0);
  expect(hand.root.visible).toBe(false);
});
```

- [ ] **Step 3: Run tests and verify RED**

```powershell
npx vitest run tests/hand-pose-stream.test.js tests/first-person-hand.test.js
```

Expected: current confidence freezing, freeze/fade opacity, and renderer loss fade violate the new assertions.

- [ ] **Step 4: Implement visual rules**

In `HandPoseStream.accept`, call `acceptTracked` for every valid left tracked
frame. In `sample`, return tracked/fresh for all tracked frames, preserve raw
confidence for gesture consumers, return opacity zero for explicit loss, and
use a 150 ms silence watchdog only when no new transport frame arrives.

In `FirstPersonHand.applyPose`, replace the loss fade branch with:

```js
if (lost) {
  this.lossActive = true;
  this.lossFadeElapsed = 0;
  this.lossFadeStartOpacity = 0;
  this._setOpacity(0);
  return this;
}
```

Do not change confidence thresholds in the gesture and equipment gates.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 2 command again. Expected: stream and renderer tests pass.

---

### Task 3: Canonical Palm/Dorsum Basis

**Files:**
- Modify: `tests/hand-pose.test.js`
- Modify: `tests/hand-asset-adapter.test.js`
- Modify: `src/shared/hand-pose.js`
- Modify: `src/desktop/hand-asset-adapter.js`

**Interfaces:**
- Consumes: 21 camera and world landmarks plus canonical physical handedness.
- Produces: exported `derivePhysicalLeftPalmBasis(worldLandmarks)` returning
  `{ right, up, forward }`, canonical `pose.wrist`, and a mapped authored palm
  quaternion.

- [ ] **Step 1: Write failing palm-versus-dorsum tests**

Import the wished-for `derivePhysicalLeftPalmBasis` API. Build a canonical
physical-left world landmark set, then build a dorsum set by rotating every
point 180 degrees around the wrist-to-middle-MCP longitudinal axis. Assert the
derived `forward` vectors have dot product below `-0.95`. Map poses containing
both bases through `createArmRigAdapter` and assert the achieved authored palm
normals also have dot product below `-0.95`.

```js
expect(dot(palmBasis.forward, dorsumBasis.forward)).toBeLessThan(-0.95);
expect(achievedPalmNormal.dot(achievedDorsumNormal)).toBeLessThan(-0.95);
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npx vitest run tests/hand-pose.test.js tests/hand-asset-adapter.test.js
```

Expected: the test module fails because `derivePhysicalLeftPalmBasis` is not
exported by the current implementation.

- [ ] **Step 3: Implement one canonical basis conversion**

Implement `derivePhysicalLeftPalmBasis` in `hand-pose.js` from wrist/middle and
index/pinky metric landmarks. Use it after controller acquisition has already
canonicalized the sample as physical left; do not re-normalize handedness in
the basis function. Keep `displayPoseBasis` as the only camera-to-Three
conversion and remove any second palm-normal negation from arm-root
calculations.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 3 command again. Expected: hand-pose and adapter tests pass with
opposite palm/dorsum normals and finite orthonormal bases.

---

### Task 4: Camera-Driven Arm Length

**Files:**
- Modify: `tests/hand-asset-adapter.test.js`
- Modify: `tests/first-person-hand.test.js`
- Modify: `src/desktop/hand-asset-adapter.js`
- Modify: `src/desktop/FirstPersonHand.js`

**Interfaces:**
- Consumes: camera-local `wristTarget`, fixed `shoulderTarget`, pose basis, and apparent palm scale.
- Produces: `{ transforms, rootQuaternion, palmScale, armLengthScale, handOffset }`.

- [ ] **Step 1: Write failing arm-length tests**

Create near-entry and center-screen poses. Assert:

```js
expect(longArm.armLengthScale).toBeGreaterThan(shortArm.armLengthScale);
expect(longArm.handOffset.distanceTo(shortArm.handOffset)).toBeGreaterThan(0.05);
expect(longArm.palmScale).toBeCloseTo(shortArm.palmScale, 6);
```

After renderer application, assert the shoulder-to-hand world distance grows
while a palm metacarpal segment length remains unchanged apart from palm scale.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npx vitest run tests/hand-asset-adapter.test.js tests/first-person-hand.test.js
```

Expected: current adapter returns only uniform `scale` and cannot independently change arm-chain length.

- [ ] **Step 3: Implement endpoint kinematics and chain extension**

Add a camera-local wrist mapping in `FirstPersonHand` and pass the endpoint
geometry to the adapter. In the adapter, record rest translations for
`upper_arm`, `forearm`, and `hand`, compute:

```js
const armLengthScale = clamp(targetLength / restArmLength, 0.68, 1.38);
const dynamicHandPosition = restShoulderPosition.clone().add(
  restHandPosition.clone().sub(restShoulderPosition).multiplyScalar(armLengthScale),
);
```

Return position transforms that multiply only those arm-chain translations.
Set `presentationModel.position` from `handOffset * -palmScale` after applying
transforms so the wrist stays centered on the tracked endpoint. Keep authored
finger transforms and palm scale independent of `armLengthScale`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 4 command again. Expected: adapter and renderer tests pass for
short/long arm, stable hand dimensions, finite transforms, and wrist centering.

---

### Task 5: Integration, Browser Sequence, Recovery, And Deployment

**Files:**
- Create: `.visual-check/left-hand-rewrite.mjs`
- Create: `docs/superpowers/notes/left-hand-rewrite-handoff.md`
- Modify only if a regression requires it: `tests/protocol.test.js`

**Interfaces:**
- Consumes: built application, existing server on port 4176, existing CDP browser, existing public URL.
- Produces: screenshots, transform report, durable recovery note, and final verified Git checkpoint.

- [ ] **Step 1: Run the complete focused hand suite**

```powershell
npx vitest run tests/hand-pose.test.js tests/media-pipe-hand-tracker.test.js tests/left-hand-restore.test.js tests/hand-pose-stream.test.js tests/hand-asset-adapter.test.js tests/first-person-hand.test.js tests/protocol.test.js tests/controller-app.test.js tests/desktop-app.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run broader regression tests and production build**

```powershell
npm test
npm run build
```

Record any known pre-existing unrelated failures separately. The focused hand
suite and production build must have zero failures.

- [ ] **Step 3: Build the browser sequence verifier**

The Playwright script must inject sequential frames through the real desktop
hand entry point, capture palm and dorsum screenshots, capture short and long
arm screenshots, inject lost, and report:

```js
{
  pageErrors: [],
  trackedVisible: true,
  lostVisible: false,
  palmDorsumNormalDot: Number,
  shortArmLength: Number,
  longArmLength: Number,
  nonBlankPixels: Number,
}
```

Assert `palmDorsumNormalDot < -0.9`, `longArmLength > shortArmLength`,
`nonBlankPixels > 1000`, and zero page errors.

- [ ] **Step 4: Run browser verification on desktop and mobile landscape**

```powershell
node .visual-check/left-hand-rewrite.mjs
```

Expected: exit 0, both viewports nonblank, no overlap, no page errors, correct
visible/lost state, opposite palm/dorsum normals, and increasing arm length.

- [ ] **Step 5: Rebuild/restart only the Node application and preserve tunnel**

Do not restart `cloudflared`. Restart the production Node process on port 4176
only after the build passes. Verify local and public root/controller/config
responses return 200 and public config still names:

```text
https://gras-wherever-classic-tire.trycloudflare.com
```

- [ ] **Step 6: Write the recovery handoff**

Record the design commit/tag, files changed, focused/full test counts, build
result, screenshot paths, Node/cloudflared PIDs, public URL, filesystem backup
path, and the single remaining real-phone verification checklist.

- [ ] **Step 7: Create the final Git checkpoint**

Stage only the left-hand rewrite, its tests, verifier, plan, and handoff. Review
`git diff --cached --stat` and `git diff --cached --check`, then create one
final commit and annotated backup tag. Do not stage unrelated dirty files.
