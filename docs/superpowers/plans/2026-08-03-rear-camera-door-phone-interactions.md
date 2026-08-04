# Rear-Camera Door Defense and Found Phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the elevator ending with a rear-camera-driven door-defense sequence and add a reusable found-phone inspection interaction backed by reliable pulse and continuous-presence detection.

**Architecture:** `CameraMotionDetector` exposes story-agnostic pulse and presence signals. `DoorDefenseDirector` and `FoundPhoneDirector` consume validated controller events through `DesktopApp`, while scene construction, controller UI, haptics, and story state remain separate modules with focused tests.

**Tech Stack:** JavaScript ES modules, Three.js 0.178, Rapier 3D, Socket.IO/WebRTC transport, Web Media Capture, Web Audio/Vibration APIs, Vitest 3, Vite 6, Playwright for visual smoke tests.

## Global Constraints

- Require `facingMode: { exact: "environment" }`; never retry with an unconstrained or front-facing source.
- Ordinary pulse interactions have an exact 500 ms cooldown with no extra quiet-frame delay.
- Door defense succeeds only after 4.0 uninterrupted seconds; one absent presence sample immediately resets progress to zero.
- Found-phone inspection closes on the first absent presence sample and remains repeatable.
- Camera frames stay local and are never transmitted or stored.
- Do not add MediaPipe, cloud vision, a native wrapper, external 3D packs, or a large runtime dependency.
- Preserve unrelated working-tree changes and stage only task-owned paths for each commit.

## File Map

- `src/controller/CameraMotionDetector.js`: rear-camera capture, pulse history, adaptive scoring, frozen-baseline presence.
- `src/controller/BraceHaptics.js`: supported vibration loop and visual/audio fallback callback.
- `src/controller/FoundPhoneUI.js`: found-phone content, pager state, swipe/tap navigation.
- `src/controller/ControllerApp.js`: detector/event wiring, found-phone overlay lifecycle, cleanup.
- `src/controller/styles.css`: found-phone and continuous-gesture controller presentation.
- `src/shared/protocol.js`: validated `gesture-presence` controller action.
- `src/shared/objectives.js`: `reach-door -> secured` story migration.
- `src/desktop/ExitDoor.js`: exit door, movable hardware, brace arms, collider, trigger point.
- `src/desktop/FoundPhoneProp.js`: floor interactable and first-person held prop.
- `src/desktop/DoorDefenseDirector.js`: automatic proximity cinematic and four-second state machine.
- `src/desktop/FoundPhoneDirector.js`: pickup/hold/release state machine.
- `src/desktop/HorrorDirector.js`: power/pursuit story without elevator completion.
- `src/desktop/DesktopApp.js`: director composition and context-safe event routing.
- `src/desktop/create-scene.js`: register new props and remove elevator construction.
- `src/desktop/ui.js`, `src/desktop/styles.css`: door progress UI and removal of old elevator completion UI.
- `src/desktop/audio.js`: lock, impact, brace, latch, phone pickup/release cues.

---

### Task 1: Rear-Camera Pulse and Presence Detector

**Files:**
- Modify: `src/controller/CameraMotionDetector.js`
- Modify: `tests/camera-motion-detector.test.js`

**Interfaces:**
- Consumes: browser `mediaDevices.getUserMedia`, grayscale sample frames, `setFocused(boolean)`.
- Produces: `setMode({ mode, context, baseline })`, `onPulse(event)`, and `onPresence({ ready, active, context, metrics, timestamp })`.

- [ ] **Step 1: Write failing rear-camera-only tests**

Add tests that require the only request to use the rear camera, reject a front-facing track, and never retry with an unconstrained source:

```js
it("requires the rear camera and never retries with an unconstrained source", async () => {
  const getUserMedia = vi.fn().mockRejectedValueOnce(new Error("rear unavailable"));
  const detector = new CameraMotionDetector({
    mediaDevices: { getUserMedia },
    createCaptureElements: () => null,
  });

  await expect(detector.start()).resolves.toEqual({ cameraGranted: false });
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
    video: expect.objectContaining({ facingMode: { exact: "environment" } }),
  }));
});
```

- [ ] **Step 2: Write failing pulse-history and 500 ms cooldown tests**

Use 96x72 frames containing a small low-contrast rectangle. Feed quiet frames at 0/50/100/150 ms, a changed frame at 200 ms, another change at 699 ms, and another at 700 ms. Assert pulses at 200 and 700 only. Also assert the comparison metrics came from the approximately 150 ms reference rather than the immediate duplicate frame.

```js
expect(onPulse).toHaveBeenCalledTimes(2);
expect(onPulse.mock.calls[0][0].timestamp).toBe(200);
expect(onPulse.mock.calls[1][0].timestamp).toBe(700);
```

- [ ] **Step 3: Write failing presence tests**

Cover both baseline modes:

```js
detector.setMode({ mode: "presence", context: "door-defense", baseline: "fresh" });
detector.ingestFrame(quiet, 96, 72, 0);
detector.ingestFrame(quiet, 96, 72, 50);
detector.ingestFrame(quiet, 96, 72, 100);
detector.ingestFrame(hand, 96, 72, 150);
detector.ingestFrame(hand, 96, 72, 200);
detector.ingestFrame(quiet, 96, 72, 250);

expect(onPresence).toHaveBeenNthCalledWith(1, expect.objectContaining({ ready: true, active: true, context: "door-defense" }));
expect(onPresence).toHaveBeenNthCalledWith(2, expect.objectContaining({ ready: true, active: false, context: "door-defense" }));
```

Add a retained-baseline test that triggers a pulse, switches to `found-phone`, and verifies the first sampled presence event is active rather than a premature inactive event.

- [ ] **Step 4: Run detector tests and verify RED**

Run: `npm test -- --run tests/camera-motion-detector.test.js`

Expected: FAIL because rear-only acquisition, `setMode`, `onPulse`, `onPresence`, pulse history, and exact 500 ms rearming do not exist.

- [ ] **Step 5: Implement capture constraints and detector modes**

Use these public constants and defaults:

```js
const CAMERA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    facingMode: { exact: "environment" },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 20, max: 24 },
  },
});
const PULSE_COOLDOWN_MS = 500;
const HISTORY_MS = 150;
```

Replace the one-shot `triggered/quietFrameCount` path with:

```js
setMode({ mode = "pulse", context = null, baseline = "fresh" } = {}) {
  this.mode = mode === "presence" ? "presence" : "pulse";
  this.context = this.mode === "presence" ? context : null;
  this.presenceReady = false;
  this.lastPresence = null;
  this.presenceBaseline = baseline === "retained" ? this.lastQuietFrame?.slice() ?? null : null;
  this.calibrationFrames = [];
}
```

Keep timestamped history entries, select the newest frame at least 150 ms old, and continue updating history during cooldown. Update `noiseMean` only on non-triggering pulse samples with `noiseMean = noiseMean * 0.92 + metrics.meanDifference * 0.08`. Compute adaptive floors with `Math.max` and reject `activeRatio >= 0.96`.

Use the exact adaptive scoring function:

```js
export function adaptiveScoringOptions(noiseMean = 0) {
  const noise = Number.isFinite(noiseMean) ? Math.max(0, noiseMean) : 0;
  return {
    pixelThreshold: Math.max(4 / 255, noise * 3),
    minMeanDifference: Math.max(0.0015, noise * 2.25),
    minActiveRatio: 0.008,
    minLargestActiveRatio: 0.0015,
    minMotionCoherence: 0.18,
    maxActiveRatio: 0.96,
  };
}
```

A frame is stable for fresh-baseline calibration when its mean difference is within ordinary low-level sensor noise and its largest connected active region stays below the foreground threshold. Pulse qualification requires `meanDifference >= minMeanDifference`, a connected foreground region, and `largestActiveRatio / activeRatio >= minMotionCoherence`; the previous broad-change shortcut is intentionally absent. For sufficiently large samples, a small translation search also rejects frames whose scene-wide error drops substantially after shifting, which identifies phone movement. Presence uses the same connected-region and global-translation gates, so scattered sensor noise or camera shake cannot hold a scene active.

For fresh presence, accept three stable calibration frames, freeze the latest as baseline, then evaluate the following frame. For retained presence, evaluate the first following frame immediately. Emit the first `{ ready: true, active }` result and repeat the unchanged state every 250 ms. A desktop scene aborts after three seconds without a ready state; found-phone inspection uses the same timeout only before its first ready state.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- --run tests/camera-motion-detector.test.js`

Expected: all detector tests pass, including low-contrast, scattered-noise, rear-only acquisition, global-shake rejection, exact cooldown, static hold, and immediate release.

```bash
git add src/controller/CameraMotionDetector.js tests/camera-motion-detector.test.js
git commit -m "feat: add rear camera pulse and presence detection"
```

---

### Task 2: Protocol, Presence Routing, and Brace Haptics

**Files:**
- Create: `src/controller/BraceHaptics.js`
- Create: `tests/brace-haptics.test.js`
- Modify: `src/shared/protocol.js`
- Modify: `tests/protocol.test.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `tests/controller-app.test.js`

**Interfaces:**
- Consumes: detector pulse/presence callbacks and desktop events.
- Produces: validated `gesture-presence` actions and deterministic haptic start/stop lifecycle.

- [ ] **Step 1: Write failing protocol tests**

```js
expect(protocol.isControllerAction({
  action: "gesture-presence",
  ready: true,
  active: false,
  context: "door-defense",
})).toBe(true);
expect(protocol.isControllerAction({ action: "gesture-presence", ready: true, active: true, context: "wrong" })).toBe(false);
expect(protocol.isControllerAction({ action: "gesture-presence", ready: "yes", active: true, context: "found-phone" })).toBe(false);
```

- [ ] **Step 2: Write failing haptic cleanup tests**

```js
const vibrate = vi.fn(() => true);
const fallback = vi.fn();
const haptics = new BraceHaptics({ vibrate, onFallbackPulse: fallback, setTimer: vi.fn(() => 7), clearTimer: vi.fn() });
haptics.start();
haptics.stop();
expect(vibrate).toHaveBeenNthCalledWith(1, [55, 35, 90]);
expect(vibrate).toHaveBeenLastCalledWith(0);
```

Also cover unsupported vibration returning false and assert `onFallbackPulse` runs.

- [ ] **Step 3: Write failing ControllerApp routing tests**

Require these behaviors:

```js
app.handleDesktopEvent({ type: "gesture-mode", mode: "presence", context: "door-defense", baseline: "fresh" });
expect(cameraMotion.setMode).toHaveBeenCalledWith({ mode: "presence", context: "door-defense", baseline: "fresh" });

app.handleCameraPresence({ ready: true, active: true, context: "door-defense" });
expect(actions).toHaveBeenCalledWith("gesture-presence", { ready: true, active: true, context: "door-defense" });

app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });
expect(haptics.start).toHaveBeenCalledOnce();
app.suspendForBackground();
expect(haptics.stop).toHaveBeenCalled();
```

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npm test -- --run tests/protocol.test.js tests/brace-haptics.test.js tests/controller-app.test.js`

Expected: FAIL because the action, haptic class, detector modes, and routing methods are absent.

- [ ] **Step 5: Implement protocol validation and haptics**

Add `gesture-presence` to `CONTROLLER_ACTIONS`, then special-case validation:

```js
if (value.action === "gesture-presence") {
  return typeof value.ready === "boolean"
    && typeof value.active === "boolean"
    && ["door-defense", "found-phone"].includes(value.context);
}
```

Implement `BraceHaptics` with idempotent `start()`, a 220 ms repeating timer, `[55, 35, 90]` vibration, fallback callback when vibration is unavailable, and unconditional `vibrate(0)` on `stop()`.

Wire `ControllerApp` to `onPulse`, `onPresence`, `gesture-mode`, and `haptics`. Stop haptics during pause, background, disconnect, and destroy.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- --run tests/protocol.test.js tests/brace-haptics.test.js tests/controller-app.test.js`

```bash
git add src/shared/protocol.js tests/protocol.test.js src/controller/BraceHaptics.js tests/brace-haptics.test.js src/controller/ControllerApp.js tests/controller-app.test.js
git commit -m "feat: route sustained gestures and brace haptics"
```

---

### Task 3: Found Phone Controller UI

**Files:**
- Create: `src/controller/FoundPhoneUI.js`
- Create: `tests/found-phone-ui.test.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/styles.css`
- Modify: `tests/controller-app.test.js`

**Interfaces:**
- Consumes: existing overlay elements and `found-phone-ui` desktop events.
- Produces: `setActive(boolean)`, `next(direction)`, swipe/tap navigation, and `destroy()`.

- [ ] **Step 1: Write failing pager tests**

```js
expect(nextPhonePage(0, -1, 3)).toBe(2);
expect(nextPhonePage(2, 1, 3)).toBe(0);
expect(phoneSwipeDirection(180, 90, 42)).toBe(1);
expect(phoneSwipeDirection(90, 180, 42)).toBe(-1);
expect(phoneSwipeDirection(100, 120, 42)).toBe(0);
```

Add a fake-element test proving `setActive(false)` resets to page zero and hides the overlay.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- --run tests/found-phone-ui.test.js tests/controller-app.test.js`

Expected: FAIL because `FoundPhoneUI` and the desktop event branch do not exist.

- [ ] **Step 3: Implement fixed content and navigation**

Export three immutable page records:

```js
export const FOUND_PHONE_PAGES = Object.freeze([
  { kind: "messages", title: "消息", body: ["北门外的人不是保安。", "617 已经转移，不要回应敲门。"] },
  { kind: "note", title: "维修备忘", body: ["恢复供电后，紧急锁需要持续施压四秒。"] },
  { kind: "calls", title: "通话记录", body: ["617  未接来电  6 次", "语音转写：别让走廊尽头的门打开。"] },
]);
```

Use `ChevronLeft` and `ChevronRight` icon buttons. Bind pointer down/up to a 42 px swipe threshold; taps on the left/right half call the same `next(-1|1)` method. Render page count and stable-size content so long text does not shift the overlay.

Add `found-phone-ui` handling in `ControllerApp`; stop haptics and close this UI in every lifecycle cleanup path.

- [ ] **Step 4: Add responsive controller styles**

Create a full-screen `.found-phone-ui` layer above `.controller-shell`, use safe-area padding, stable header/footer tracks, `touch-action: none`, icon-only 44 px navigation buttons, and restrained dark/green phone styling. Add a short `.brace-impact` fallback animation without cards inside cards.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- --run tests/found-phone-ui.test.js tests/controller-app.test.js`

```bash
git add src/controller/FoundPhoneUI.js tests/found-phone-ui.test.js src/controller/ControllerApp.js src/controller/styles.css tests/controller-app.test.js
git commit -m "feat: add held phone controller interface"
```

---

### Task 4: Story Migration Away From the Elevator

**Files:**
- Modify: `src/shared/objectives.js`
- Modify: `tests/objectives.test.js`
- Modify: `src/desktop/HorrorDirector.js`
- Modify: `tests/horror-director.test.js`

**Interfaces:**
- Consumes: `fuse-collected`, `panel-used`, and new `door-defended` story events.
- Produces: `find-fuse -> restore-power -> reach-door -> secured` and `HorrorDirector.stopPursuit()`.

- [ ] **Step 1: Write failing objective migration tests**

```js
const story = createObjectiveState();
expect(story.dispatch("fuse-collected")).toMatchObject({ next: "restore-power" });
expect(story.dispatch("panel-used")).toMatchObject({ next: "reach-door" });
expect(story.dispatch("door-defended")).toMatchObject({ next: "secured" });
expect(story.serialize()).toEqual({ current: "secured", hasFuse: true, powerRestored: true, secured: true });
```

Assert `elevator-entered` is rejected and no elevator state names remain in `OBJECTIVE_LABELS`.

- [ ] **Step 2: Write failing HorrorDirector tests**

Remove elevator fixtures from the harness. Assert panel restoration advances to `reach-door`, does not show/remove an elevator volume, and `stopPursuit()` clears pursuit state and hides the silhouette.

- [ ] **Step 3: Run story tests and verify RED**

Run: `npm test -- --run tests/objectives.test.js tests/horror-director.test.js`

Expected: FAIL on old `reach-elevator`, `escaped`, elevator objects, and missing `stopPursuit()`.

- [ ] **Step 4: Implement the new objective graph and simplify HorrorDirector**

Use:

```js
const TRANSITIONS = Object.freeze({
  "find-fuse": { "fuse-collected": "restore-power" },
  "restore-power": { "panel-used": "reach-door" },
  "reach-door": { "door-defended": "secured" },
  secured: {},
});
```

Remove `enterElevator`, `updateElevator`, `completionAt`, elevator visibility/collider mutations, and the elevator cue. Keep power sequencing and pursuit. Add:

```js
stopPursuit() {
  this.pursuitAt = Infinity;
  this.pursuitActive = false;
  this.experience.objects.silhouette.visible = false;
}
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- --run tests/objectives.test.js tests/horror-director.test.js`

```bash
git add src/shared/objectives.js tests/objectives.test.js src/desktop/HorrorDirector.js tests/horror-director.test.js
git commit -m "refactor: replace elevator objective with exit door"
```

---

### Task 5: Exit Door and Found Phone Scene Props

**Files:**
- Create: `src/desktop/ExitDoor.js`
- Create: `src/desktop/FoundPhoneProp.js`
- Create: `tests/scene-props.test.js`
- Modify: `src/desktop/create-scene.js`

**Interfaces:**
- Consumes: Three scene/camera, Rapier world, and existing corridor materials.
- Produces: `exitDoor` animation roots and `foundPhone` interactable/held state.

- [ ] **Step 1: Write failing prop contract tests**

Create objects in a Three scene with a fake collider factory and assert:

```js
expect(exitDoor.root.name).toBe("exit-door");
expect(exitDoor.triggerPosition.toArray()).toEqual([0, 1.05, -26.7]);
expect(exitDoor.handlePivot.parent).toBeTruthy();
expect(exitDoor.braceRig.visible).toBe(false);

expect(foundPhone.id).toBe("found-phone");
expect(foundPhone.root.userData.interactableId).toBe("found-phone");
foundPhone.setHeld(true);
expect(foundPhone.root.visible).toBe(false);
expect(foundPhone.heldRig.visible).toBe(true);
```

- [ ] **Step 2: Run prop tests and verify RED**

Run: `npm test -- --run tests/scene-props.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the exit door prop**

Export:

```js
export function createExitDoor({ scene, camera, world, RAPIER, materials = {} }) {
  const doorSurface = materials.door ?? new THREE.MeshStandardMaterial({ color: 0x303632, roughness: 0.5, metalness: 0.68 });
  const hardwareSurface = materials.hardware ?? new THREE.MeshStandardMaterial({ color: 0x777d76, roughness: 0.24, metalness: 0.92 });
  const sleeveSurface = new THREE.MeshStandardMaterial({ color: 0x1c2422, roughness: 0.86 });
  const skinSurface = new THREE.MeshStandardMaterial({ color: 0xa87861, roughness: 0.72 });
  const root = new THREE.Group();
  root.name = "exit-door";
  root.position.set(0, 0, -28.88);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.82, 3.2, 0.24), hardwareSurface);
  frame.position.y = 1.58;
  const leafPivot = new THREE.Group();
  leafPivot.position.set(0, 1.48, 0.14);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.34, 2.88, 0.18), doorSurface);
  leafPivot.add(leaf);
  const handlePivot = new THREE.Group();
  handlePivot.position.set(0.74, 0.1, -0.16);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 10), hardwareSurface);
  handle.rotation.z = Math.PI / 2;
  handlePivot.add(handle);
  leafPivot.add(handlePivot);
  const lockBolt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.12), hardwareSurface);
  lockBolt.position.set(1.13, 0.08, 0);
  leafPivot.add(lockBolt);
  const gapShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.28, 2.82), new THREE.MeshBasicMaterial({ color: 0x010202 }));
  gapShadow.position.set(0, 1.48, 0.025);
  root.add(gapShadow, frame, leafPivot);
  scene.add(root);

  const braceRig = new THREE.Group();
  braceRig.name = "brace-rig";
  braceRig.position.set(0, -0.36, -0.68);
  for (const side of [-1, 1]) {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.55, 5, 10), sleeveSurface);
    sleeve.position.set(side * 0.24, -0.13, 0);
    sleeve.rotation.x = Math.PI / 2.7;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), skinSurface);
    hand.scale.set(0.75, 1.2, 0.45);
    hand.position.set(side * 0.24, 0.13, -0.38);
    braceRig.add(sleeve, hand);
  }
  braceRig.visible = false;
  camera.add(braceRig);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.44, -28.7));
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 1.44, 0.14), body);
  return {
    root,
    leafPivot,
    handlePivot,
    lockBolt,
    gapShadow,
    braceRig,
    triggerPosition: new THREE.Vector3(0, 1.05, -26.7),
    collider,
  };
}
```

Build a reinforced frame, beveled-looking layered leaf, handle, cylinder lock, strike plate, three hinges, observation slot, inner gap shadow, and two sleeved first-person arms. Use separate transform roots and keep arms hidden initially. Place the closed collider at the corridor endpoint; unlike the elevator, it is never removed.

- [ ] **Step 4: Implement the found phone prop and scene registration**

Export `createFoundPhoneProp({ scene, camera })`. Place the floor root near the third doorway at approximately `[-1.2, 0.07, -11.4]`, rotate it naturally, and build a body, camera bump, buttons, cracked emissive screen, and targeting halo. Attach a separate held rig to the camera and expose `setHeld(active)`.

Use this public shape:

```js
export function createFoundPhoneProp({ scene, camera }) {
  const bodySurface = new THREE.MeshStandardMaterial({ color: 0x111614, roughness: 0.34, metalness: 0.62 });
  const screenSurface = new THREE.MeshStandardMaterial({ color: 0x304b43, emissive: 0x4d8b72, emissiveIntensity: 1.4, roughness: 0.22 });
  const root = new THREE.Group();
  root.position.set(-1.2, 0.07, -11.4);
  root.rotation.set(-Math.PI / 2, 0, -0.34);
  root.userData.interactableId = "found-phone";
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.72, 0.055), bodySurface);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.62, 0.012), screenSurface);
  screen.position.z = 0.034;
  const cameraBump = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.035), bodySurface);
  cameraBump.position.set(-0.1, 0.23, -0.045);
  root.add(body, screen, cameraBump);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.28, 28), new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.82, side: THREE.DoubleSide }));
  halo.position.z = 0.055;
  halo.visible = false;
  root.add(halo);
  scene.add(root);

  const heldRig = root.clone(true);
  heldRig.position.set(0.36, -0.28, -0.78);
  heldRig.rotation.set(-0.18, -0.34, 0.08);
  heldRig.scale.setScalar(1.45);
  heldRig.visible = false;
  camera.add(heldRig);
  return {
    id: "found-phone",
    label: "拿起手机",
    root,
    mesh: body,
    halo,
    heldRig,
    enabled: true,
    setHeld(active) {
      root.visible = !active;
      heldRig.visible = Boolean(active);
    },
  };
}
```

In `create-scene.js`, delete elevator construction, call both factories, include `foundPhone` in `interactables`, and return `objects.exitDoor` and `objects.foundPhone`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- --run tests/scene-props.test.js tests/player-controller.test.js`

```bash
git add src/desktop/ExitDoor.js src/desktop/FoundPhoneProp.js tests/scene-props.test.js src/desktop/create-scene.js
git commit -m "feat: build exit door and found phone props"
```

---

### Task 6: Found Phone Director

**Files:**
- Create: `src/desktop/FoundPhoneDirector.js`
- Create: `tests/found-phone-director.test.js`

**Interfaces:**
- Consumes: `experience.objects.foundPhone`, player cinematic methods, audio, and `sendControllerEvent(event)`.
- Produces: `handleInteraction(id)`, `handlePresence(event)`, `isInspecting()`, `release()`, and `destroy()`.

- [ ] **Step 1: Write failing pickup, release, and repeatability tests**

```js
expect(director.handleInteraction("found-phone")).toBe(true);
expect(foundPhone.setHeld).toHaveBeenCalledWith(true);
expect(player.beginCinematic).toHaveBeenCalledOnce();
expect(send).toHaveBeenCalledWith({ type: "gesture-mode", mode: "presence", context: "found-phone", baseline: "retained" });
expect(send).toHaveBeenCalledWith({ type: "found-phone-ui", active: true });

director.handlePresence({ context: "found-phone", ready: true, active: false });
expect(foundPhone.setHeld).toHaveBeenLastCalledWith(false);
expect(player.endCinematic).toHaveBeenCalledOnce();
expect(director.handleInteraction("found-phone")).toBe(true);
```

Add tests that stale `door-defense` presence is ignored and `destroy()` always restores pulse mode and hides the UI.

- [ ] **Step 2: Run director tests and verify RED**

Run: `npm test -- --run tests/found-phone-director.test.js`

Expected: FAIL because the director does not exist.

- [ ] **Step 3: Implement the minimal state machine**

Use one `inspecting` boolean. On pickup call `player.beginCinematic()`, `foundPhone.setHeld(true)`, audio `phone-pickup`, retained presence mode, and active phone UI. On the first matching ready/inactive event call `release()`. Release reverses every side effect, sends `{ type: "gesture-mode", mode: "pulse", context: null, baseline: "fresh" }`, and is idempotent.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- --run tests/found-phone-director.test.js`

```bash
git add src/desktop/FoundPhoneDirector.js tests/found-phone-director.test.js
git commit -m "feat: add repeatable found phone inspection"
```

---

### Task 7: Door Defense Director

**Files:**
- Create: `src/desktop/DoorDefenseDirector.js`
- Create: `tests/door-defense-director.test.js`

**Interfaces:**
- Consumes: exit-door prop roots, player pose/cinematic API, shared story, UI, audio, `sendControllerEvent`, and `onThreatStart`.
- Produces: `update(delta)`, `handlePresence(event)`, `setFallbackHolding(active)`, `isCinematic()`, `abort()`, and `destroy()`.

- [ ] **Step 1: Write failing proximity and intro tests**

Set story to `reach-door`, player camera within 2.35 m, call `update(0.016)`, and assert pose snapshot, `beginCinematic`, pursuit stop callback, and cinematic camera control. Advance 1.2 seconds and assert a fresh `door-defense` gesture-mode event.

- [ ] **Step 2: Write failing immediate-reset test**

```js
director.handlePresence({ context: "door-defense", ready: true, active: true });
director.update(1.5);
expect(ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.375 }));

director.handlePresence({ context: "door-defense", ready: true, active: false });
expect(ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0, status: "failed" }));
expect(send).toHaveBeenCalledWith({ type: "haptics", active: false, pattern: "brace" });
```

- [ ] **Step 3: Write failing four-second success and restoration tests**

Advance four uninterrupted seconds while active. Assert `door-defended`, latch audio, hidden progress, haptics off, a one-second return, exact `restorePose(savedPose)`, and `endCinematic()`.

Add abort tests for disconnect/destroy and a wrong-context presence test.

- [ ] **Step 4: Run director tests and verify RED**

Run: `npm test -- --run tests/door-defense-director.test.js`

Expected: FAIL because the director and state machine are absent.

- [ ] **Step 5: Implement phases and animation outputs**

Use explicit phase constants:

```js
const PHASE = Object.freeze({
  dormant: "dormant",
  intro: "intro",
  calibrating: "calibrating",
  awaiting: "awaiting",
  bracing: "bracing",
  failed: "failed",
  secured: "secured",
  returning: "returning",
  complete: "complete",
});
const INTRO_SECONDS = 1.2;
const HOLD_SECONDS = 4;
const FAILURE_SECONDS = 0.7;
const RETURN_SECONDS = 1;
```

Acquire automatically by camera-to-trigger distance. Save pose and original camera target, animate toward a fixed brace position, then calibrate. Do not treat inactive as failure before bracing begins. Once bracing starts, one inactive event calls `fail()` synchronously, clears progress, stops haptics, and resets the attempt. Success dispatches `door-defended` and returns to the saved pose.

Animate handle twist, lock bolt, leaf gap, brace arms, and reduced-motion-aware camera impact from phase time without allocating new Three vectors each frame.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- --run tests/door-defense-director.test.js`

```bash
git add src/desktop/DoorDefenseDirector.js tests/door-defense-director.test.js
git commit -m "feat: add continuous door defense finale"
```

---

### Task 8: Desktop Composition, Progress UI, Audio, and Fallback Controls

**Files:**
- Modify: `src/desktop/DesktopApp.js`
- Modify: `tests/desktop-app.test.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Modify: `src/desktop/audio.js`
- Modify: `src/desktop/PlayerController.js`
- Modify: `tests/player-controller.test.js`

**Interfaces:**
- Consumes: both new directors and validated `gesture-presence` actions.
- Produces: context-safe routing, progress presentation, fallback Space hold, and complete cleanup.

- [ ] **Step 1: Write failing DesktopApp routing tests**

```js
app.handlePhoneAction({ action: "gesture-presence", context: "found-phone", ready: true, active: false });
expect(app.foundPhone.handlePresence).toHaveBeenCalled();
expect(app.doorDefense.handlePresence).not.toHaveBeenCalled();

app.handlePhoneAction({ action: "gesture-presence", context: "door-defense", ready: true, active: true });
expect(app.doorDefense.handlePresence).toHaveBeenCalled();
```

Assert interaction routing tries found phone before shadow quest/HorrorDirector, disconnect aborts both new directors, and tick suppresses normal horror updates while either cinematic owns the camera.

- [ ] **Step 2: Write failing UI and keyboard fallback tests**

Require `setDoorDefense({ visible, progress, status })` to update `hidden`, `aria-valuenow`, stable transform width, and status text. Require Space keydown/up to call `doorDefense.setFallbackHolding(true/false)` only in fallback mode.

- [ ] **Step 3: Run integration tests and verify RED**

Run: `npm test -- --run tests/desktop-app.test.js tests/player-controller.test.js`

Expected: FAIL because directors, UI method, and fallback routing are not composed.

- [ ] **Step 4: Compose directors and lifecycle**

Instantiate `FoundPhoneDirector` and `DoorDefenseDirector` after `HorrorDirector`, passing `event => this.phone?.send(event)`. Route matching presence contexts. In `tick`, update found phone, door defense, and shadow quest; run `HorrorDirector.update` only while none owns a cinematic. Abort both on peer disconnect and destroy.

Remove `onComplete`, `completeGame`, restart-button wiring, and the elevator completion overlay dependency.

- [ ] **Step 5: Add progress UI and fallback control**

Add one unframed top-center progress band:

```html
<div class="door-defense" id="door-defense" hidden>
  <span id="door-defense-status">抵住门</span>
  <div class="door-defense-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <span></span>
  </div>
</div>
```

Keep dimensions stable across viewports, use no nested cards, and remove old elevator completion copy. Bind fallback Space keydown/up in `DesktopApp` and remove listeners in `destroy()`.

- [ ] **Step 6: Add audio cues**

Replace `elevator` with `lock-twist`, `door-rattle`, `door-impact`, `brace-strain`, `door-latch`, `phone-pickup`, and `phone-release` branches using the existing `tone` and `noiseBurst` helpers. Ensure repeated impact cues are scheduled by director phase transitions, not every render frame.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- --run tests/desktop-app.test.js tests/player-controller.test.js tests/door-defense-director.test.js tests/found-phone-director.test.js`

```bash
git add src/desktop/DesktopApp.js tests/desktop-app.test.js src/desktop/ui.js src/desktop/styles.css src/desktop/audio.js src/desktop/PlayerController.js tests/player-controller.test.js
git commit -m "feat: integrate door defense and found phone scenes"
```

---

### Task 9: Full Regression, Public Preview, and Visual Verification

**Files:**
- Modify only if verification reveals a task-owned defect.

**Interfaces:**
- Consumes: complete integrated application.
- Produces: verified build and refreshed temporary HTTPS preview.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: every test file passes with zero failures. Fix regressions by returning to the failing task's RED/GREEN cycle.

- [ ] **Step 2: Run production and whitespace verification**

Run: `npm run build`

Expected: Vite exits 0. Existing Tailwind-content and large desktop-chunk warnings may remain; no new error is allowed.

Run: `git diff --check`

Expected: exit 0; line-ending conversion warnings are informational.

- [ ] **Step 3: Start or refresh the HTTPS preview**

Run the existing Node server on port 4174 with `PUBLIC_CONTROLLER_ORIGIN` set to the active TryCloudflare URL. Reuse the running tunnel if healthy; otherwise start a new hidden `cloudflared tunnel --url http://localhost:4174` process. Verify `/`, `/controller?preview=1`, `/api/config`, and the served detector module all return HTTP 200.

- [ ] **Step 4: Run Playwright desktop/mobile visual smoke tests**

Capture desktop at 1440x900 and controller at 390x844. Assert:

- the exit door replaces the elevator and the WebGL canvas contains non-background pixels;
- the found phone is visible and targetable near the third doorway;
- the door progress bar is non-overlapping and stable at 0, 50, and 100 percent;
- the found-phone UI pages fit, swipe/tap navigation changes content, and icon buttons remain within safe areas;
- no console errors, blank canvases, or overlapping controls occur.

- [ ] **Step 5: Verify scripted state-machine smoke paths**

Use development hooks or direct class harnesses to exercise:

1. approach door -> calibrate -> hold 2 seconds -> release -> progress zero;
2. approach door -> hold 4 seconds -> secured -> exact pose restored;
3. focus floor phone -> pickup -> navigate three pages -> release -> pickup again.

- [ ] **Step 6: Report real-device boundary and handoff**

Provide the public URL and exact test sequence. State that automated frame fixtures and browser capture paths pass, while rear-camera autofocus, physical vibration, and real hand thresholds require the user's device pass. Keep the temporary-tunnel lifetime limitation explicit.
