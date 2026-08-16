# Wrist Entry And Angle Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left GLB arm follow the real MediaPipe wrist and moving viewport entry while matching the right flashlight wrist to the supplied dorsum-facing reference without changing palm or finger shape.

**Architecture:** Keep the existing MediaPipe protocol and GLB skeletons. The desktop left renderer will map `pose.landmarks[0]` to a camera-local wrist target, solve a reachable shoulder-side boundary endpoint, and pass both endpoints to the existing arm adapter. The adapter will preserve the wrist position and use the tracked palm normal for forearm roll. The right renderer will keep the authored `grab.R` child-bone pose, aim the arm diagonally, and rotate only `handR` into an explicit camera-relative palm frame.

**Tech Stack:** JavaScript ES modules, Three.js 0.178, GLTFLoader, Vitest 3.2, Vite 6.1, existing Socket.IO deployment.

## Global Constraints

- Use `pose.landmarks[0]` as the left wrist anchor; use `pose.center` only for scale, confidence, semantics, and legacy fallback.
- Preserve existing immediate tracked/lost visibility, MediaPipe sampling, handedness, Socket.IO protocol, village, NPC, voice, and environment behavior. Keep the active public origin unless a host shutdown has left its quick tunnel with zero active connections.
- Preserve authored `grab.R`, palm silhouettes, thumb/finger local rotations, finger curl/spread ranges, flashlight grip, and sleeve materials.
- Keep all solved vectors/quaternions finite and normalized; invalid values fall back to the previous finite pose or bounded lower-left direction.
- Write a failing regression before every production behavior change and run it to confirm the expected failure.
- Do not restart a healthy `cloudflared`; if its metrics show zero active connections after a host shutdown, replace only that dead tunnel. Restart the Node application only after a successful build if deployment verification needs it.
- Respect the user's checkpoint preference: keep the existing filesystem backup and design commit, then create one scoped implementation commit/tag after all tests and deployment checks.
- Do not stage unrelated dirty village, NPC, environment, asset, or voice files.

## File Map

- Modify `src/desktop/FirstPersonHand.js` for camera wrist anchoring and dynamic left boundary entry.
- Modify `src/desktop/hand-asset-adapter.js` for exact wrist root positioning and tracked forearm roll.
- Modify `src/desktop/RightHandFlashlight.js` for diagonal arm direction and geometry-derived `handR` frame.
- Modify `tests/first-person-hand.test.js` for rendered wrist and viewport-entry regressions.
- Modify `tests/hand-asset-adapter.test.js` for forearm roll and endpoint constraints.
- Modify `tests/right-hand-flashlight.test.js` for reference-frame, diagonal-entry, and authored-child preservation regressions.
- Modify `.visual-check/left-hand-rewrite.mjs` so browser verification moves the real wrist landmark instead of only changing the legacy palm center.
- Keep `src/shared/hand-pose.js`, controller files, scene wiring, and transport files unchanged unless a focused regression proves a required compatibility fix.

---

### Task 1: Add Failing Left Wrist And Entry Tests

**Files:**
- Modify: `tests/first-person-hand.test.js`

**Interfaces:**
- Consumes: `FirstPersonHand`, `deriveHandFeatures`, `openHand`, the real `psx-arms.glb` test loader, and a `PerspectiveCamera`.
- Produces: regression coverage that fails against the current `pose.center` anchor, clamp plateaus, and adapter wrist drift.

- [x] **Step 1: Add a real wrist-anchor regression**

Add a test beside the existing tracked-arm tests. Derive a valid left pose,
copy its landmarks, and compare two poses that keep landmark 0 fixed while
changing only `center`:

```js
it("anchors the rendered wrist to landmark zero instead of the palm center", async () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 10);
  const hand = new FirstPersonHand({ camera, loader: assetLoader() });
  await hand.load();
  const tracked = deriveHandFeatures(openHand({
    physicalHandedness: "Left",
    inputMirrored: true,
  }));
  const landmarks = tracked.landmarks.map((point) => ({ ...point }));
  const first = { ...tracked, center: [0.22, 0.34, 0], landmarks };
  const second = { ...tracked, center: [0.78, 0.84, 0], landmarks };

  hand.applyPose(first, 1);
  const firstWrist = hand.presentationBones.handL.getWorldPosition(new THREE.Vector3());
  hand.applyPose(second, 1);
  const secondWrist = hand.presentationBones.handL.getWorldPosition(new THREE.Vector3());

  expect(secondWrist.distanceTo(firstWrist)).toBeLessThan(0.02);
});
```

The test must use the real GLB bones so it catches root/model recentering rather
than only checking a helper return value.

- [x] **Step 2: Add a moving-landmark and boundary-entry regression**

Add a small test helper that projects the shoulder and wrist into NDC and finds
the first segment intersection with the rectangle `[-1, 1] x [-1, 1]`.
Apply poses with landmark 0 at `[0.30, 0.58]` and `[0.70, 0.58]`, while keeping
their palm center and finger landmarks valid. Assert the rendered wrist moves
in the same horizontal direction and the arm entry x coordinate changes by at
least `0.15` NDC. Also assert the entry is on the left or bottom edge and the
nearest shoulder sleeve vertices remain below `-1.02` NDC.

```js
expect(rightWrist.x).toBeGreaterThan(leftWrist.x);
expect(Math.abs(rightEntry.x - leftEntry.x)).toBeGreaterThan(0.15);
expect(["left", "bottom"]).toContain(leftEntry.edge);
expect(["left", "bottom"]).toContain(rightEntry.edge);
expect(leftSleeveEdge).toBeLessThan(-1.02);
expect(rightSleeveEdge).toBeLessThan(-1.02);
```

- [x] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/first-person-hand.test.js
```

Expected failure: the fixed landmark-zero test moves because the current
renderer reads `center`, and the boundary-entry delta is below `0.15` or the
rendered wrist is not anchored to the requested camera hand.

### Task 2: Implement Left Wrist Anchor And Reachable Entry

**Files:**
- Modify: `src/desktop/FirstPersonHand.js`
- Modify: `src/desktop/hand-asset-adapter.js`
- Test: `tests/first-person-hand.test.js`

**Interfaces:**
- Consumes: finite normalized camera landmarks, the active camera, and the
  existing `presentationAdapters.left` adapter.
- Produces: `mapTrackedWristToCameraPosition(point, scale)` and
  `solveTrackedShoulderEntry(camera, wristTarget, wristUv, palmUv, maxLength)`
  as module-local helpers, plus a mapped result whose `rootPosition` equals
  the requested wrist target when endpoints are valid.

- [x] **Step 1: Add the camera-local endpoint helpers**

Replace the current `center`-named mapping with a wrist-specific mapping. Keep
the depth clamp but remove the lower-image plateau:

```js
function mapTrackedWristToCameraPosition(point, relativeScale = 1) {
  const x = Number.isFinite(point?.[0]) ? point[0] : 0.5;
  const y = Number.isFinite(point?.[1]) ? point[1] : 0.72;
  const scale = Number.isFinite(relativeScale) ? relativeScale : 1;
  return new THREE.Vector3(
    clamp(-0.46 + (x - 0.5) * 0.82, -0.78, 0.12),
    clamp(-0.38 + (0.62 - y) * 1.15, -0.86, 0.34),
    clamp(-0.68 + (scale - 1) * 0.12, -0.82, -0.56),
  );
}
```

Implement `solveTrackedShoulderEntry` using camera projection rather than a
fixed x/y shoulder point:

```js
function solveTrackedShoulderEntry(camera, wristTarget, wristUv, palmUv, maxLength) {
  const fallback = new THREE.Vector2(-0.72, -0.69);
  const outward = new THREE.Vector2(
    (wristUv?.[0] ?? 0.5) - (palmUv?.[0] ?? 0.5),
    (palmUv?.[1] ?? 0.62) - (wristUv?.[1] ?? 0.72),
  );
  const direction = outward.lengthSq() > 1e-6 ? outward.normalize() : fallback;
  direction.lerp(fallback, 0.35).normalize();

  const worldWrist = camera.localToWorld(wristTarget.clone());
  const wristNdc = worldWrist.clone().project(camera);
  const ndcStep = camera.localToWorld(wristTarget.clone().add(new THREE.Vector3(direction.x, direction.y, 0)))
    .project(camera).sub(wristNdc);
  if (ndcStep.lengthSq() < 1e-8) return wristTarget.clone().add(new THREE.Vector3(-0.42, -0.42, 0));
  ndcStep.normalize();
  const candidates = [];
  if (ndcStep.x < 0) candidates.push((-1 - wristNdc.x) / ndcStep.x);
  if (ndcStep.y < 0) candidates.push((-1 - wristNdc.y) / ndcStep.y);
  const validCandidates = candidates.filter(Number.isFinite);
  if (!validCandidates.length) {
    return wristTarget.clone().add(new THREE.Vector3(-0.42, -0.42, 0));
  }
  const boundaryDistance = Math.max(0.05, Math.min(...validCandidates));
  const boundary = wristNdc.clone().addScaledVector(ndcStep, boundaryDistance);
  const outside = boundary.addScaledVector(ndcStep, 0.16);
  const shoulderWorld = new THREE.Vector3(outside.x, outside.y, wristNdc.z).unproject(camera);
  const shoulderTarget = camera.worldToLocal(shoulderWorld);
  const delta = shoulderTarget.clone().sub(wristTarget);
  if (delta.length() > maxLength) {
    shoulderTarget.copy(wristTarget).add(delta.setLength(maxLength));
  }
  return shoulderTarget;
}
```

The implementation must guard the empty `candidates` case with the bounded
fallback before calling `Math.min`.

- [x] **Step 2: Use landmark 0 and recompute the entry after contact blending**

In `FirstPersonHand.applyPose`, obtain the wrist and palm fallback values:

```js
const wristUv = finitePoint(pose.landmarks?.[0] ?? pose.center);
const palmUv = finitePoint(pose.center ?? wristUv);
const desired = mapTrackedWristToCameraPosition(wristUv, scale);
```

Keep the existing contact target interpolation, then compute `maxLength` from
the active adapter's `restArmLength * scale * 1.2` and call
`solveTrackedShoulderEntry` with the final `desired`. Pass both endpoints to
`mapJoints`. This prevents contact blending from leaving the shoulder solver
behind the wrist solver.

- [x] **Step 3: Make the adapter preserve the wrist endpoint**

In `createArmRigAdapter.mapJoints`, keep the existing arm-length clamp and
chain translation scaling, but change the valid-endpoint root result to:

```js
const rootPosition = hasEndpoints
  ? wristTarget.clone()
  : wristTarget;
```

The endpoint solver already limits the shoulder target to the reachable range.
The root must not be recomputed from an overlong shoulder vector, because that
is the code path that currently pulls the rendered hand away from the camera
wrist.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/first-person-hand.test.js
```

Expected: the wrist-anchor, moving-entry, arm-length, and existing sleeve
continuity tests pass. If the existing neutral viewport tests need updated
numeric fixtures, update only their expected camera-space bounds, not the
behavioral assertions.

### Task 3: Distribute Left Palm Roll Through The Forearm

**Files:**
- Modify: `tests/hand-asset-adapter.test.js`
- Modify: `src/desktop/hand-asset-adapter.js`

**Interfaces:**
- Consumes: `displayPoseBasis(pose)` and the solved endpoint direction.
- Produces: a `rootQuaternion` whose forearm roll follows the tracked palm
  normal while the mapped `handL` reaches the same target palm frame.

- [x] **Step 1: Replace the fixed-normal regression**

Change the existing test that currently requires identical root quaternions for
two palm orientations. Keep endpoints and finger curls identical, rotate the
pose basis around the forearm, and assert:

```js
expect(turned.rootQuaternion.angleTo(neutral.rootQuaternion)).toBeGreaterThan(0.15);
expect(turned.rootQuaternion.angleTo(neutral.rootQuaternion)).toBeLessThan(Math.PI - 0.05);
expect(turned.transforms["f_index01L"].quaternion.angleTo(neutral.transforms["f_index01L"].quaternion))
  .toBeLessThan(1e-6);
```

Also preserve the existing achieved-palm alignment assertions for both poses.

- [x] **Step 2: Run the adapter test and verify RED**

Run:

```powershell
npx vitest run tests/hand-asset-adapter.test.js
```

Expected failure: the old fixed `[0, 0, -1]` normal seed leaves the root
quaternion unchanged while the new regression requires bounded forearm roll.

- [x] **Step 3: Use the tracked display normal for endpoint frames**

In `mapJoints`, replace the endpoint branch:

```js
const forearmDirection = hasEndpoints
  ? endpointDirection.clone().normalize()
  : targetForearmDirection(displayBasis, pose);
const targetForearmQuaternion = frameQuaternion(
  forearmDirection,
  displayBasis.forward,
);
```

Leave all authored finger and palm child mapping code unchanged. The renderer's
existing 45 ms root damping supplies the temporal smoothing.

- [x] **Step 4: Run the adapter and renderer tests**

Run:

```powershell
npx vitest run tests/hand-asset-adapter.test.js tests/first-person-hand.test.js
```

Expected: all focused left tests pass, including finite-transform and
palm/dorsum regressions.

### Task 4: Add Failing Right Reference-Frame Tests

**Files:**
- Modify: `tests/right-hand-flashlight.test.js`

**Interfaces:**
- Consumes: the loaded `RightHandFlashlight` rig, the source `grab.R` clip,
  camera projection, and the existing flashlight/sleeve helpers.
- Produces: failures for the current edge-on wrist, vertical arm, and blind
  `Math.PI` correction while retaining all current grip tests.

- [x] **Step 1: Add palm-frame and diagonal-entry helpers**

Add helpers that compute the world axes after `rig.load()`:

```js
function referencePalmAxes(rig) {
  const lateral = rig.bones.palm01R.getWorldPosition(new THREE.Vector3())
    .sub(rig.bones.palm04R.getWorldPosition(new THREE.Vector3())).normalize();
  const longitudinal = ["palm01R", "palm02R", "palm03R", "palm04R"]
    .map((name) => rig.bones[name].getWorldPosition(new THREE.Vector3()))
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(0.25)
    .sub(rig.bones.handR.getWorldPosition(new THREE.Vector3())).normalize();
  return { lateral, longitudinal, normal: lateral.clone().cross(longitudinal).normalize() };
}
```

Reuse the viewport boundary helper from Task 1 for the shoulder-to-wrist line.

- [x] **Step 2: Add explicit reference assertions**

Add a test after the existing load test:

```js
const axes = referencePalmAxes(rig);
const cameraForward = camera.getWorldDirection(new THREE.Vector3());
expect(axes.normal.dot(cameraForward)).toBeGreaterThan(0.88);
expect(axes.longitudinal.x).toBeLessThan(-0.15);
expect(axes.longitudinal.y).toBeGreaterThan(0.65);
expect(entry.x - projectedWrist.x).toBeGreaterThan(0.16);
```

Add a second assertion that samples the final `grab.R` quaternion tracks for
every `palm*`, `thumb*`, and `f_*` bone and compares them with the loaded local
quaternions at the clip end. This proves only `handR` and the arm chain changed.

- [x] **Step 3: Run the right test and verify RED**

Run:

```powershell
npx vitest run tests/right-hand-flashlight.test.js
```

Expected failure: the current normal dot product is near `0.09` and the
bottom-entry horizontal delta is near `0.106` NDC. Existing flashlight, grip,
sleeve, bob, and disposal tests must remain green.

### Task 5: Implement The Right Reference Wrist And Diagonal Arm

**Files:**
- Modify: `src/desktop/RightHandFlashlight.js`
- Test: `tests/right-hand-flashlight.test.js`

**Interfaces:**
- Consumes: intact authored `grab.R` bones, `CAMERA_FORWARD`, and the retained
  skinned sleeve.
- Produces: a diagonal right arm, a dorsum-facing hand frame, a forward
  flashlight socket, and unchanged palm/finger local quaternions.

- [x] **Step 1: Replace conflicting fixed wrist constants**

Replace `RIGHT_ARM_TO_HAND_DIRECTION` with:

```js
const RIGHT_ARM_DIRECTION = new THREE.Vector3(-0.50, 0.84, -0.20).normalize();
const REFERENCE_HAND_LONGITUDINAL = new THREE.Vector3(-0.30, 0.95, 0).normalize();
const REFERENCE_HAND_LATERAL = new THREE.Vector3(-0.95, -0.30, 0).normalize();
```

Remove the `WRIST_DIRECTION` aiming pass and the blind `FIRST_PERSON_WRIST_ROTATION`
world-Y rotation. Keep a metadata object that records the reference axes rather
than a misleading `Math.PI` value.

- [x] **Step 2: Aim only the arm chain before setting the wrist frame**

Keep `aimBoneAtDirection` but update all three arm-chain calls to use
`RIGHT_ARM_DIRECTION`. Do not save and restore the hand quaternion in this
helper; the next step owns the final hand frame.

- [x] **Step 3: Rotate only `handR` into the reference frame**

After the arm chain is aimed, compute the current world palm basis from the
actual `palm01R`, `palm04R`, `handR`, and finger-root positions. Build the target
quaternion with `Matrix4.makeBasis(REFERENCE_HAND_LATERAL,
REFERENCE_HAND_LONGITUDINAL, CAMERA_FORWARD)` and apply the shortest world
delta to `handR` through its parent world quaternion. Do not assign any child
bone quaternion in this step.

Use this shape-preserving helper:

```js
function alignHandToReferenceFrame(root, hand, lateral, longitudinal, normal) {
  root.updateMatrixWorld(true);
  const current = new THREE.Matrix4().makeBasis(lateral, longitudinal, normal);
  const target = new THREE.Matrix4().makeBasis(
    REFERENCE_HAND_LATERAL,
    REFERENCE_HAND_LONGITUDINAL,
    CAMERA_FORWARD,
  );
  const currentWorld = new THREE.Quaternion().setFromRotationMatrix(current);
  const targetWorld = new THREE.Quaternion().setFromRotationMatrix(target);
  const worldDelta = targetWorld.multiply(currentWorld.invert()).normalize();
  const parentWorld = hand.parent.getWorldQuaternion(new THREE.Quaternion());
  hand.quaternion.premultiply(parentWorld.invert().multiply(worldDelta).multiply(parentWorld)).normalize();
  root.updateMatrixWorld(true);
}
```

The helper must normalize all input axes and fall back to the existing world
orientation if a measured axis is degenerate.

- [x] **Step 4: Recenter and build the flashlight after final wrist alignment**

Keep the existing `HAND_OFFSET_FROM_ROOT` recentering after the hand frame is
applied. Create/aim the flashlight socket only after this step, preserving the
existing camera-forward axis correction and grip contact.

- [x] **Step 5: Run the right test and verify GREEN**

Run:

```powershell
npx vitest run tests/right-hand-flashlight.test.js
```

Expected: the dorsum normal, diagonal entry, authored child quaternions,
flashlight aim, grip, sleeve, bob, and disposal assertions all pass.

### Task 6: Full Regression, Build, Deployment, And Final Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-wrist-entry-and-angle-correction.md` to mark completed steps and record verification.
- Do not modify unrelated source files.

**Interfaces:**
- Consumes: the passing left/right hand implementation and existing port 4176
  production server.
- Produces: verified build/deployment, a durable handoff note if needed, and
  one scoped implementation commit/tag.

- [x] **Step 1: Run the focused hand suite**

Run:

```powershell
npx vitest run tests/hand-pose.test.js tests/hand-asset-adapter.test.js tests/first-person-hand.test.js tests/right-hand-flashlight.test.js tests/media-pipe-hand-tracker.test.js tests/hand-pose-stream.test.js tests/left-hand-restore.test.js tests/protocol.test.js tests/controller-app.test.js tests/desktop-app.test.js
```

Expected: zero failures. Any failure outside the modified assertions must be
investigated before proceeding.

- [x] **Step 2: Run the full test suite and build**

Run:

```powershell
npm test
npm run build
```

Expected: the build exits `0`. Record any known unrelated environment-manifest
failure separately; focused hand tests remain all green.

- [x] **Step 3: Verify local and public endpoints**

Check `/`, `/api/config`, and `/api/runtime-diagnostic` on `http://127.0.0.1:4176`
and the public URL. Create and join one public Socket.IO room and confirm the
current room name/origin behavior remains unchanged. The previous quick tunnel
had zero active connections after the host shutdown, so only that dead
`cloudflared` process was replaced; the Node process and port 4176 stayed intact.

- [x] **Step 4: Review the scoped diff**

Run:

```powershell
git status --short
git diff --check
git diff --stat -- src/desktop/FirstPersonHand.js src/desktop/hand-asset-adapter.js src/desktop/RightHandFlashlight.js tests/first-person-hand.test.js tests/hand-asset-adapter.test.js tests/right-hand-flashlight.test.js
```

Confirm no unrelated file is staged and the public URL was not changed.

- [x] **Step 5: Create the single implementation checkpoint**

Stage only the three implementation files, three focused test files, the visual
verification script, and this plan document. Commit and tag once:

```powershell
git add -- .visual-check/left-hand-rewrite.mjs src/desktop/FirstPersonHand.js src/desktop/hand-asset-adapter.js src/desktop/RightHandFlashlight.js tests/first-person-hand.test.js tests/hand-asset-adapter.test.js tests/right-hand-flashlight.test.js docs/superpowers/plans/2026-08-15-wrist-entry-and-angle-correction.md
git diff --cached --check
git commit -m "fix: track wrist entry and reference hand angles"
git tag -a backup/wrist-entry-angle-fix-20260816 -m "Verified wrist entry and reference hand angle fix"
```

Do not stage the unrelated dirty worktree files.

## Verification Record

- Focused cross-module suite: 10 files, 326 tests passed on 2026-08-16.
- Full suite: 807 tests passed, 1 skipped, and 1 unrelated existing
  `environment-manifest` artifact hash assertion failed because the dirty
  ElderBoom GLB is 51,208,376 bytes instead of the tracked 67,260,616 bytes.
- Production build: Vite transformed 1,709 modules and exited 0.
- Browser verification: desktop and mobile short/long/palm captures passed;
  the left hand stayed visible for all 120 tracked frames and hid on the first
  lost frame. The right-hand desktop capture shows a continuous diagonal sleeve.
- Independent reviews: latest left and right reviews both passed.
- Deployment: local endpoints returned 200. The replacement quick tunnel at
  `https://craft-wiring-quebec-simon.trycloudflare.com` returned 200 for `/`,
  `/api/config`, and `/api/runtime-diagnostic`; public Socket.IO room create and
  controller join both acknowledged successfully.
- Filesystem checkpoint: `D:\蝴蝶效应\backups\corridor-617-before-wrist-entry-fix-20260815-211810`.

## Plan Self-Review

- Spec coverage: left wrist anchor, moving boundary entry, reachable length,
  forearm roll, right dorsum frame, diagonal arm, child-bone preservation,
  tests, build, public checks, backup, and scoped checkpoint are covered in
  Tasks 1-6.
- Completeness scan: no unfinished marker or unspecified implementation step is
  present; every behavior has a file, code shape, command, and expected result.
- Type consistency: `mapTrackedWristToCameraPosition` and
  `solveTrackedShoulderEntry` are module-local Three.js helpers; the adapter
  continues to consume `{ wristTarget, shoulderTarget }` and return
  `{ rootPosition, rootQuaternion, transforms }`; right helpers consume and
  return normalized `THREE.Vector3` axes.
- Scope: no controller, protocol, camera, environment, NPC, voice, or tunnel
  change is required by the confirmed root cause.
