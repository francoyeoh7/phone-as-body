# Phone-Controlled Horror Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an original browser-based first-person horror demo whose movement, view direction, flashlight, interactions, pause state, and private story events are controlled from a paired phone.

**Architecture:** A Node.js server hosts a Vite application and a Socket.IO session relay. The desktop route owns the authoritative Three.js/Rapier game simulation; the controller route sends timestamped joystick, orientation, and command inputs after QR pairing. Shared pure modules implement orientation math, joystick normalization, session rules, and objective progression so the risky behavior can be tested without a browser.

**Tech Stack:** Node.js 22, Vite, Three.js, Rapier 3D, Express, Socket.IO, QRCode, Vitest, HTML/CSS, Web Audio, Device Orientation API

---

## File Map

- `package.json`: dependencies and run/test/build scripts.
- `index.html`: common Vite entry document.
- `server/index.js`: HTTP server, Vite middleware, static production hosting, and Socket.IO bootstrap.
- `server/session-registry.js`: room creation, desktop/controller attachment, input validation, and disconnect behavior.
- `src/main.js`: selects desktop or controller application from the route.
- `src/shared/protocol.js`: event names, room-code validation, and input payload validation.
- `src/shared/orientation.js`: quaternion conversion, calibration, relative yaw/pitch, dead zone, clamp, and adaptive smoothing.
- `src/shared/joystick.js`: floating joystick vector normalization.
- `src/shared/objectives.js`: deterministic objective state machine.
- `src/desktop/DesktopApp.js`: desktop lifecycle and render/update loop.
- `src/desktop/create-scene.js`: original corridor geometry, materials, lights, props, and interactables.
- `src/desktop/PlayerController.js`: movement, camera orientation, collision, and desktop fallback input.
- `src/desktop/HorrorDirector.js`: objectives, phone messages, scripted lighting, silhouette, and escape sequence.
- `src/desktop/PhoneSession.js`: room creation, controller input, reconnect state, and outbound phone events.
- `src/desktop/audio.js`: procedural Web Audio ambience and cues.
- `src/desktop/ui.js`: pairing, objective, interaction, pause, and completion overlays.
- `src/desktop/styles.css`: full-screen desktop game presentation.
- `src/controller/ControllerApp.js`: controller lifecycle, permission state, commands, and phone event UI.
- `src/controller/MotionController.js`: Device Orientation permission, sampling, screen-orientation correction, and recentering.
- `src/controller/VirtualJoystick.js`: pointer-event floating joystick implementation.
- `src/controller/ControllerSocket.js`: room pairing and resilient input transport.
- `src/controller/styles.css`: stable portrait/landscape controller layout.
- `tests/orientation.test.js`: sensor math and smoothing tests.
- `tests/joystick.test.js`: touch-vector normalization tests.
- `tests/objectives.test.js`: objective transition tests.
- `tests/session-registry.test.js`: room pairing and disconnect tests.

### Task 1: Project Scaffold and Test Harness

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `server/index.js`
- Create: `src/main.js`

- [ ] **Step 1: Create package metadata and scripts**

```json
{
  "name": "corridor-617",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "NODE_ENV=development node server/index.js",
    "build": "vite build",
    "start": "NODE_ENV=production node server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@dimforge/rapier3d-compat": "^0.19.0",
    "express": "^5.1.0",
    "qrcode": "^1.5.4",
    "socket.io": "^4.8.1",
    "socket.io-client": "^4.8.1",
    "three": "^0.178.0",
    "vite": "^7.0.0"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created without audit-blocking errors.

- [ ] **Step 3: Add the common HTML and route entry**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="theme-color" content="#090b0c" />
    <title>Corridor 617</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`src/main.js` must import and mount `ControllerApp` when `location.pathname === "/controller"`, and otherwise mount `DesktopApp`.

- [ ] **Step 4: Add one-port Vite/Express server**

`server/index.js` must create an Express app and HTTP server, attach Socket.IO, use Vite middleware in development, serve `dist` in production, and listen on `0.0.0.0` using `PORT || 4173`.

- [ ] **Step 5: Verify scaffold**

Run: `npm test`

Expected: Vitest exits successfully with no test files or a configured `passWithNoTests` flag.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json index.html server/index.js src/main.js
git commit -m "chore: scaffold phone-controlled horror demo"
```

### Task 2: Room Pairing and Input Relay

**Files:**
- Create: `src/shared/protocol.js`
- Create: `server/session-registry.js`
- Create: `tests/session-registry.test.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write failing session tests**

Tests must assert that:

```js
const registry = createSessionRegistry({ randomCode: () => "617042" });
const room = registry.createDesktop("desktop-socket");
expect(room.code).toBe("617042");
expect(registry.attachController("617042", "phone-socket")).toEqual({ ok: true });
expect(registry.acceptInput("617042", "phone-socket", { seq: 1, move: { x: 0, y: 1 } }).ok).toBe(true);
expect(registry.acceptInput("617042", "phone-socket", { seq: 1, move: { x: 1, y: 0 } }).ok).toBe(false);
registry.disconnect("phone-socket");
expect(registry.get("617042").input.move).toEqual({ x: 0, y: 0 });
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/session-registry.test.js`

Expected: FAIL because `createSessionRegistry` does not exist.

- [ ] **Step 3: Implement protocol validation and registry**

`src/shared/protocol.js` must export frozen event names and validators that accept only finite joystick values in `[-1, 1]`, finite quaternion values, booleans, supported action strings, and monotonically increasing integer sequence numbers.

`server/session-registry.js` must keep rooms in a `Map`, generate six-digit codes, allow one desktop and one replaceable controller, reject input from non-owners, reject stale sequence numbers, and clear movement on controller disconnect.

- [ ] **Step 4: Wire Socket.IO events**

The server must implement `desktop:create`, `controller:join`, `controller:input`, `controller:action`, `desktop:event`, and disconnect forwarding. The server never advances game state.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/session-registry.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.js server/session-registry.js server/index.js tests/session-registry.test.js
git commit -m "feat: add paired phone session relay"
```

### Task 3: Orientation Calibration and Smoothing

**Files:**
- Create: `src/shared/orientation.js`
- Create: `tests/orientation.test.js`

- [ ] **Step 1: Write failing orientation tests**

Tests must cover identity calibration, a positive yaw turn, pitch clamping, dead-zone suppression, normalized quaternions, and faster smoothing response at high angular speed.

```js
const tracker = createOrientationTracker({ deadZoneDeg: 1, maxPitchDeg: 72 });
tracker.calibrate({ x: 0, y: 0, z: 0, w: 1 });
expect(tracker.update({ x: 0, y: 0, z: 0, w: 1 }, 0.016)).toMatchObject({ yaw: 0, pitch: 0 });
expect(applyDeadZone(0.5, 1)).toBe(0);
expect(clampPitch(90, 72)).toBe(72);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/orientation.test.js`

Expected: FAIL because `src/shared/orientation.js` is missing.

- [ ] **Step 3: Implement sensor math**

Export `normalizeQuaternion`, `inverseQuaternion`, `multiplyQuaternions`, `relativeQuaternion`, `quaternionToYawPitch`, `applyDeadZone`, `clampPitch`, `adaptiveAlpha`, and `createOrientationTracker`. The tracker stores a baseline quaternion, ignores non-finite samples, and returns degrees suitable for the desktop camera.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/orientation.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/orientation.js tests/orientation.test.js
git commit -m "feat: add calibrated phone orientation tracking"
```

### Task 4: Mobile Controller UI and Virtual Joystick

**Files:**
- Create: `src/shared/joystick.js`
- Create: `src/controller/ControllerSocket.js`
- Create: `src/controller/MotionController.js`
- Create: `src/controller/VirtualJoystick.js`
- Create: `src/controller/ControllerApp.js`
- Create: `src/controller/styles.css`
- Create: `tests/joystick.test.js`

- [ ] **Step 1: Write failing joystick tests**

```js
expect(normalizeJoystick({ dx: 0, dy: 0, radius: 60 })).toEqual({ x: 0, y: 0 });
expect(normalizeJoystick({ dx: 30, dy: -30, radius: 60 })).toEqual({ x: 0.5, y: 0.5 });
expect(normalizeJoystick({ dx: 120, dy: 0, radius: 60 })).toEqual({ x: 1, y: 0 });
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/joystick.test.js`

Expected: FAIL because `normalizeJoystick` does not exist.

- [ ] **Step 3: Implement joystick normalization and pointer lifecycle**

The floating joystick must set its origin on `pointerdown`, capture that pointer, clamp the thumb to the configured radius, emit normalized vectors, and emit `{ x: 0, y: 0 }` on up, cancel, page hide, or lost capture.

- [ ] **Step 4: Implement motion permission and quaternion output**

`MotionController` must request `DeviceOrientationEvent.requestPermission()` when present, otherwise register directly. It must convert alpha/beta/gamma plus current screen orientation to a normalized quaternion, support `recenter()`, and emit at most one latest sample per animation frame.

- [ ] **Step 5: Build the phone layout**

The controller must have stable safe-area-aware regions: connection header, motion-permission/calibration overlay, floating joystick zone, flashlight button, interact button, recenter icon, pause icon, and a full-screen private-message overlay. Buttons use symbols and accessible labels rather than explanatory visible text during play.

- [ ] **Step 6: Add resilient transport**

Send combined input snapshots with monotonically increasing sequence numbers at 30 Hz and immediate action events for interact, flashlight, recenter, and pause. Rejoining the same room replaces the prior controller socket.

- [ ] **Step 7: Run tests and build**

Run: `npm test -- tests/joystick.test.js tests/orientation.test.js && npm run build`

Expected: all tests pass and Vite creates `dist`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/joystick.js src/controller tests/joystick.test.js
git commit -m "feat: add install-free phone controller"
```

### Task 5: Desktop Pairing UI and Phone Session

**Files:**
- Create: `src/desktop/PhoneSession.js`
- Create: `src/desktop/ui.js`
- Create: `src/desktop/styles.css`
- Create: `src/desktop/DesktopApp.js`

- [ ] **Step 1: Implement room creation and QR code**

`PhoneSession` creates a desktop room, builds `/controller?room=<code>` against `PUBLIC_CONTROLLER_ORIGIN` or `location.origin`, renders the QR code, stores the latest valid input, zeros movement on disconnect, and dispatches phone actions as DOM events.

- [ ] **Step 2: Implement desktop overlays**

Create unframed overlays for title/loading, QR pairing, objective text, centered reticle, interaction prompt, pause, reconnect, and completion. The QR overlay shows the room code as a fallback and disappears only after a controller joins or desktop fallback is chosen.

- [ ] **Step 3: Add desktop application lifecycle**

`DesktopApp` mounts overlays, starts `PhoneSession`, initializes scene and audio only after user interaction, runs the animation loop, pauses on visibility loss, and disposes WebGL, audio, socket, and event handlers.

- [ ] **Step 4: Build verification**

Run: `npm run build`

Expected: build succeeds with no unresolved imports.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/PhoneSession.js src/desktop/ui.js src/desktop/styles.css src/desktop/DesktopApp.js
git commit -m "feat: add desktop pairing and game shell"
```

### Task 6: Original 3D Corridor and Player Movement

**Files:**
- Create: `src/desktop/create-scene.js`
- Create: `src/desktop/PlayerController.js`
- Modify: `src/desktop/DesktopApp.js`

- [ ] **Step 1: Create the corridor scene**

Build original geometry for a 28-meter corridor, start room, maintenance alcove, electrical panel, elevator, doors, trim, ceiling fixtures, debris, fuse pickup, and a distant silhouette. Use procedural CanvasTexture materials for painted wall wear, dark wood, concrete, paper notes, and subtle grime. Add cool emergency fill, intermittent ceiling lights, storm flashes, fog, and a warm SpotLight flashlight attached to the camera.

- [ ] **Step 2: Add Rapier collision**

Create fixed cuboid colliders for floor, ceiling boundaries, walls, closed doors, panel, and elevator. Add a kinematic capsule player and use shape casts or kinematic character movement to prevent wall penetration and stair-step jitter.

- [ ] **Step 3: Implement combined phone movement and orientation**

Apply phone yaw/pitch to the camera. Convert joystick X/Y into camera-relative planar velocity with acceleration and damping. Merge keyboard/mouse fallback without allowing stale phone input to continue. Update footstep cadence from actual horizontal velocity.

- [ ] **Step 4: Add center interaction raycast**

Raycast from camera center, highlight the nearest enabled interactable within 2.2 meters, show its command label, and invoke its action on phone interact or keyboard `E`.

- [ ] **Step 5: Verify performance and build**

Run: `npm run build`

Expected: build succeeds and the scene renders on the M4 Mac without console errors.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/create-scene.js src/desktop/PlayerController.js src/desktop/DesktopApp.js
git commit -m "feat: build playable corridor scene"
```

### Task 7: Objectives, Horror Events, and Phone Story Beats

**Files:**
- Create: `src/shared/objectives.js`
- Create: `src/desktop/HorrorDirector.js`
- Create: `src/desktop/audio.js`
- Create: `tests/objectives.test.js`
- Modify: `src/desktop/DesktopApp.js`

- [ ] **Step 1: Write failing objective tests**

```js
const story = createObjectiveState();
expect(story.current()).toBe("find-fuse");
expect(story.dispatch("panel-used").accepted).toBe(false);
expect(story.dispatch("fuse-collected").next).toBe("restore-power");
expect(story.dispatch("panel-used").next).toBe("reach-elevator");
expect(story.dispatch("elevator-entered").next).toBe("escaped");
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/objectives.test.js`

Expected: FAIL because the objective module is missing.

- [ ] **Step 3: Implement deterministic objective state**

Accept only valid ordered events, return the current objective and accepted transition, and serialize state for reconnect/debugging.

- [ ] **Step 4: Implement scripted events**

Collecting the fuse sends a private phone message, plays a phone ringtone, requests vibration, turns off the nearest light, and arms the silhouette reveal. Looking behind makes the silhouette visible; placing the flashlight on it makes it disappear. Restoring power sequences ceiling lights toward the player, unlocks the elevator, and starts a short pursuit timer. Entering the elevator closes the doors and completes the demo.

- [ ] **Step 5: Add procedural audio**

Use Web Audio oscillators, filtered noise, gain envelopes, and stereo panning for storm ambience, electrical hum, fluorescent buzz, footsteps, impact stingers, ringtone, and elevator movement. Start audio only after explicit desktop input.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- tests/objectives.test.js && npm run build`

Expected: tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/objectives.js src/desktop/HorrorDirector.js src/desktop/audio.js src/desktop/DesktopApp.js tests/objectives.test.js
git commit -m "feat: add complete horror objective sequence"
```

### Task 8: Reliability, Accessibility, and Cross-Device Polish

**Files:**
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/MotionController.js`
- Modify: `src/controller/styles.css`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/PhoneSession.js`
- Modify: `src/desktop/styles.css`

- [ ] **Step 1: Add explicit recovery states**

Handle unsupported sensors, denied permission, lost socket, controller replacement, orientation change, hidden controller tab, and desktop visibility loss. Every failure state must expose a single useful recovery action.

- [ ] **Step 2: Add comfort settings**

Expose motion sensitivity, invert Y, smoothing strength, reticle visibility, reduced motion, and subtitles from the phone pause menu. Store preferences in local storage and apply them immediately.

- [ ] **Step 3: Prevent layout shifts and overlap**

Use fixed control-zone dimensions, safe-area insets, landscape adaptation, minimum 48px touch targets, no negative letter spacing, and text wrapping for permission/error screens. Ensure game overlays remain readable at 1280x720 and 390x844.

- [ ] **Step 4: Run full automated verification**

Run: `npm test && npm run build`

Expected: all tests pass and production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/controller src/desktop
git commit -m "feat: harden controller and comfort settings"
```

### Task 9: Live Phone Connection and Visual Verification

**Files:**
- Create: `README.md`
- Modify: files discovered during verification only when required to fix observed defects.

- [ ] **Step 1: Start the production-like server**

Run: `npm run dev`

Expected: server prints the local desktop URL and remains running.

- [ ] **Step 2: Establish HTTPS controller access**

Use an available HTTPS tunnel and restart with `PUBLIC_CONTROLLER_ORIGIN=<https-url>` when needed. Confirm the generated controller QR points to `/controller?room=<six digits>` on the secure origin.

- [ ] **Step 3: Verify desktop visually**

At 1440x900 and 1280x720, verify the canvas is nonblank, corridor framing is correct, QR overlay fits, flashlight is visible, objectives do not overlap, and horror events render. Sample canvas pixels to confirm nonuniform output.

- [ ] **Step 4: Verify controller visually**

At 390x844 and 844x390, verify joystick, interact, flashlight, recenter, and pause controls remain stable; permission and message overlays wrap; safe-area insets are respected; and no controls overlap.

- [ ] **Step 5: Verify a real phone session**

Scan the QR code, grant motion access, calibrate, walk using the joystick while turning the phone, recenter, toggle the flashlight, collect the fuse, receive the private message, restore power, disconnect/reconnect once, and finish at the elevator.

- [ ] **Step 6: Document operation**

`README.md` must explain prerequisites, `npm install`, local start, HTTPS phone access, controls, keyboard fallback, supported sensor behavior, and troubleshooting for motion permission and reconnects.

- [ ] **Step 7: Final verification and commit**

Run: `npm test && npm run build && git status --short`

Expected: tests and build pass; status shows only intentionally generated ignored output.

```bash
git add README.md src server tests package.json package-lock.json index.html .gitignore
git commit -m "docs: finish corridor 617 demo"
```
