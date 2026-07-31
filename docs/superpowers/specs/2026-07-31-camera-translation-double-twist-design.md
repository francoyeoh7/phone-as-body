# Camera Translation and Double-Twist Control Design

## Objective

Replace the current full-orientation camera control with two independent gesture channels:

- Physical phone translation controls desktop camera yaw and pitch.
- Wrist rotation never controls the camera. Two deliberate fast wrist twists trigger one interaction.

The controller remains an install-free phone web page. The design must work when the phone is held screen-up or rotated onto its side, and moving between those grips must not move the desktop camera.

## Interaction Contract

### View Control

- Moving the phone left or right changes horizontal view direction.
- Moving the phone up or down changes vertical view direction.
- Translation is rate-like gesture input rather than absolute room-scale positioning: movement changes the view while the phone is moving, and the view settles when movement stops.
- Small involuntary motion is ignored by a dead zone.
- A configurable sensitivity multiplier controls camera response.
- Vertical camera angle remains clamped to the existing playable range.

### Grip Changes

- Both the screen-up grip and side grip are valid neutral grips.
- Phone roll, pitch, and yaw do not directly change the desktop camera.
- While meaningful angular motion is detected, visual translation output is frozen.
- After rotation stops, the tracker waits for three stable camera frames before resuming translation. This prevents the image movement caused by a grip change from leaking into camera control.
- The tracker aligns visual movement using the phone gravity direction so left, right, up, and down retain the same meaning after the grip changes.

### Double-Twist Interaction

- A twist candidate requires both a minimum wrist angular speed and a minimum angular excursion. A fast sensor spike alone is insufficient.
- The first valid twist starts a 900 ms double-twist window and gives one short vibration pulse.
- A second valid twist in the opposite direction within that window triggers exactly one `interact` action and gives a distinct confirmation vibration.
- The two candidates must be separated by at least 120 ms so one physical twist cannot count twice.
- After a successful interaction, a 700 ms cooldown blocks additional candidates.
- A single fast grip change expires without interaction.
- Slow grip changes never become candidates, regardless of their total angle.
- Interaction may be sent when no object is selected; the authoritative desktop ignores it. The existing interaction button remains as a fallback.

Initial thresholds are 170 degrees per second angular speed and 24 degrees excursion. They are constants covered by tests and may be tuned during physical-device verification without changing the interaction model.

## Tracking Approach

### Camera Input

The controller requests the rear camera together with motion permission after the player's explicit enable gesture. Camera frames are processed locally and are never displayed, recorded, transmitted, or stored.

The camera stream targets 320 by 240 at up to 30 frames per second. Analysis uses a much smaller grayscale frame to keep phone CPU and battery use bounded.

### Visual Motion Estimate

Consecutive grayscale frames produce a compact global motion estimate. A lightweight, established browser computer-vision library provides corner detection and pyramidal optical flow; controller code reduces the tracked points into a robust similarity transform. The estimator separates:

- image translation,
- image rotation,
- image scale change,
- confidence based on scene detail and match quality.

Angular sensor data rejects frames captured during phone rotation. Gravity and current grip orientation rotate the remaining visual movement into a stable controller coordinate system. The horizontal component drives yaw. The vertical signal blends image translation and scale change so raising or lowering a screen-up phone remains detectable when the rear camera faces the floor.

This is a relative gesture detector, not an absolute six-degree-of-freedom position tracker. Its purpose is responsive view control over normal hand travel, not measuring centimeters or preserving a room-space coordinate indefinitely.

### Low-Confidence Behavior

When the camera sees a blank wall, darkness, heavy blur, or an obstructed lens, the tracker outputs zero rather than guessing. The phone status indicates that tracking is temporarily weak. Existing joystick movement and fallback buttons continue working.

## Components

### `CameraMotionTracker`

- Owns camera permission, stream lifecycle, frame sampling, grayscale conversion, visual motion estimation, and confidence gating.
- Emits normalized `{ x, y, confidence }` translation samples.
- Stops camera tracks when the controller is destroyed or hidden.

### `WristGestureDetector`

- Consumes device angular velocity and orientation samples.
- Reports whether rotation is currently active so camera translation can be frozen.
- Implements the two-candidate window, minimum separation, and cooldown state machine.
- Emits a single callback only after a completed double twist.

### `MotionController`

- Requests both device-orientation and device-motion permission.
- Coordinates gravity alignment, camera tracking, rotation freeze, and resume stabilization.
- Emits explicit view-motion samples instead of a full orientation quaternion.

### Controller and Protocol

The controller input payload changes from `orientation` to `viewMotion`:

```js
{
  move: { x, y },
  viewMotion: { x, y, confidence }
}
```

The controller sends `interact` through the existing action channel after a successful double twist. Protocol validation rejects non-finite values and clamps normalized view motion to `[-1, 1]`.

### Desktop Player

The desktop integrates `viewMotion` into camera yaw and pitch using frame-time-independent damping. When input returns to zero, view velocity settles quickly without snapping the camera back to center. Quaternion calibration and full phone orientation mapping are removed from the phone-control path. Mouse fallback remains unchanged.

## Permission and Lifecycle

- Enabling control requests motion access first, then camera access from the same explicit user action.
- If motion permission fails, phone view and double-twist interaction remain unavailable.
- If camera permission fails, the UI explains that translation control needs camera access; joystick and touch actions remain available.
- Hiding the controller tab stops view input, pauses the game as it does today, and releases the camera stream.
- Resuming requires an explicit tap and fresh sensor stabilization.
- Recenter clears current view velocity, visual history, grip alignment, and double-twist candidate state.

## Testing

Unit tests cover:

- normalization and dead-zone behavior for horizontal and vertical visual motion,
- zero output for low-confidence or rotation-contaminated frames,
- stable coordinate meaning across screen-up and side grips,
- one fast twist not interacting,
- two opposite-direction valid twists inside 900 ms interacting exactly once,
- two same-direction candidates not interacting,
- candidates outside the window not interacting,
- slow twists and isolated sensor spikes not interacting,
- minimum candidate separation and post-success cooldown,
- protocol validation for `viewMotion`,
- desktop yaw/pitch integration, damping, inversion, and pitch clamp.

Browser and physical-device checks cover:

- camera and motion permission flows on the target iPhone,
- horizontal and vertical view response in both supplied grip positions,
- no view movement during slow or fast grip transitions,
- intentional double twist interaction with no common false positives,
- weak tracking behavior in darkness and with the lens covered,
- camera release after pause, backgrounding, disconnect, and page exit.

## Acceptance Criteria

- The phone controls desktop yaw and pitch through visible physical translation without requiring phone-screen dragging.
- Changing between the two supplied grip positions does not visibly move the desktop camera.
- One fast grip change does not interact.
- Two deliberate fast wrist twists within 900 ms trigger exactly one interaction.
- Ordinary translation does not trigger interaction.
- View control pauses safely when visual confidence is poor or the phone is rotating.
- No camera frame leaves the phone.
- The existing game remains completable with the phone controller, with touch interaction retained as fallback.
