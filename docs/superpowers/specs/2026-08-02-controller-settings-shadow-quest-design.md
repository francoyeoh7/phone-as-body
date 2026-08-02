# Controller Settings And Shadow Quest Design

## Goal

Preserve the current phone orientation behavior exactly while making camera motion slightly softer, simplifying the phone UI, enlarging the usable touch area, improving the hospital corridor presentation, and adding the optional side quest “影子”.

## Frozen Control Baseline

The current orientation model is the accepted baseline. The implementation must not change sensor-axis selection, grip-roll handling, clutch calibration, dead zones, accumulated yaw/pitch deltas, recenter behavior, or the WebRTC input cadence in `MotionController`, `orientation`, `VirtualJoystick`, and `PhoneSession`.

Sensitivity remains available to the player, but it scales the accepted yaw and pitch deltas after they reach the desktop player controller. At the default value of `1.0`, the resulting target angle must match the current build.

Camera smoothing also lives only in the desktop presentation layer. Incoming deltas continue to accumulate immediately into a target yaw and pitch. The rendered camera approaches that target with frame-rate-independent exponential damping. A smoothing value of zero is immediate; the default adds only a short settling delay. Smoothing must never discard angle, alter recentering, or feed back into phone calibration.

## Phone UI

The play screen is one unified interaction surface:

- A compact gyro radar sits in the upper-left corner. Numeric sensor, network, clutch, and camera telemetry is removed.
- The existing pause control becomes a settings control in the upper-right corner.
- Recenter moves into the settings sheet so it no longer occupies the play surface.
- The flashlight and interaction icon buttons are removed.
- There is no fixed joystick zone. Any point on the play surface can start the same movement gesture.
- The radar and settings control are visual overlays with pointer events disabled or explicitly excluded; they must not reduce the usable area.

The settings sheet contains only:

- `视角灵敏度`, with default `1.0` and a practical range of `0.6` to `1.6`.
- `转向平滑`, with default “轻微”, where zero is immediate and the maximum remains short enough to avoid sluggish control.
- `重新校准方向`, as a clear command.

Existing internal defaults such as subtitles and reduced-motion behavior may remain in desktop code, but they are not exposed as phone settings in this demo.

Opening settings pauses locomotion, clears joystick engagement, and prevents background touches from becoming interactions. Closing settings resumes the previous connected state.

## Single-Tap Interaction

Interaction uses one short tap anywhere on the play surface. There is no visible interaction button.

The same surface also supports movement and view control. On pointer-down, the app records a floating joystick origin at the touch point. Once the pointer travels beyond the tap threshold or remains held for `180 ms`, it becomes an active hold: displacement from that origin is normalized and sent as movement, while the existing phone clutch is engaged so phone pose deltas control the view. A stationary hold therefore permits turning in place. Releasing resets movement to zero and disengages the clutch. The drag origin is visualized only while active with a small transient ring at the contact point; no permanent control panel occupies the surface.

A touch becomes an interaction only when all conditions are true:

- It starts and ends outside the settings control, settings sheet, and permission overlays.
- The same pointer ends within `240 ms`.
- Travel from touch-down to touch-up is at most `10 CSS px`.
- No second pointer joined the gesture.
- The pointer was not canceled and the page did not lose visibility.

The action fires on pointer-up, followed by a short haptic pulse when supported. Holding past the time threshold, dragging past the distance threshold, settings use, multitouch, and canceled gestures never interact. The pointer classifier must transition from `tap-candidate` to `dragging` on the first threshold crossing and never reclassify that gesture as a tap.

The iPhone hardware Volume Down button is not a supported primary input. Mobile Safari does not reliably expose the physical button to a web page, and the browser Media Session API has no volume-button action. A future native iOS wrapper may revisit that option, but the web demo must not depend on it.

## Scene Direction

The existing Three.js corridor remains the foundation. A full third-party scene template would introduce avoidable integration, licensing, and performance risk. The recommended approach is a hybrid refinement:

- Improve the existing materials with lightweight, properly licensed texture maps when suitable assets are available.
- Add hospital-specific geometry: wall tile divisions, aged paint, conduit, fluorescent housings, metal window frames, observation glass, signage, and a visible operating-room space.
- Keep the corridor dim but readable without the flashlight.
- Preserve the brighter, wider flashlight core and soft spill so its beam remains visible in open space as well as on nearby walls.
- Reuse the current fog, dust, emergency lighting, and procedural props where they contribute to the atmosphere.

Assets must be local project files, documented with source and license, and compressed for browser delivery. Procedural geometry remains the fallback when a suitable permissive asset is unavailable.

## “影子” Side Quest

“影子” is independent from the main fuse, power, and elevator objective. It can be discovered once and does not block the main story.

### Discovery

One observation window exposes a real or staged opposite corridor and operating-room entrance. The side quest becomes eligible when:

- The player is within approximately `3.5 m` of the observation window.
- The flashlight is on.
- The flashlight/camera ray is within a small acquisition cone around the task point and is not occluded.
- The side quest is not complete and no cinematic is active.

When eligible, a restrained ring-and-crosshair task icon appears on the glass. Inside the final acquisition cone, a separate desktop aim-assist layer applies a mild attraction toward the task point. The assistance is capped and temporary; it does not modify sensor deltas or the frozen orientation model. Leaving the range or moving the light away removes the icon and assist.

### Interaction And Cinematic

A valid single tap while the task point is selected starts the sequence:

1. Save the player body position, target camera angles, rendered camera angles, and input state.
2. Lock locomotion, interaction selection, and phone camera presentation.
3. Ease the camera toward the window into a close peeking pose.
4. Reveal a dim opposite corridor. A deliberately soft, blurry black-clad figure crosses the corridor and enters the operating room.
5. Hold briefly after the operating-room door closes.
6. Ease the camera back and restore the exact saved body position and view.
7. Unlock controls, mark “影子” complete, and remove its task point permanently.

The player cannot retrigger, move, recenter, open settings, or activate a main-story interactable during the cinematic. Disconnecting the phone or hiding the page during the sequence must still restore a valid player pose and input state.

## Component Boundaries

- `ControllerApp` owns the simplified UI, settings persistence, and the unified tap/drag gesture classifier.
- `MotionDiagnostics` renders only the compact radar.
- `VirtualJoystick` becomes a full-surface floating joystick gesture helper and owns only pointer-to-movement normalization and visual transient state.
- `PlayerController` owns target camera angles, rendered camera smoothing, sensitivity scaling, temporary aim assist, and cinematic input locking.
- A dedicated `ShadowQuestDirector` owns side-quest eligibility, task-point visibility, cinematic timing, silhouette motion, completion, and restoration.
- `createScene` creates the refined corridor, observation window, opposite corridor, operating room, task-point object, and cinematic figure.
- `HorrorDirector` remains responsible for the existing main objective and coordinates only through shared player/scene interfaces.

This separation keeps the accepted orientation pipeline isolated and makes the side quest testable without rewriting the main story director.

## Failure Handling

- Invalid or missing settings fall back to sensitivity `1.0` and light smoothing.
- A duplicate or stale phone input sequence cannot apply a camera delta twice.
- A canceled tap clears the candidate without sending an action.
- If the task point becomes invalid before pointer-up, the normal interaction path runs and safely reports no selected target.
- Any cinematic abort restores player control and the last valid saved pose.
- Missing optional texture assets fall back to procedural materials rather than blocking scene startup.

## Verification

- Orientation and motion tests remain unchanged and continue to pass.
- Player-controller tests prove default sensitivity preserves current accumulated angles, zero smoothing is immediate, smoothing converges without losing total angle, and frame rate does not change the result materially.
- Controller and gesture tests prove the simplified UI, settings persistence, compact radar, full-surface floating movement, and every tap threshold/cancellation case.
- Shadow-quest tests prove eligibility requires distance plus flashlight aim, aim assist is bounded, interaction is one-shot, controls lock during the cinematic, and the exact saved pose is restored.
- Main-story tests prove fuse, panel, elevator, and existing silhouette behavior still work.
- Production build and full unit suite pass.
- Desktop and mobile browser checks cover layout, non-overlap, touch surface size, task-point visibility, cinematic framing, canvas output, and reconnection behavior.
