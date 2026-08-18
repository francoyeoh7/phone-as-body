# Knock Video and Tracked-Hand Inventory Implementation Plan

> **For agentic workers:** Execute tasks sequentially with test-first changes and a review checkpoint after each task.

**Goal:** Add a resource-bounded MP4 knock presenter and a tracked-hand inventory swipe without changing the public tunnel or unrelated hand rendering.

**Architecture:** Keep `KnockDoorDirector` as the ownership/state boundary and add a disposable video presenter that falls back to the existing procedural path. Add a focused tracked-hand inventory gesture state machine beside `HandTrackingDirector`, routing committed IDs through existing `DesktopApp`, `InventoryState`, and UI APIs.

**Tech Stack:** Three.js, browser HTMLVideoElement, Vitest, Vite, Socket.IO hand-frame protocol.

## Global Constraints

- Keep the existing public tunnel URL and running Node/cloudflared processes unchanged.
- Do not add another camera capture or transmit raw video.
- Do not change left-hand palm/finger mapping, right-hand pose, or player movement outside the knock alignment window.
- Runtime video must be 1920x1080-or-smaller H.264/AAC and disposed on every terminal path.

---

### Task 1: Runtime media asset and knock presenter

**Files:**
- Create: `public/assets/cinematics/village-knock-grab-v1.mp4`
- Create: `public/assets/cinematics/village-knock-grab-v1.source.sha256`
- Modify: `src/desktop/KnockDoorDirector.js`
- Modify: `src/desktop/ui.js`, `src/desktop/styles.css`
- Test: `tests/knock-door-director.test.js`

- [x] Write failing lifecycle tests for video creation, alignment, ended cleanup, fallback, and exact pose restore.
- [x] Run the focused knock test and confirm the new lifecycle assertions fail against the procedural-only director.
- [x] Implement a single disposable video overlay and 0.42s alignment phase; preserve the old procedural path as fallback.
- [x] Run focused knock tests and confirm all pass.
- [x] Create the 1080p fast-start derivative from the supplied MP4, record its SHA-256, and verify duration is about five seconds.
- [x] Commit only the media/presenter/UI/test files.

### Task 2: Tracked-hand inventory swipe

**Files:**
- Create: `src/desktop/HandInventoryGesture.js`
- Modify: `src/desktop/HandTrackingDirector.js`, `src/desktop/DesktopApp.js`, `src/desktop/FirstPersonHand.js`
- Test: `tests/hand-inventory-gesture.test.js`, `tests/hand-tracking-director.test.js`, `tests/desktop-app.test.js`

- [x] Write failing tests for right-edge entry, leftward activation, cursor movement, stationary dwell commit, cancellation, and cinematic suppression.
- [x] Run them and confirm they fail before implementation.
- [x] Implement the bounded state machine and route commit to `InventoryState.equip`, `ui.closeInventory`, and the existing held-item presentation.
- [x] Run focused hand/inventory tests and confirm all pass.
- [x] Commit only the gesture/integration files and tests.

### Task 3: Resource-bounded verification and deployment

- [x] Run focused suites and the existing full suite, recording unrelated baseline failures separately.
- [x] Run `npm run build` once.
- [ ] Run one desktop visual capture and inspect canvas pixels/page errors. (Deferred: the handoff warns that the SwiftShader full-scene capture can shut down the workstation; the controller DOM path and prior hand reports are verified.)
- [x] Verify local/public HTTP 200, published bundle contains the new presenter, and cloudflared/Node PIDs are unchanged.
- [x] Create local recovery tags `backup/inventory-edge-ppt-complete-20260818` and `backup/knock-video-hand-inventory-complete-20260818`. (Not pushed; remote push was not requested.)

## Remaining physical checks

- Run the real-phone controller swipe once: the inventory must open from the
  right, the cursor must start at the right edge, reach the left edge on a
  full swipe, and commit the hovered item.
- Complete the existing left-hand real-phone checks in
  `docs/superpowers/notes/left-hand-rewrite-handoff.md`.
