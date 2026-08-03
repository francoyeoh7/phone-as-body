# Rear-Camera Door Defense and Found Phone Design

## Goal

Replace the unreliable one-frame camera gesture with a lightweight rear-camera detector that supports both pulse and continuous-presence interactions. Use it to power a four-second door-defense sequence and a reusable found-phone inspection scene without adding a machine-learning runtime or increasing the game package materially.

## Confirmed Product Rules

- Prefer the rear camera with `facingMode: { ideal: "environment" }` and fall back to any available camera if the browser cannot provide it.
- Ordinary gesture interactions have an exact 500 ms cooldown. They do not add a second quiet-frame cooldown after those 500 ms.
- Door defense requires four uninterrupted seconds of camera presence.
- One absent presence sample fails door defense immediately, clears progress to zero, and restarts the breach attempt.
- The found phone is on the corridor floor and can be inspected repeatedly.
- The physical controller screen becomes the found phone UI while the object is held.
- The found phone UI supports horizontal swipes, icon arrow buttons, and tapping the left or right half of the screen.
- One absent presence sample immediately closes the found phone UI and returns the object to the floor.
- Camera frames remain local to the controller device and are never transmitted or stored.
- No MediaPipe or other ML/model dependency is added. The current small web package and low mobile CPU cost remain priorities.

## Architecture

The feature is split into three independent units:

1. `CameraMotionDetector` produces either a one-shot `pulse` or a continuous `presence` signal. It has no knowledge of story objects.
2. `DoorDefenseDirector` owns proximity acquisition, cinematic camera control, door animation, progress, failure, success, and cleanup.
3. `FoundPhoneDirector` owns the floor phone, first-person held prop, controller UI activation, release, and repeatability.

`DesktopApp` remains the coordinator. It forwards controller actions to the active director and sends explicit mode events to the controller. This avoids adding door or phone-specific branches to the detector.

## Camera Capture and Scoring

### Capture

- Request a 640x480 rear-facing stream at an ideal 20 FPS, with a maximum of 24 FPS.
- Analyze 96x72 grayscale frames every 50 ms.
- Query `MediaStreamTrack.getSettings().facingMode` when available and report the actual selected facing mode through detector state.
- If the environment-facing request fails, retry once with an unconstrained video source before declaring the camera unavailable.

### Pulse Mode

Pulse mode is used for ordinary interactables such as the fuse, panel, washbasin, and found phone pickup.

- Keep a four-frame history and compare the current frame with the frame approximately 150 ms earlier instead of only the immediately previous frame.
- Maintain an exponential moving noise floor while no gesture is active.
- Use the noise floor to raise thresholds on noisy cameras while retaining a low fixed minimum for clean cameras.
- Accept a connected local foreground region or a sufficiently large moderate frame change.
- Reject near-global changes affecting at least 96 percent of the frame.
- After a pulse, suppress further pulses for exactly 500 ms. Frame capture and reference updates continue during suppression.
- At 500 ms the detector is armed again without waiting for three more quiet frames.

The detector retains the last quiet reference frame. This reference becomes the frozen baseline when a pulse immediately transitions into presence mode, allowing the hand that picked up the found phone to remain detected.

### Presence Mode

Presence mode compares every current frame against a frozen background captured before the hand appears.

- `fresh-baseline` captures a new baseline after three stable samples. Door defense uses this mode before prompting the player to brace.
- `retained-baseline` reuses the last quiet pulse reference. Found phone pickup uses this mode so the pickup gesture becomes the held state.
- Presence remains true while a connected foreground region differs from the baseline, even if that foreground becomes motionless.
- One false presence sample is a release. There is no debounce because the requested failure rule is immediate.
- Presence state is sent only when it changes. Socket.IO reliability handles delivery; no high-frequency video or score stream is sent.
- Backgrounding, pausing, camera loss, or controller disconnection forces presence false.

## Desktop-Controller Protocol

Add the following controller action:

- `gesture-presence`: `{ action: "gesture-presence", ready: boolean, active: boolean, context: "door-defense" | "found-phone" }`

Add the following desktop events:

- `gesture-mode`: `{ type: "gesture-mode", mode: "pulse" | "presence", context, baseline: "fresh" | "retained" }`
- `found-phone-ui`: `{ type: "found-phone-ui", active: boolean }`
- `haptics`: `{ type: "haptics", active: boolean, pattern: "brace" }`

Normal camera pulses continue to use the existing `interact` action. Context values are validated before routing so a delayed release from one activity cannot affect another.

The controller sends `ready: true, active: false` as soon as a presence baseline is valid. It then sends another action whenever `active` changes. The desktop never advances a continuous interaction before receiving `ready: true` for the matching context.

## Exit Door Scene

Remove the elevator doors, elevator interaction volume, elevator collider naming, elevator audio cue, and completion overlay dependency. Replace them with a closed institutional security door at the same corridor endpoint.

The door model includes:

- a thick painted metal leaf and reinforced frame;
- a mechanical handle, visible lock cylinder, strike plate, hinges, and observation slot;
- a narrow movable door gap used during failed breach attempts;
- first-person sleeved forearms and hands that become visible while bracing;
- separate transform roots for handle twisting, door impacts, and hand placement.

The model remains procedural Three.js geometry and canvas materials to preserve package size. Geometry is layered and beveled where practical so it reads as a finished game prop rather than a single box.

## Door Defense State Machine

The story objective `reach-elevator` becomes `reach-door`. The terminal event becomes `door-defended`, and the completed state becomes `secured`.

1. **Dormant:** The door exists but cannot start its finale before power is restored.
2. **Acquired:** When the objective is `reach-door` and the player comes within 2.35 m, save the exact player pose and begin cinematic control automatically.
3. **Threat intro:** Over 1.2 seconds, move the camera toward the door. Twist the handle, move the lock, rattle the leaf, play lock and impact audio, and show the attacker trying to enter.
4. **Calibrating:** Request `fresh-baseline` presence mode and wait for three stable samples before showing the brace instruction.
5. **Bracing:** On presence true, show the first-person arms, start brace haptics, and fill a desktop progress bar continuously for 4.0 seconds.
6. **Failed:** On the first presence false sample, stop haptics, hide or relax the arms, set progress to zero, kick the door open slightly, then return to the threat intro for another attempt.
7. **Secured:** At four uninterrupted seconds, latch the lock, stop impacts and haptics, mark the story state `secured`, and hide the progress UI.
8. **Returning:** Over 1.0 second, blend back to the saved camera target, restore the exact saved body and camera pose, end cinematic mode, and resume exploration. Do not show the old game-completion overlay.

Disconnect, pause, or destroy routes through the same failure/abort cleanup: haptics off, progress hidden, pose restored, and controls returned.

## Found Phone Scene

Place a dark smartphone on the floor near the third corridor doorway, before the power panel and exit door. Give it a cracked emissive screen, side buttons, camera bump, and a subtle halo only while targeted. It remains available before and after the door sequence.

Pickup flow:

1. Pulse interaction on the focused floor phone starts inspection.
2. Hide the floor object and show a first-person held-phone prop.
3. Switch the detector to `retained-baseline` presence mode.
4. Send `found-phone-ui: active` to the controller and suspend movement/view input while inspection is active.
5. A presence false event closes the UI immediately, hides the held prop, returns the floor object, restores pulse mode, and resumes control.

The controller UI has three pages:

- **Messages:** A nurse warns that the person at the north door is not security and that Room 617 was already evacuated.
- **Maintenance note:** Emergency locking requires four seconds of uninterrupted pressure after power is restored.
- **Call log:** Repeated missed calls from extension 617 with a short transcript warning not to let the corridor door open.

Navigation wraps between pages. Swipe thresholds are based on horizontal pointer displacement; left/right Lucide arrow buttons and taps on the left/right halves call the same page-change function. The overlay consumes its own pointer events so it does not move the player or engage the motion clutch.

## Haptics

When bracing begins, the controller repeatedly requests a short uneven `navigator.vibrate` pattern to represent impacts. `navigator.vibrate(0)` is called on release, success, pause, disconnect, and destroy.

Actual handset vibration depends on browser support. When the API is absent or rejects the request, the controller uses a synchronized screen impact animation and short Web Audio pulse. This fallback is explicit and does not claim to produce physical haptics on unsupported iPhones.

## UI

Desktop additions:

- a compact top-center door-defense progress track with stable dimensions;
- status text for calibrating, bracing, failed, and secured states;
- no new card container and no nested panel treatment;
- the old elevator completion overlay copy is removed.

Controller additions:

- a full-screen found-phone interface above the normal controller surface;
- small status treatment for rear-camera calibration and sustained presence;
- no live camera preview and no frame upload;
- responsive safe-area padding for portrait and landscape phones.

## Audio and Visual Feedback

- Add separate cues for lock twisting, door rattle, hard impact, brace strain, success latch, phone pickup, and phone release.
- Door impacts use transform animation, subtle camera displacement, light response, and audio rather than only subtitles.
- Reduced-motion settings remove camera shake but retain door, progress, audio, and state feedback.

## Error Handling

- If rear-camera selection fails, retry with any available camera and report the selected mode.
- If no camera can start, ordinary touch interaction remains available. Continuous scenes expose a keyboard development fallback, but the public phone flow explains that camera permission is required.
- If presence mode cannot obtain a stable baseline, it remains in calibration rather than starting false progress.
- A stale presence event with the wrong context is ignored.
- Found-phone inspection and door defense are mutually exclusive; starting one explicitly closes the other.

## Testing

Automated tests cover:

- rear-facing constraints and fallback capture;
- pulse detection against a 150 ms reference;
- the exact 500 ms pulse cooldown;
- adaptive noise rejection and low-contrast gesture acceptance;
- static presence against a frozen baseline;
- immediate release on the next absent sample;
- retained baseline pickup behavior;
- protocol validation and context routing;
- door proximity acquisition, intro, immediate failure, four-second success, and exact pose restoration;
- phone pickup, page navigation, immediate release, repeatability, and input suppression;
- haptic start/stop cleanup on every exit path;
- objective migration from elevator to door.

Final verification includes the full Vitest suite, production build, `git diff --check`, public HTTPS endpoint checks, desktop and mobile Playwright screenshots, WebGL canvas-pixel checks, and a real-device rear-camera pass performed by the user.

## Non-Goals

- No cloud vision, recorded video, uploaded camera frames, or identity recognition.
- No semantic hand-pose classification.
- No native iOS or Android wrapper in this iteration.
- No new external 3D asset package or large model download.
