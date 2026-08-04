# Orientation, Knock, and Lighting Control Design

## Objective

Replace camera-based phone translation and double-wrist-twist interaction with a lower-effort controller model:

- Relative phone rotation controls desktop yaw and pitch with high gain.
- The virtual joystick controls locomotion only.
- A screen tap outside the joystick, the existing interaction button, or one detected physical knock sends one interaction action.
- The corridor remains dark but readable, and the flashlight is brighter with a visible, realistic beam and useful spill light.

The controller remains an install-free phone web page. It no longer requests camera access.

## Interaction Contract

### View Control

- Enabling motion or pressing recenter records the current phone orientation as the neutral reference.
- Subsequent orientation events are converted to normalized quaternions. The phone's local long axis, pointing from its bottom edge toward its top edge, is transformed into a world-space aim vector.
- View control follows the calibrated relative aim while the joystick clutch is held. Returning toward the neutral aim reverses the emitted delta, so the camera remains mathematically reversible; releasing the clutch freezes the view and the next engagement establishes a fresh neutral pose.
- Entering a 2.5-degree neutral cone completes and rearms the gesture. An opposite turn is accepted at full sensitivity as soon as the phone has re-entered that cone; there is no timed lockout.
- Rotation around the aim vector is treated as grip roll and discarded. Changing from the face-on grip in Figure 1 to the edge-on grip in Figure 4 therefore produces no intended view motion.
- Figure 1 to Figures 2/3 and Figure 4 to Figures 5/6 change the aim vector's horizontal azimuth and therefore control yaw. Changing its elevation controls pitch in either grip.
- Grip-transition filtering activates only when roll clearly dominates swing: at least 25 degrees of roll within a 250 ms window and at least 2.5 times the aim-vector change. While that condition holds, aim drift below 3 degrees is suppressed and drift from 3 to 6 degrees is smoothly blended from zero to full strength. Aim changes above 6 degrees retain full response. There is no hard view lock during a grip change, so a deliberate horizontal or vertical turn remains immediately detectable.
- Default gain is 3:1: approximately 20 degrees of deliberate phone rotation produces approximately 60 degrees of game-camera rotation at a calm movement speed.
- The existing sensitivity setting scales that gain while preserving a useful minimum and maximum.
- Per-sample tremor below 0.8 degrees is discarded. Calm motion remains limited to a 25-degree physical excursion. A signed, timestamped angular-velocity estimate activates a smooth rapid-turn envelope only after sustained same-direction movement: 90 degrees/second starts the ramp, 300 degrees/second reaches a 1.6x gain multiplier and a 120-degree physical excursion, and the resulting camera target is capped at 180 degrees per clutch. Individual emitted samples remain capped at approximately 45 degrees at 60 Hz, so a dropped sensor frame cannot become an uncontrolled snap; alternating tremor does not build the envelope.
- Pitch remains clamped to the existing playable range. Y inversion remains supported.
- Screen-orientation changes discard pending deltas, wait briefly for stabilization, and establish a new neutral sample.

### Input Separation

- Pointer movement that begins inside the joystick zone belongs exclusively to the joystick until that pointer ends or is cancelled.
- Joystick pointers never trigger interaction, including on release.
- A short, low-travel tap on the remaining play surface sends one `interact` action.
- The existing interaction button continues to send one `interact` action and stops propagation so it cannot also count as a play-surface tap.
- Settings, pause, recenter, flashlight, message, and other controls stop propagation and keep their existing commands.

### Physical Knock

The web platform does not expose Apple's system Back Tap gesture. The controller instead detects a short physical impact from motion samples:

- Prefer gravity-free `DeviceMotionEvent.acceleration` when available.
- Otherwise high-pass filter `accelerationIncludingGravity` to estimate the impulse component.
- The initial impact envelope requires a gravity-free or high-pass-filtered magnitude of at least 13 m/s2, followed by a value below 4 m/s2 within 140 ms. Ordinary turning and steady acceleration must not qualify.
- Trigger at most one interaction per impact and enforce a 450 ms cooldown.
- Suppress knock detection during calibration, pause, backgrounding, screen-orientation changes, and immediately after a recenter.
- Keep screen tap and the interaction button as reliable fallbacks because the browser cannot prove that an impact came specifically from the back of the phone.

The double-wrist-twist detector and its vibration candidate feedback are removed.

## Data Flow

Controller input snapshots become:

```js
{
  move: { x, y },
  viewDelta: { yaw, pitch }
}
```

- `MotionController` emits camera-angle deltas in degrees.
- `ControllerSocket` accumulates all deltas received between 30 Hz network flushes, sends their sum once, then clears only the pending delta. This avoids losing 60 Hz sensor samples.
- The server validates finite, bounded deltas and relays snapshots without interpreting them.
- `PhoneSession` copies and ages snapshots as before. Disconnect and stale-input paths return zero movement and zero view delta.
- `PlayerController` applies each new snapshot exactly once. It converts degrees to radians, applies sensitivity and inversion, accumulates yaw, and clamps pitch.
- Sequence numbers prevent the same `viewDelta` snapshot from being applied on multiple render frames.

## Motion Components

### Orientation Conversion

The existing quaternion helpers remain the mathematical base. A new device-orientation conversion helper handles alpha, beta, gamma, and current screen orientation without relying on one fixed Euler axis.

Each sample rotates the phone's local long-axis unit vector into the calibrated world frame. Its wrapped azimuth and elevation are compared with the current gesture's neutral vector. The gesture tracker emits only increasing outward excursion and rearms after returning to the neutral cone. Quaternion swing-twist decomposition around the long axis measures and removes grip roll, so the same yaw and pitch gestures work while the phone is face-on, edge-on, or transitioning between those grips.

### MotionController

`MotionController` owns:

- motion and orientation permission,
- orientation calibration and relative-delta output,
- impact filtering and knock cooldown,
- pause, resume, recenter, and screen-orientation lifecycle.

It no longer owns `CameraMotionTracker`, camera permission, confidence gating, visual history, rotation freezing, or wrist-twist state.

This work removes `CameraMotionTracker`, its tests, and the `jsfeat` dependency after the orientation path is covered and no imports remain.

## Lighting Design

### Corridor Readability

- Raise renderer exposure modestly from the current near-black value.
- Increase hemisphere fill enough to reveal floor, door, and wall silhouettes without flattening contrast.
- Increase ceiling and emergency practical-light contribution slightly while preserving pools of darkness between fixtures.
- Reduce fog density enough that distant geometry remains readable, while retaining the humid corridor atmosphere.

### Flashlight

- Increase the spotlight intensity and useful range.
- Use a tighter bright core with a wider penumbra rather than one flat cone.
- Add a low-intensity wide spill spotlight so nearby floor and side walls remain visible when the core is not aimed directly at a wall.
- Add a subtle volumetric-looking cone mesh with additive transparency and depth writing disabled. It is visual only and follows the camera; actual illumination still comes from lights.
- Keep soft shadows, but tune shadow bias and map size to avoid acne and obvious jagged edges.
- Flashlight toggling controls the core light, spill light, and cone together.

## Testing

Automated tests cover:

- wrapped device-orientation deltas and screen-orientation correction,
- face-on and edge-on gestures producing the same yaw and pitch signs,
- a 90-degree grip roll preserving the long-axis aim vector and producing no view delta,
- roll-dominant grip transitions suppressing sub-3-degree residual movement, blending 3-to-6-degree movement, and preserving full response above 6 degrees,
- 20 degrees of calm phone motion producing approximately 60 degrees of camera motion at default sensitivity,
- returning from an outward turn to the neutral cone producing no reverse view delta and rearming the next gesture,
- an opposite turn after rearming producing full response with the correct sign,
- no output for stationary jitter inside the dead zone,
- accumulated sensor deltas surviving a slower network flush,
- each sequence being applied once on the desktop,
- pitch clamp and inversion,
- joystick gestures never interacting,
- play-surface tap and interaction button each sending exactly one action,
- ordinary rotation not triggering a knock,
- one valid impact triggering one interaction with cooldown,
- stale and disconnected input returning zero deltas,
- flashlight object groups toggling together and configured light values remaining finite.

Browser and physical-device verification covers:

- horizontal and vertical response in the supplied phone posture,
- Figure 1 to Figure 4 grip changes producing little or no camera movement,
- Figure 1 to Figures 2/3 and Figure 4 to Figures 5/6 producing equivalent horizontal response,
- no drift while the phone is still,
- no snap-back when the phone returns to neutral,
- repeated joystick use without accidental interaction,
- knock tuning on the target iPhone and common false-positive movements,
- corridor readability and flashlight coverage on desktop and mobile-sized controller views.

## Acceptance Criteria

- Deliberately rotating the phone approximately 20 degrees rotates the desktop camera approximately 60 to 90 degrees.
- Rolling the phone between the supplied face-on and edge-on grips produces no intended camera rotation and only a small bounded response to imperfect hand movement.
- Horizontal and vertical turns retain the same meaning and sensitivity in both supplied grips.
- A still phone does not cause visible camera drift.
- The camera retains its new direction after the phone stops or returns toward neutral.
- Joystick movement cannot trigger interaction.
- A screen tap outside controls triggers exactly one interaction.
- A deliberate physical knock normally triggers one interaction on the target iPhone, with the on-screen interaction path retained if impact detection is unreliable.
- No wrist-twist interaction remains.
- The phone controller no longer requests camera permission.
- The unlit corridor remains dim but navigable, and the flashlight visibly illuminates nearby floor and side geometry even when its core is not pointed directly at a wall.
