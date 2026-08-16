# Palm Jitter Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize visible left-palm position and angle without reducing gesture recognition sensitivity or deliberate motion response.

**Architecture:** Keep `gesturePose` raw and introduce a visual-only wrist anchor in `HandPoseStream`. Apply continuous soft dead zones before the existing adaptive smoothing, then make `FirstPersonHand` consume the visual wrist while retaining its legacy fallback.

**Tech Stack:** JavaScript, Three.js, Vitest, Vite, Playwright visual checks

## Global Constraints

- Do not change hand appearance/disappearance timing.
- Do not filter or delay `gesturePose`.
- Do not change fingers, rear-camera dorsum calibration, arm entry/length, right hand, transport, or the public tunnel.
- A deliberate movement must complete most of its response within about 132 ms.
- Use one final implementation commit rather than frequent intermediate commits.

---

### Task 1: Visual Palm Stream Stabilization

**Files:**
- Modify: `tests/hand-pose-stream.test.js`
- Modify: `src/desktop/HandPoseStream.js`

**Interfaces:**
- Consumes: tracked frames with `landmarks[0]`, `wrist`, `receivedAt`, and existing gesture fields
- Produces: `sample.pose.visualWrist: number[3]`; leaves `sample.gesturePose` raw

- [x] **Step 1: Write the failing stationary-jitter test**

Add a test that feeds alternating position noise below 0.008 and angular noise below 0.035 rad for repeated 15 Hz frames. Assert `pose.visualWrist` and `pose.wrist` stay at the initial visual anchor while `gesturePose.landmarks[0]` and `gesturePose.wrist` equal the latest raw frame.

- [x] **Step 2: Write the failing deliberate-motion test**

Feed a 0.10 position step and 15 degree wrist turn for two 66 ms intervals. Assert visual position advances at least 80 percent and visible rotation exceeds 0.19 rad by 132 ms, while `gesturePose` exposes the full raw target on the first frame.

- [x] **Step 3: Run the stream tests and verify RED**

Run: `npx vitest run tests/hand-pose-stream.test.js`

Expected: the new tests fail because `visualWrist` and continuous visual dead-zone behavior do not exist.

- [x] **Step 4: Implement continuous visual dead zones**

Add:

```js
const VISUAL_WRIST_DEAD_ZONE = 0.008;
const VISUAL_WRIST_ANGLE_DEAD_ZONE = 0.035;
```

Implement vector and quaternion soft-dead-zone helpers. Initialize `target.visualWrist` from `frame.landmarks[0]` with `center` fallback, dead-zone it against the prior visual wrist, add it to the wrist-smoothed fields, and apply the angular helper before wrist slerp. Do not alter `gesturePose`.

- [x] **Step 5: Run the stream tests and verify GREEN**

Run: `npx vitest run tests/hand-pose-stream.test.js`

Expected: all stream tests pass.

### Task 2: Render From The Visual Wrist

**Files:**
- Modify: `tests/first-person-hand.test.js`
- Modify: `src/desktop/FirstPersonHand.js`

**Interfaces:**
- Consumes: optional `pose.visualWrist`
- Produces: rendered wrist position driven by `visualWrist`, with `landmarks[0]` fallback

- [x] **Step 1: Write the failing render-anchor test**

Apply two poses with the same `visualWrist` and different raw `landmarks[0]`; assert the rendered wrist remains stable. Then change `visualWrist` and assert the rendered wrist follows it.

- [x] **Step 2: Run the hand test and verify RED**

Run: `npx vitest run tests/first-person-hand.test.js`

Expected: the rendered wrist follows raw landmark zero, so the stability assertion fails.

- [x] **Step 3: Use the visual wrist with fallback**

Change wrist selection to:

```js
const wristUv = finiteCameraPoint(pose.visualWrist ?? pose.landmarks?.[0], center);
```

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/hand-pose-stream.test.js tests/first-person-hand.test.js`

Expected: both files pass and existing compatibility tests remain green.

### Task 3: Verification And Backup

**Files:**
- Verify all files above
- Update no unrelated source files

- [x] **Step 1: Run the broader hand chain**

Run:

```text
npx vitest run tests/hand-pose.test.js tests/hand-pose-stream.test.js tests/media-pipe-hand-tracker.test.js tests/left-hand-restore.test.js tests/hand-tracking-director.test.js tests/hand-asset-adapter.test.js tests/first-person-hand.test.js tests/protocol.test.js
```

Expected: all hand-chain tests pass.

- [x] **Step 2: Build production assets**

Run: `npm run build`

Expected: Vite exits 0; existing Tailwind and chunk-size warnings are non-blocking.

- [x] **Step 3: Run visual/browser verification**

Run the existing left-hand visual check and confirm the canvas is nonblank, the hand remains continuously visible while tracked, explicit loss hides immediately, and the latest production bundle loads in the hardware-accelerated browser.

- [x] **Step 4: Review the scoped diff**

Confirm palm position/orientation are the only behavioral changes and that gesture, fingers, arms, right hand, transport, and public URL remain unchanged.

- [x] **Step 5: Commit and tag the key checkpoint**

Stage only the planned source, tests, and documents. Commit with `fix: stabilize visual palm tracking`, create `backup/palm-jitter-stabilized-20260816`, and push the branch and tag to GitHub.
