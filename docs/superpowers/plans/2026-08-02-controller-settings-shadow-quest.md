# Controller Settings And Shadow Quest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Preserve the accepted phone orientation mapping while replacing the split phone layout with one full-screen gesture surface, adding user-controlled camera sensitivity/smoothing, and shipping the “影子” window side quest.

**Architecture:** Keep `MotionController`, `src/shared/orientation.js`, `PhoneSession`, and the wire protocol unchanged. Convert `VirtualJoystick` into a full-surface floating gesture helper that classifies short taps versus drags; put target-angle smoothing and bounded quest aim-assist in `PlayerController`; isolate the window quest and cinematic state in a new `ShadowQuestDirector` coordinated by `DesktopApp` and the existing `HorrorDirector`.

**Tech Stack:** Vanilla JavaScript modules, Three.js, Rapier, Vitest, Vite, existing Lucide icons and WebRTC/socket session layer.

---

### Task 1: Convert the controller to a full-surface gesture

**Files:**
- Modify: `src/controller/VirtualJoystick.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Test: `tests/virtual-joystick.test.js`
- Test: `tests/controller-app.test.js`

- [ ] **Step 1: Write the gesture tests**

Replace the fixed-zone assumptions in `tests/virtual-joystick.test.js` with tests for this contract:

```js
const TAP_MAX_MS = 240;
const TAP_MAX_DISTANCE = 10;

it("does not engage the motion clutch for a short stationary tap", () => {
  const gesture = createGesture();
  gesture.element.dispatch("pointerdown", { clientX: 140, clientY: 180 });
  gesture.element.dispatch("pointerup", { clientX: 145, clientY: 184, now: 200 });

  expect(gesture.onEngagementChange).not.toHaveBeenCalledWith(true);
  expect(gesture.onTap).toHaveBeenCalledOnce();
  expect(gesture.onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
});

it("classifies a drag once distance crosses the threshold", () => {
  const gesture = createGesture();
  gesture.element.dispatch("pointerdown", { clientX: 140, clientY: 180 });
  gesture.element.dispatch("pointermove", { clientX: 190, clientY: 140, now: 90 });
  gesture.element.dispatch("pointerup", { clientX: 190, clientY: 140, now: 140 });

  expect(gesture.onEngagementChange).toHaveBeenNthCalledWith(1, true);
  expect(gesture.onTap).not.toHaveBeenCalled();
  expect(gesture.onChange).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  expect(gesture.onEngagementChange).toHaveBeenLastCalledWith(false);
});

it("cancels a tap after a long hold or a second pointer", () => {
  const gesture = createGesture();
  gesture.element.dispatch("pointerdown", { pointerId: 7, now: 0 });
  gesture.element.dispatch("pointerdown", { pointerId: 8, now: 30 });
  gesture.element.dispatch("pointerup", { pointerId: 7, now: 80 });

  expect(gesture.onTap).not.toHaveBeenCalled();
  expect(gesture.onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
});
```

The test harness must supply a deterministic `now` value through the gesture helper's injected clock or event fixture; production code continues to use `performance.now()`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- --run tests/virtual-joystick.test.js tests/controller-app.test.js`

Expected: the existing fixed joystick API does not emit `onTap` and still assumes a child joystick element, so the new tests fail before implementation.

- [ ] **Step 3: Implement the floating full-surface helper**

Keep the existing class name to avoid a broad import refactor, but accept the play surface itself and add `onTap`. The helper must use these state values:

```js
this.pointerId = null;
this.mode = "idle";
this.origin = { x: 0, y: 0 };
this.startedAt = 0;
this.moved = false;
this.multiTouch = false;
```

On `pointerdown`, reject a second active pointer, store the origin, set pointer capture on the surface, and remain in `tap-candidate` without engaging motion. On `pointermove`, calculate displacement from the origin; when distance is greater than `10`, switch to `dragging`, call `onEngagementChange(true)`, and emit `normalizeJoystick({ dx, dy, radius: 84 })`. While dragging, update movement and prevent browser scrolling. On `pointerup`, emit zero movement and `onEngagementChange(false)` for a drag; call `onTap()` only for a non-multitouch candidate with elapsed time at most `240` and distance at most `10`. `pointercancel`, `lostpointercapture`, visibility changes, and page hide reset without tapping.

The helper must call `onIgnoreTarget(event.target)` before starting a gesture so settings, permission, private-message, and close controls do not become gameplay gestures. The transient base/thumb are positioned at the initial contact point and are hidden when idle; no fixed joystick zone remains.

- [ ] **Step 4: Integrate the helper without touching orientation code**

In `ControllerApp.bindControls`, instantiate the helper with `this.playSurface`, route `onChange` to `this.move` and `sendInput({ immediate: true })`, route engagement to the existing `handleJoystickEngagement`, and route `onTap` to one `interact` action plus haptic feedback. Remove the separate interaction and flashlight listeners, and remove the `MotionController` `onInteract` callback so impact detection cannot create accidental actions.

Update lifecycle cleanup to call the same helper reset/destroy methods. Keep the wire payload shape `{ move, viewDelta, clutch }` unchanged.

- [ ] **Step 5: Update touch layout and verify focused tests pass**

Make `.play-surface` a single `position: relative; touch-action: none` region. Remove the two-column grid, fixed action zone, and permanent joystick pseudo-element. Keep only the compact radar and utility controls above the gesture layer with `pointer-events: none`, restoring `pointer-events: auto` on actual buttons. Make the transient joystick visual pointer-transparent.

Run: `npm test -- --run tests/virtual-joystick.test.js tests/controller-app.test.js`

Expected: PASS, including tap, drag, multitouch, cancellation, and existing pause/background lifecycle coverage.

- [ ] **Step 6: Commit the unified gesture**

Run:

```bash
git add src/controller/VirtualJoystick.js src/controller/ControllerApp.js src/controller/styles.css tests/virtual-joystick.test.js tests/controller-app.test.js
git commit -m "feat: unify phone touch gestures"
```

### Task 2: Simplify settings and keep only radar diagnostics

**Files:**
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/MotionDiagnostics.js`
- Modify: `src/controller/styles.css`
- Test: `tests/controller-app.test.js`

- [ ] **Step 1: Add settings UI assertions**

Add mount-level tests with a minimal DOM fixture that assert the rendered phone screen contains `#settings`, contains `#sensitivity` and `#smoothing`, contains `.aim-plot`, and does not contain `#flashlight`, `#interact`, `.telemetry-grid`, `#invertY`, `#reticle`, `#reducedMotion`, or `#subtitles`. Assert the heading is `设置`, and that a settings change sends only `{ sensitivity, smoothing }` in the settings action.

- [ ] **Step 2: Implement the simplified markup and settings state**

Trim Lucide imports to the icons still used by the connection, settings, recenter, resume, permission, and message controls. Rename the pause button to `#settings` and its accessible label to `设置`; rename the overlay heading to `设置`. Remove flashlight/interact markup and the numeric telemetry definition list. Keep `MotionDiagnostics` mounted only for the radar plot.

Set defaults to:

```js
const defaultSettings = {
  sensitivity: 1,
  smoothing: 0.18,
};
```

When loading persisted data, validate both values and discard unsupported legacy keys before sending settings. Keep the range inputs at sensitivity `0.6..1.6`, step `0.1`, and smoothing `0..1`, step `0.05`; label smoothing as a lightness percentage without exposing the removed toggles. Move recenter into the settings sheet.

- [ ] **Step 3: Keep diagnostics API-compatible but radar-only**

`MotionDiagnostics` may continue accepting sensor/network callbacks from the existing app, but its DOM writes must update only the physical/output dot positions and engaged border state. Remove or no-op numeric field lookups so no diagnostics text is rendered and no null DOM access occurs.

- [ ] **Step 4: Verify settings and layout**

Run: `npm test -- --run tests/controller-app.test.js tests/motion-controller.test.js`

Expected: PASS, with the orientation controller tests unchanged and the phone UI assertions confirming the large unobstructed surface.

- [ ] **Step 5: Commit the settings surface**

Run:

```bash
git add src/controller/ControllerApp.js src/controller/MotionDiagnostics.js src/controller/styles.css tests/controller-app.test.js
git commit -m "feat: simplify phone settings surface"
```

### Task 3: Add desktop-only camera smoothing

**Files:**
- Modify: `src/desktop/PlayerController.js`
- Modify: `src/desktop/DesktopApp.js`
- Test: `tests/player-controller.test.js`

- [ ] **Step 1: Add camera presentation tests**

Extend the existing player harness with `cameraRenderYaw` and `cameraRenderPitch`. Add tests that default sensitivity `1` preserves target angle integration, zero smoothing snaps the rendered angle to the target, and nonzero smoothing approaches the target monotonically while the target remains unchanged. Use two different frame deltas and assert both reach the same value after equal elapsed time within a small tolerance.

- [ ] **Step 2: Separate target and rendered camera state**

Leave `applyPhoneViewDelta`'s axis, clutch, overflow, and angle accumulation logic intact. Keep `cameraYaw` and `cameraPitch` as target values; initialize `cameraRenderYaw` and `cameraRenderPitch` from them when absent for test harness compatibility. Add:

```js
updateCameraPresentation(delta) {
  const smoothing = Number.isFinite(this.settings.smoothing) ? this.settings.smoothing : 0.18;
  if (smoothing <= 0) {
    this.cameraRenderYaw = this.cameraYaw;
    this.cameraRenderPitch = this.cameraPitch;
    return;
  }
  const timeConstant = 0.018 + smoothing * 0.102;
  const alpha = 1 - Math.exp(-delta / timeConstant);
  this.cameraRenderYaw += (this.cameraYaw - this.cameraRenderYaw) * alpha;
  this.cameraRenderPitch += (this.cameraPitch - this.cameraRenderPitch) * alpha;
}
```

Use the rendered yaw for visible camera rotation and camera-relative movement so walking direction matches what the player sees. Keep desktop feedback/debug values based on target angles. Add `setAimAssist(target, strength)` and apply only a bounded, short-lived correction to the rendered presentation; do not alter the target angles or phone packets.

- [ ] **Step 3: Add cinematic lock hooks**

Add `beginCinematic()` and `endCinematic()` state to `PlayerController`. While locked, zero velocity, ignore phone and keyboard movement, clear selected interaction, and allow only the quest director to place the camera. `endCinematic()` restores the saved body/camera state supplied by the director and resets the presentation values without changing the orientation tracker.

- [ ] **Step 4: Integrate presentation updates**

In `PlayerController.update`, apply incoming phone deltas first, update presentation smoothing, then calculate movement and camera rotation. Do not edit `src/shared/orientation.js` or `src/controller/MotionController.js`.

Pass `player` to the director from `DesktopApp`, send target camera angles in control feedback, and preserve existing fallback keyboard behavior.

- [ ] **Step 5: Run camera regression tests**

Run: `npm test -- --run tests/player-controller.test.js tests/orientation.test.js tests/motion-controller.test.js`

Expected: PASS with all pre-existing orientation behavior intact.

- [ ] **Step 6: Commit camera presentation**

Run:

```bash
git add src/desktop/PlayerController.js src/desktop/DesktopApp.js tests/player-controller.test.js
git commit -m "feat: smooth desktop camera presentation"
```

### Task 4: Build the observation-window scene and brighter flashlight

**Files:**
- Modify: `src/desktop/create-scene.js`
- Modify: `src/desktop/styles.css`
- Test: `tests/desktop-app.test.js`

- [ ] **Step 1: Add scene-object contract tests**

Extend the scene harness or a scene factory seam to assert the returned experience exposes `objects.shadowQuest.window`, `objects.shadowQuest.taskPoint`, `objects.shadowQuest.oppositeCorridor`, and `objects.shadowQuest.operatingRoom`, and that the task point starts hidden/disabled.

- [ ] **Step 2: Refine the existing corridor procedurally**

Keep the current low-cost canvas materials as the fallback and add restrained hospital detail around the existing path: segmented wall panels, window trim, conduit cylinders, fluorescent housings, warning placards, and a shallow observation-window recess. Avoid adding a full asset pack unless a local, permissively licensed asset is verified; any optional maps must be copied into the project and loaded without blocking scene startup.

Construct a small opposite-building corridor beyond the observation window with an operating-room door. Use separate groups for the corridor, door, and figure so the quest director can animate them without touching main-story objects. Add a `shadow-window` interactable target with a ring-and-crosshair task point.

- [ ] **Step 3: Make the flashlight legible in open space**

Keep the current light orientation attached to the camera, increase the core/spill visibility modestly, and tune the volumetric cone opacity and falloff so the beam is visible before it reaches a wall without washing out surfaces. Keep the hallway ambient lift sufficient to read floor, door, and window silhouettes when the beam points into open space.

- [ ] **Step 4: Verify the scene factory and build**

Run: `npm test -- --run tests/desktop-app.test.js`

Expected: PASS, then run `npm run build` and expect a successful Vite production build.

- [ ] **Step 5: Commit the scene pass**

Run:

```bash
git add src/desktop/create-scene.js src/desktop/styles.css tests/desktop-app.test.js
git commit -m "feat: add observation window scene"
```

### Task 5: Implement the “影子” side-quest director

**Files:**
- Create: `src/desktop/ShadowQuestDirector.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/HorrorDirector.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Test: `tests/shadow-quest.test.js`

- [ ] **Step 1: Write side-quest state tests**

Create a deterministic Three.js harness and test these public behaviors:

```js
it("reveals the task point only near the window with flashlight aim", () => {
  const quest = createQuest({ playerPosition: [0, 1.6, -13.4], lookAtWindow: true, flashlightVisible: true });
  quest.update(0.016, 1);
  expect(quest.isAvailable()).toBe(true);
  expect(quest.taskPoint.visible).toBe(true);
});

it("does not reveal or assist when the light is off or aim is outside the cone", () => {
  const quest = createQuest({ playerPosition: [0, 1.6, -13.4], lookAtWindow: false, flashlightVisible: true });
  quest.update(0.016, 1);
  expect(quest.isAvailable()).toBe(false);
  expect(quest.taskPoint.visible).toBe(false);
});

it("restores the exact saved player pose after the one-shot cinematic", () => {
  const quest = createQuest({ playerPosition: [0, 1.6, -13.4], lookAtWindow: true, flashlightVisible: true });
  const saved = quest.player.snapshotPose();
  expect(quest.handleInteraction("shadow-window")).toBe(true);
  quest.update(10, 10);
  expect(quest.complete).toBe(true);
  expect(quest.player.snapshotPose()).toEqual(saved);
});
```

- [ ] **Step 2: Implement eligibility and bounded aim assist**

`ShadowQuestDirector` accepts `{ experience, player, ui, audio }`. It tracks `hidden`, `available`, `cinematic`, `complete`, and `elapsed`. Each update checks player-to-window distance, flashlight visibility, camera-to-task-point dot product, and a scene raycast that ignores the quest reticle itself. It toggles the task-point object and calls `player.setAimAssist(taskPointWorldPosition, 0.22)` only while eligible and inside the acquisition cone; otherwise it calls `player.clearAimAssist()`.

Use a one-shot `handleInteraction(id)` that accepts only `shadow-window` while available. Return `true` when it starts and `false` for all invalid/repeated calls.

- [ ] **Step 3: Implement cinematic save/restore**

At start, save `player.snapshotPose()` and call `player.beginCinematic()`. Move the camera with a time-based ease toward a fixed peeking position beside the window, aim it at the opposite corridor, animate the soft figure crossing toward the operating-room door, then wait for the door close. At the end, call `player.restorePose(saved)`, `player.endCinematic()`, hide the task point, clear aim assist, and set `complete = true`. Add an abort path used by page visibility, disconnect, and destroy that always restores the saved pose.

- [ ] **Step 4: Route the quest before the main objective**

Create the quest after `PlayerController` in `DesktopApp`, pass it to `HorrorDirector`, and update it once per frame. `DesktopApp.handleInteraction` must call `shadowQuest.handleInteraction(id)` first; only if it returns `false` should `HorrorDirector.handleInteraction(id)` process the existing fuse/panel/elevator chain. The existing main objective state machine must not receive `shadow-window`.

Add a small desktop prompt state for the task point, but keep the phone interaction input invisible: the phone only sends the generic `interact` action and the desktop target selection decides whether it is the shadow window or a main object.

- [ ] **Step 5: Add quest tests and run the focused suite**

Run: `npm test -- --run tests/shadow-quest.test.js tests/horror-director.test.js tests/interaction.test.js`

Expected: PASS, including one-shot completion, scene animation, input lock, and main-story routing.

- [ ] **Step 6: Commit the side quest**

Run:

```bash
git add src/desktop/ShadowQuestDirector.js src/desktop/DesktopApp.js src/desktop/HorrorDirector.js src/desktop/ui.js src/desktop/styles.css tests/shadow-quest.test.js
git commit -m "feat: add shadow window side quest"
```

### Task 6: Full verification and device/browser pass

**Files:**
- Modify: any implementation/test file required by verification failures only

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass, including the untouched orientation and protocol suites.

- [ ] **Step 2: Build the production bundle**

Run: `npm run build`

Expected: Vite completes without warnings that prevent loading and writes `dist/`.

- [ ] **Step 3: Test the phone layout at desktop and mobile sizes**

Use the existing local server and fresh room pairing. Confirm that the radar is small in the upper-left, the settings button is isolated in the upper-right, the transient touch ring never blocks the screen, and the whole remaining surface accepts drag input. Confirm a short tap sends exactly one `interact`, while a drag sends movement and clutch changes but no interaction.

- [ ] **Step 4: Test the scene and quest in the browser**

Start the game in phone mode, approach the observation window, aim the brighter flashlight at it, confirm the task reticle appears and the view assist is mild, tap once, watch the figure enter the operating room, and confirm the saved view returns exactly. Also test the main fuse/panel/elevator path after the side quest.

- [ ] **Step 5: Commit only verification-driven fixes**

Run:

```bash
git diff --check
git status --short
```

Commit any required fixes with a focused message and leave unrelated existing worktree changes untouched.
