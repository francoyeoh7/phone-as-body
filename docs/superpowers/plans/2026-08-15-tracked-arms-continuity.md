# Tracked Arms Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left tracked arm enter through a moving lower-left boundary and make the right flashlight hand point downward with a continuous sleeved arm that exits below the viewport.

**Architecture:** Keep the existing GLB skeletons and camera-relative rigs. Compute the left shoulder endpoint from each tracked wrist center, and repair the right rig by removing the whole-model roll and constructing its sleeve from intact source geometry.

**Tech Stack:** Three.js, MediaPipe-derived hand poses, Vitest, Vite, Socket.IO.

## Global Constraints

- Do not change MediaPipe recognition, hand presence timing, room protocol, environment content, NPC systems, or the Cloudflare address.
- Do not replace either hand skeleton or layer a procedural fake arm over the rig.
- Avoid headless WebGL capture because it previously caused machine shutdowns.

---

### Task 1: Dynamic Left Lower-Left Entry

**Files:**
- Modify: `src/desktop/FirstPersonHand.js`
- Test: `tests/first-person-hand.test.js`

**Interfaces:**
- Consumes: `pose.center`, the camera-space wrist target from `trackedWristToCameraPosition()`.
- Produces: `trackedShoulderToCameraPosition(center, wristTarget): THREE.Vector3` passed as `shoulderTarget` to the arm adapter.

- [x] Add a test that applies two tracked centers and asserts the shoulder positions differ by more than `0.06`, both shoulder-end sleeve rings project below `-1.02` NDC, and the entry remains in the lower-left half.
- [x] Run `npm test -- --run tests/first-person-hand.test.js` and verify the new assertion fails because both poses return the current fixed shoulder.
- [x] Add a bounded camera-space endpoint derived from wrist `x/y`, centered near `(-0.84, -0.90, -0.76)`, and pass it to `mapJoints()`.
- [x] Run the focused test and verify the dynamic-entry, bounded-length, and hidden-edge assertions pass.

### Task 2: Continuous Downward Right Flashlight Arm

**Files:**
- Modify: `src/desktop/RightHandFlashlight.js`
- Test: `tests/right-hand-flashlight.test.js`

**Interfaces:**
- Consumes: the authored `grab.R` animation, `createRealisticSleeve()`, `CAMERA_FORWARD`, and the intact retained right-side GLB mesh.
- Produces: a visible `RightSleeveShell` and `RightSleeveCuff`, a downward-projected hand, a forward flashlight socket, and an off-screen shoulder-end sleeve.

- [x] Add tests asserting the middle fingertip projects below the wrist, the flashlight axis still has dot product above `0.94` with camera forward, both upper-arm and forearm bones influence sleeve triangles, the skinned cuff remains visible, and the nearest shoulder-end sleeve vertices stay outside the viewport.
- [x] Run `npm test -- --run tests/right-hand-flashlight.test.js` and verify failures show the fingertip points upward, the cuff is hidden, and the upper sleeve is missing.
- [x] Remove the whole-model `-1.8` roll, retain the camera-aligned target frame, and record the hand-only `Math.PI` correction in model metadata.
- [x] Construct the realistic sleeve before any source geometry filtering, retain the intact anatomical mesh under its inflated clothing shell, remove the rigid wrist-cuff workaround, and keep the skinned cuff visible.
- [x] Keep the flashlight socket camera-forward and extend the actual shoulder, upper-arm, and forearm chain to move the skinned sleeve edge below the viewport.
- [x] Run the right-hand test and verify grip geometry, adult palm silhouette, material, continuity, downward orientation, and disposal all pass.

### Task 3: Regression, Deployment, and Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-tracked-arms-continuity.md` only to mark completed checkboxes if needed.

**Interfaces:**
- Consumes: the two repaired rigs and existing production server.
- Produces: a tested production bundle and one scoped Git checkpoint/tag.

- [x] Run the complete hand-related Vitest set, including `first-person-hand` and `right-hand-flashlight`, with zero failures.
- [x] Run `npm run build` and require exit code `0`.
- [x] Verify local and public `/` plus `/api/config` return `200`, then create and join one room through public Socket.IO.
- [x] Stage the plan, both hand implementations/tests, and only the minimal desktop/scene wiring required to load, update, clean up, and hide the replaced flashlight beam; commit once and tag it as `backup/both-arms-continuous-20260815`.
