# Mobile Voice, Inventory, Crouch, and Held Equipment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bottom-region voice recording, a top-right inventory trackpad orb, held-item presentation, and a fast-down-hold crouch gesture without changing the existing gyroscope algorithm or weakening target-authorized hand interactions.

**Architecture:** Keep high-rate locomotion and crouch state in the existing sequenced controller input, keep ordered UI gestures in validated Socket.IO actions, and relay bounded completed voice clips through one dedicated binary event. Add focused controller modules for pointer ownership, voice hold, and orb drag; add desktop modules for inventory truth and untargeted held-item hysteresis. Existing task and target gates retain priority.

**Tech Stack:** JavaScript ES modules, Vitest, Socket.IO, MediaRecorder/getUserMedia, Three.js, Rapier, Lucide.

## Global Constraints

- Do not modify the existing gyroscope sampling, gain, fast-turn behavior, pitch suppression, smoothing, clutch, recenter logic, orientation payload, or camera selection.
- Rear-camera denial or hand-tracking failure must preserve gyro, movement, flashlight, and touch fallback.
- Voice uses a 420ms dwell, 14px slop, 10,000ms duration cap, 256KiB payload cap, and MIME base allowlist `audio/webm`, `audio/ogg`, `audio/mp4`.
- Voice is recorded and relayed only; no speech-to-text, intent classification, playback, persistence, or NPC response.
- Inventory movement is ordered, bounded, coalesced to at most 30Hz, and touch-modal; release outside a slot preserves the previous equipment.
- Crouch requires entry into the bottom region within 280ms, `dy >= 48px`, `abs(dx) <= 0.65 * dy`, then 180ms of hold.
- Semantic hand task > focused target and target epoch > untargeted equipped-item presentation.
- The first inventory item is `spare-fuse`; inventory starts empty, acquisition adds it, installation consumes it.
- Existing untracked `.release/` content is never staged, modified, or deleted.
- No GitHub push, Release upload, or public deployment without explicit authorization.

---

## File Structure

- `src/shared/protocol.js`: wire contracts, exact action validators, and voice binary limits.
- `server/session-registry.js`: room ownership, normalized input, voice ordering/rate state.
- `server/index.js`: validated relays only.
- `src/controller/ControllerSocket.js`: controller snapshots, ordered actions, voice clip sender.
- `src/desktop/PhoneSession.js`: trusted desktop-side snapshots and voice events.
- `src/controller/PointerOwnership.js`: pure pointer-owner state and generation invalidation.
- `src/controller/VoiceHoldController.js`: bottom-region dwell, permission, MediaRecorder, cancellation.
- `src/controller/InventoryOrbController.js`: relative orb capture and 30Hz delta coalescing.
- `src/controller/VirtualJoystick.js`: crouch candidate/hold substate only.
- `src/controller/ControllerApp.js`: module wiring and lifecycle cleanup.
- `src/desktop/InventoryState.js`: acquired, equipped, consumed, and transient hover truth.
- `src/desktop/HeldEquipmentGate.js`: untargeted grab/release hysteresis.
- `src/desktop/DesktopApp.js`: action priority and cross-module orchestration.
- `src/desktop/ui.js`: inventory bar, cursor, and recording indicator API.
- `src/desktop/PlayerController.js`: smooth crouch presentation and fallback keys.
- `src/desktop/FirstPersonHand.js`: render-only palm grip attachment.
- `src/desktop/create-scene.js`: detached held-fuse render model.
- `src/desktop/HorrorDirector.js`: inventory acquire/consume callbacks around story events.

---

### Task 1: Protocol And Session Transients

**Files:**
- Modify: `src/shared/protocol.js`
- Modify: `server/session-registry.js`
- Modify: `server/index.js`
- Modify: `src/controller/ControllerSocket.js`
- Modify: `src/desktop/PhoneSession.js`
- Test: `tests/protocol.test.js`
- Test: `tests/session-registry.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- Produces: `EVENTS.controllerVoiceClip`, `MAX_VOICE_DURATION_MS`, `MAX_VOICE_CLIP_BYTES`, `isVoiceClip(value)`, optional inbound `crouch`, normalized outbound `crouch: boolean`.
- Produces: validated controller actions `voice-recording` and `inventory-pointer`.
- Produces: `ControllerSocket.sendVoiceClip(clip): boolean` and desktop `voice-clip` event.
- Consumes: existing room ownership, controller input sequencing, and controller action relay.

- [ ] **Step 1: Write failing protocol tests**

Add cases that prove old input remains accepted, crouch must be boolean when supplied, action-specific keys are exact, inventory move deltas are finite and bounded, and raw/base64 media cannot enter controller actions.

```js
expect(isControllerInput({ ...validInput })).toBe(true);
expect(isControllerInput({ ...validInput, crouch: true })).toBe(true);
expect(isControllerInput({ ...validInput, crouch: "true" })).toBe(false);
expect(isControllerAction({ action: "voice-recording", active: true, sentAt: 10 })).toBe(true);
expect(isControllerAction({ action: "voice-recording", active: true, data: "raw" })).toBe(false);
expect(isControllerAction({ action: "inventory-pointer", phase: "move", dx: 12, dy: -4 })).toBe(true);
expect(isControllerAction({ action: "inventory-pointer", phase: "move", dx: 999, dy: 0 })).toBe(false);
```

- [ ] **Step 2: Run the protocol tests and verify RED**

Run: `npm test -- tests/protocol.test.js`

Expected: FAIL because the new event, actions, crouch field, and clip validator are absent.

- [ ] **Step 3: Implement exact shared validators**

Extend controller input without making `crouch` mandatory for older UE bridge packets. Normalize it at trust boundaries.

```js
export const MAX_VOICE_DURATION_MS = 10_000;
export const MAX_VOICE_CLIP_BYTES = 256 * 1024;
export const INVENTORY_DELTA_LIMIT = 96;

export function isVoiceClip(value) {
  const bytes = binaryByteLength(value?.data);
  const mime = String(value?.mimeType ?? "").split(";")[0].toLowerCase();
  return value?.version === 1
    && Number.isInteger(value.seq) && value.seq >= 0
    && Number.isFinite(value.durationMs) && value.durationMs > 0
    && value.durationMs <= MAX_VOICE_DURATION_MS
    && ["audio/webm", "audio/ogg", "audio/mp4"].includes(mime)
    && bytes > 0 && bytes <= MAX_VOICE_CLIP_BYTES;
}
```

Use per-action allowed-key sets. `inventory-pointer` accepts `open`, `commit`, and `cancel` without deltas; only `move` accepts `dx` and `dy` in `[-96, 96]`.

- [ ] **Step 4: Write failing registry and session tests**

Prove normalization, mutation safety, controller ownership, monotonic clip sequence, one-second rate limit, and reset on replacement/disconnect.

```js
expect(registry.acceptInput(code, "phone", { ...validInput, crouch: true }).room.input.crouch).toBe(true);
expect(registry.acceptVoiceClip(code, "intruder", validClip).reason).toBe("not-controller");
expect(registry.acceptVoiceClip(code, "phone", validClip).ok).toBe(true);
expect(registry.acceptVoiceClip(code, "phone", { ...validClip, seq: 0 }).reason).toBe("stale-voice");
```

- [ ] **Step 5: Run registry tests and verify RED**

Run: `npm test -- tests/session-registry.test.js`

Expected: FAIL because normalized crouch and clip acceptance do not exist.

- [ ] **Step 6: Implement normalized relays and client APIs**

`session-registry` stores only sequence and last accepted time, never audio bytes. Construct Socket.IO with `maxHttpBufferSize: 384 * 1024`, then have `server/index.js` relay the sanitized registry payload. `ControllerSocket` resets crouch on disconnect, replacement, and session end, and sends clips only over Socket.IO. `PhoneSession` validates clips again and dispatches `CustomEvent("voice-clip", { detail })`.

```js
sendVoiceClip(clip) {
  if (!this.joined || !this.socket?.connected || !isVoiceClip(clip)) return false;
  this.socket.emit(EVENTS.controllerVoiceClip, clip);
  return true;
}
```

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- tests/protocol.test.js tests/session-registry.test.js tests/desktop-app.test.js`

Expected: PASS.

Commit: `feat: add controller transient protocols`

---

### Task 2: Pointer Ownership And Crouch Recognition

**Files:**
- Create: `src/controller/PointerOwnership.js`
- Modify: `src/controller/VirtualJoystick.js`
- Modify: `src/controller/ControllerApp.js`
- Test: `tests/pointer-ownership.test.js`
- Test: `tests/virtual-joystick.test.js`
- Test: `tests/controller-app.test.js`

**Interfaces:**
- Produces: `PointerOwnership.claimGameplay`, `claimVoice`, `claimInventory`, `release`, `cancelAll`, and `inventoryModal`.
- Produces: VirtualJoystick options `canStart`, `isBottomPoint`, `onCrouchChange`.
- Consumes: Task 1 `ControllerSocket.setInput({ crouch })`.

- [ ] **Step 1: Write failing ownership tests**

```js
const owners = new PointerOwnership();
expect(owners.claimGameplay(1)).toBe(true);
expect(owners.claimVoice(2)).toBe(true);
expect(owners.claimInventory(3)).toMatchObject({ gameplay: 1, voice: 2 });
expect(owners.claimGameplay(4)).toBe(false);
owners.release("inventory", 3);
expect(owners.claimGameplay(4)).toBe(true);
```

Also assert generation changes on `cancelAll()` and stale releases cannot clear a newly reused pointer.

- [ ] **Step 2: Run ownership tests and verify RED**

Run: `npm test -- tests/pointer-ownership.test.js`

Expected: FAIL because `PointerOwnership` does not exist.

- [ ] **Step 3: Implement the pure ownership model**

Store one gameplay ID, one voice ID, one inventory ID, and a monotonically increasing generation. Inventory claim returns displaced IDs so `ControllerApp` can cancel their modules before capture changes.

- [ ] **Step 4: Write failing crouch boundary tests**

Use a fake clock and live bottom predicate. Cover the positive path and exact failures at 47px, 281ms, diagonal ratio above 0.65, 179ms hold, start-inside-band, task fallback, pointer cancel, and stale timer after reset.

```js
gesture.handleDown(pointer(1, 120, 120));
clock.advance(100);
gesture.handleMove(pointer(1, 122, 190));
clock.advance(180);
timers.runDue();
expect(onCrouchChange).toHaveBeenCalledWith(true);
expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
gesture.handleEnd(pointer(1, 122, 190));
expect(onCrouchChange).toHaveBeenLastCalledWith(false);
```

- [ ] **Step 5: Run joystick tests and verify RED**

Run: `npm test -- tests/virtual-joystick.test.js`

Expected: FAIL because crouch options and state are absent.

- [ ] **Step 6: Implement crouch as a joystick substate**

Preserve the existing tap, drag, observation, multitouch, and engagement behavior. Start a crouch hold timer only after a gameplay-owned pointer enters the bottom region within the timing/direction thresholds. On commit emit zero movement, then `onCrouchChange(true)`. Suppress later movement until release. Cleanup emits false at most once.

- [ ] **Step 7: Wire ownership and crouch snapshots in ControllerApp**

`ControllerApp` passes `canStart` and releases gameplay ownership from joystick reset. It includes `crouch` in `sendInput()`, disables crouch during door fallback, and clears crouch before existing pause/background/reorientation/destroy cleanup.

- [ ] **Step 8: Run focused tests and commit**

Run: `npm test -- tests/pointer-ownership.test.js tests/virtual-joystick.test.js tests/controller-app.test.js`

Expected: PASS with all existing joystick boundary tests unchanged.

Commit: `feat: add owned crouch gesture`

---

### Task 3: Bottom Voice Hold And Binary Clip Delivery

**Files:**
- Create: `src/controller/VoiceHoldController.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Test: `tests/voice-hold-controller.test.js`
- Test: `tests/controller-app.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- Produces: `VoiceHoldController.cancel({ discard })`, active callback, and clip callback.
- Consumes: `PointerOwnership.claimVoice/release`, `ControllerSocket.sendAction`, and `sendVoiceClip`.
- Produces UI method: `ui.setVoiceRecording(active)`.

- [ ] **Step 1: Write failing VoiceHoldController tests**

Inject `clock`, timer functions, `getUserMedia`, and a fake `MediaRecorder`. Cover permission preparation on pointer down, 420ms dwell, 14px slop, early release, leave-region, permission denial, normal send, 10-second auto-stop, oversized discard, and exactly-once inactive cleanup.

```js
controller.pointerDown(pointer(7, 100, 800));
expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
clock.advance(420);
await controller.flushPendingPermission();
expect(onActive).toHaveBeenCalledWith(true);
controller.pointerUp(pointer(7, 100, 800));
expect(onActive).toHaveBeenLastCalledWith(false);
expect(onClip.mock.calls[0][0].data.byteLength).toBeGreaterThan(0);
```

- [ ] **Step 2: Run voice tests and verify RED**

Run: `npm test -- tests/voice-hold-controller.test.js`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement voice hold and recorder cleanup**

Request audio synchronously from pointer down, but commit only when dwell, slop, region, permission, pointer ID, and generation all remain valid. Use `MediaRecorder.start(250)`, accumulate direct binary chunks, and reject an assembled clip over 256KiB. Stop all audio tracks after send or discard.

- [ ] **Step 4: Add phone voice region and desktop status indicator**

Add a bottom element with a Lucide microphone glyph and `height: clamp(68px, 12dvh, 96px)`. Its direct handlers stop propagation. Add a bottom-center desktop microphone glyph, hidden by default, with a restrained pulse and no instructional text.

```js
setVoiceRecording(active) {
  elements.voiceRecording.hidden = !active;
}
```

- [ ] **Step 5: Wire actions, clips, and lifecycle**

Only a committed recorder sends `voice-recording active:true`. Normal stop sends inactive before `sendVoiceClip`. Inventory, pause, background, disconnect, replacement, and destroy call `cancel({ discard: true })`. Desktop peer loss and pause call `setVoiceRecording(false)`.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/voice-hold-controller.test.js tests/controller-app.test.js tests/desktop-app.test.js`

Expected: PASS.

Commit: `feat: add held voice recording control`

---

### Task 4: Inventory Orb And Desktop Trackpad Bar

**Files:**
- Create: `src/controller/InventoryOrbController.js`
- Create: `src/desktop/InventoryState.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Test: `tests/inventory-orb-controller.test.js`
- Test: `tests/inventory-state.test.js`
- Test: `tests/controller-app.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- Produces: `InventoryOrbController.cancel()`, ordered `inventory-pointer` phases, and at-most-30Hz coalescing.
- Produces: `InventoryState.acquire(id)`, `equip(id)`, `consume(id)`, `setHovered(id)`, `snapshot()`.
- Produces UI methods: `setInventory(snapshot)`, `moveInventoryCursor(dx, dy)`, `inventoryItemAtCursor()`, `closeInventory()`.

- [ ] **Step 1: Write failing orb tests**

Prove open on down, capture, relative deltas, 30Hz coalescing, final flush before commit, cancel without commit, home transform after end, and modal callbacks in the correct order.

```js
orb.pointerDown(pointer(9, 350, 40));
expect(onOpen).toHaveBeenCalledOnce();
orb.pointerMove(pointer(9, 362, 46));
clock.advance(34);
timers.runDue();
expect(onMove).toHaveBeenCalledWith({ dx: 12, dy: 6 });
orb.pointerUp(pointer(9, 362, 46));
expect(order).toEqual(["open", "move", "commit", "release"]);
```

- [ ] **Step 2: Write failing InventoryState tests**

```js
const state = new InventoryState([{ id: "spare-fuse", enabled: true }]);
expect(state.snapshot().items).toEqual([]);
state.acquire("spare-fuse");
expect(state.equip("spare-fuse")).toBe(true);
state.consume("spare-fuse");
expect(state.snapshot()).toMatchObject({ items: [], equippedId: null, hoveredId: null });
```

- [ ] **Step 3: Run both test files and verify RED**

Run: `npm test -- tests/inventory-orb-controller.test.js tests/inventory-state.test.js`

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement the focused modules**

The orb sends bounded relative deltas and never decides selection. `InventoryState` rejects unknown/consumed IDs and returns immutable snapshots.

- [ ] **Step 5: Add phone orb and desktop inventory UI**

The 52px orb is top-right; settings shifts left. The desktop bar is top-center, contains only acquired item slots, owns a programmatic cursor, and has no nested cards or explanatory text. The cursor starts over equipped, first acquired, or empty center. `moveInventoryCursor` applies relative deltas within bounds and returns the hovered ID.

- [ ] **Step 6: Wire modal behavior and ordered actions**

Orb down claims inventory, cancels voice, resets joystick, and sends `open`. Moves send coalesced `move`. Normal release sends `commit`; desktop equips only the current enabled hovered item, then closes. Cancel sends `cancel` and preserves equipment. Reject opening before gameplay or during any cinematic/semantic task.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- tests/inventory-orb-controller.test.js tests/inventory-state.test.js tests/controller-app.test.js tests/desktop-app.test.js`

Expected: PASS.

Commit: `feat: add phone-driven inventory trackpad`

---

### Task 5: Smooth Desktop Crouch Presentation

**Files:**
- Modify: `src/desktop/PlayerController.js`
- Modify: `src/desktop/DesktopApp.js`
- Test: `tests/player-controller.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- Consumes: Task 1 normalized `phoneInput.crouch`.
- Produces: `PlayerController.setCrouching(active)`, `crouchAmount`, smooth eye offset and speed.

- [ ] **Step 1: Write failing player tests**

Assert standing defaults, monotonic crouch approach at 30/60/120fps, 0.55m to 0.20m eye range, 3.25m/s to 2.0m/s speed range, release recovery, Control/C fallback, and pose snapshot/restore.

```js
player.setCrouching(true);
for (let i = 0; i < 60; i += 1) player.update(1 / 60);
player.syncAfterPhysics();
expect(player.crouchAmount).toBeGreaterThan(0.98);
expect(camera.position.y - player.body.translation().y).toBeCloseTo(0.20, 2);
```

- [ ] **Step 2: Run player tests and verify RED**

Run: `npm test -- tests/player-controller.test.js`

Expected: FAIL because crouch state and presentation do not exist.

- [ ] **Step 3: Implement frame-rate-independent crouch**

Use `alpha = 1 - Math.exp(-delta / 0.12)`. Determine the target from fresh phone input or fallback keys, interpolate speed and eye offset, and leave the standing Rapier capsule unchanged. Reset crouch on pause, disconnect, and cinematic entry.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- tests/player-controller.test.js tests/desktop-app.test.js`

Expected: PASS.

Commit: `feat: add smooth player crouch presentation`

---

### Task 6: Acquired Fuse, Untargeted Hold Gate, And Palm Attachment

**Files:**
- Create: `src/desktop/HeldEquipmentGate.js`
- Modify: `src/desktop/HandTrackingDirector.js`
- Modify: `src/desktop/FirstPersonHand.js`
- Modify: `src/desktop/create-scene.js`
- Modify: `src/desktop/HorrorDirector.js`
- Modify: `src/desktop/DesktopApp.js`
- Test: `tests/held-equipment-gate.test.js`
- Test: `tests/hand-tracking-director.test.js`
- Test: `tests/first-person-hand.test.js`
- Test: `tests/horror-director.test.js`
- Test: `tests/desktop-app.test.js`

**Interfaces:**
- Produces: `HeldEquipmentGate.update(sample, now) -> "grab" | "release" | null`, `suppressUntilRelease()`, `reset()`.
- Produces: `FirstPersonHand.setHeldItem(object3D)`, `setHolding(active)`.
- Consumes: Task 4 `InventoryState` and existing raw gesture pose.

- [ ] **Step 1: Write failing hold-gate tests**

Require three fresh samples and 160ms above the grab threshold, then 120ms below the release threshold. Reject stale, low-confidence, lost, and single-frame changes. Prove `suppressUntilRelease()` blocks a carried grab until an open-hand release.

- [ ] **Step 2: Run hold-gate tests and verify RED**

Run: `npm test -- tests/held-equipment-gate.test.js`

Expected: FAIL because the gate does not exist.

- [ ] **Step 3: Implement hysteresis without changing HandGestureGate**

Read `sample.gesturePose ?? sample.pose`, require tracking confidence at least 0.62, and keep the existing target gate untouched. The new gate runs only when no semantic owner, target, pause, destruction, or cinematic suppression is active.

- [ ] **Step 4: Write failing hand attachment and priority tests**

Assert the held object attaches to a palm grip anchor, follows the left-hand rig, shares opacity/visibility, never carries `interactableId`, and is disposed once. Assert task owner and focused target both suppress equipment and require release before it may reappear.

- [ ] **Step 5: Run hand tests and verify RED**

Run: `npm test -- tests/first-person-hand.test.js tests/hand-tracking-director.test.js`

Expected: FAIL because held-item APIs and priority do not exist.

- [ ] **Step 6: Implement detached held fuse and priority routing**

Factor a render-only fuse model factory. Create a separate held instance with cloned geometry/material and no halo/collider/interaction metadata. Attach it to the tracked left palm. `DesktopApp` supplies equipped ID and cinematic permission; `HandTrackingDirector` routes task, target, then equipment in that order.

- [ ] **Step 7: Wire acquisition, equipment use, and consumption**

Successful fuse collection calls `inventory.acquire("spare-fuse")`. Inventory selection equips it. A target-authorized hand grab at the panel requires the equipped fuse and consumes it after success. Camera fallback touch may consume an acquired fuse without a tracked grab. Story history remains separate from current possession.

- [ ] **Step 8: Run focused tests and commit**

Run: `npm test -- tests/held-equipment-gate.test.js tests/first-person-hand.test.js tests/hand-tracking-director.test.js tests/horror-director.test.js tests/desktop-app.test.js`

Expected: PASS.

Commit: `feat: present equipped items in tracked hand`

---

### Task 7: Lifecycle And Cross-Feature Regression

**Files:**
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `tests/controller-app.test.js`
- Modify: `tests/desktop-app.test.js`
- Modify: `tests/protocol.test.js`
- Modify: `tests/virtual-joystick.test.js`
- Modify: `tests/hand-tracking-director.test.js`

**Interfaces:**
- Consumes all prior task APIs.
- Produces one idempotent controller transient cleanup path and one desktop transient cleanup path.

- [ ] **Step 1: Write failing lifecycle matrix tests**

For controller disconnect, replacement, session end, pause, page hide, reorientation, lost capture, and destroy, assert: movement zero, crouch false, voice inactive exactly once, unfinished clip discarded, inventory cancelled, and no delayed timer fires later.

For desktop peer loss, pause, cinematic start, runtime disposal, and destroy, assert: voice indicator hidden, inventory closed, hover cleared, player standing, held item hidden, and acquired/equipped ownership retained unless consumed.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `npm test -- tests/controller-app.test.js tests/desktop-app.test.js`

Expected: FAIL at the first missing cleanup integration.

- [ ] **Step 3: Centralize idempotent transient cleanup**

Add `ControllerApp.cancelTransientControls(reason)` before existing sensor/joystick cleanup and `DesktopApp.clearTransientInteractionState(reason)` before existing task cleanup. Each method calls focused module APIs and never duplicates protocol details.

- [ ] **Step 4: Run all focused regression suites**

Run: `npm test -- tests/protocol.test.js tests/session-registry.test.js tests/controller-app.test.js tests/virtual-joystick.test.js tests/desktop-app.test.js tests/player-controller.test.js tests/hand-tracking-director.test.js tests/first-person-hand.test.js tests/horror-director.test.js`

Expected: PASS with no new console errors.

- [ ] **Step 5: Run full suite and production build**

Run: `npm test`

Expected: all Vitest files and tests pass.

Run: `npm run build`

Expected: Vite production build exits 0. Existing bundle-size warnings may remain, but no new unresolved asset or syntax warning is accepted.

- [ ] **Step 6: Perform browser acceptance checks**

Start the local server on an unused port. Check portrait and landscape phone controller layouts plus desktop at 1920x1080 and 1440x900. Verify no overlap among settings, orb, voice region, safe areas, inventory bar, subtitles, voice indicator, reticle, and door progress. Verify the canvas is nonblank using screenshots and sampled pixels.

- [ ] **Step 7: Commit final integration**

Commit: `test: cover mobile transient interaction lifecycle`

---

## Final Review Checklist

- Compare implementation against every section of `docs/superpowers/specs/2026-08-07-mobile-voice-inventory-crouch-design.md`.
- Confirm the orientation and MediaPipe pipelines have no behavioral edits unrelated to module wiring.
- Confirm all controller and desktop lifecycle exits clear transient state.
- Confirm voice bytes never appear in controller actions, logs, filesystem writes, or hand frames.
- Confirm inventory uses acquired items only and the fuse is removed after installation.
- Confirm target epochs and semantic hand owners retain priority.
- Confirm `.release/` remains untracked and untouched.
- Run final whole-branch code review before reporting completion.
