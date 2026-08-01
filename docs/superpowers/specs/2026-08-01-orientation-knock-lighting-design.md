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
- Subsequent orientation events are converted to normalized quaternions and compared with the previous valid sample.
- Relative horizontal and vertical angular deltas are accumulated, not mapped to an absolute screen angle. Returning the phone to its original pose therefore does not snap the game camera back.
- Default gain is 4:1: approximately 20 degrees of deliberate phone rotation produces approximately 80 degrees of game-camera rotation.
- The existing sensitivity setting scales that gain while preserving a useful minimum and maximum.
- Per-sample tremor below 0.8 degrees is discarded. Each valid physical delta is clamped to 25 degrees before gain is applied so a dropped or corrupt sensor sample cannot jump the view.
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

The existing quaternion helpers remain the mathematical base. A new device-orientation conversion helper handles alpha, beta, gamma, and current screen orientation without relying on compass headings. Relative quaternion changes are projected into camera yaw and pitch in the calibrated phone frame.

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
- 20 degrees of phone motion producing approximately 80 degrees of camera motion at default sensitivity,
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
- no drift while the phone is still,
- no snap-back when the phone returns to neutral,
- repeated joystick use without accidental interaction,
- knock tuning on the target iPhone and common false-positive movements,
- corridor readability and flashlight coverage on desktop and mobile-sized controller views.

## Acceptance Criteria

- Deliberately rotating the phone approximately 20 degrees rotates the desktop camera approximately 60 to 90 degrees.
- A still phone does not cause visible camera drift.
- The camera retains its new direction after the phone stops or returns toward neutral.
- Joystick movement cannot trigger interaction.
- A screen tap outside controls triggers exactly one interaction.
- A deliberate physical knock normally triggers one interaction on the target iPhone, with the on-screen interaction path retained if impact detection is unreliable.
- No wrist-twist interaction remains.
- The phone controller no longer requests camera permission.
- The unlit corridor remains dim but navigable, and the flashlight visibly illuminates nearby floor and side geometry even when its core is not pointed directly at a wall.
