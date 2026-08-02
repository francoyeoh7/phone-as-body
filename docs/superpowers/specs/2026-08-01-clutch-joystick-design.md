# Clutch Joystick Motion Design

## Goal

Keep continuous free locomotion while making phone aiming predictable, drift-free at rest, and capable of unlimited accumulated turning without forcing an uncomfortable wrist pose.

## Interaction Model

The movement joystick is also the motion clutch. Touching the joystick captures a temporary neutral phone pose and enables view output. Thumb displacement controls locomotion while wrist motion controls yaw and pitch at the same time. Holding the thumb at the joystick origin permits turning in place.

Releasing the joystick immediately stops locomotion and freezes the camera. Phone motion while released never changes the game view, so the player can return the wrist to a comfortable pose. The next touch captures a new neutral pose. Several short engage, sweep, release, recenter gestures can therefore accumulate an unrestricted 360-degree turn.

## Mapping

The phone aim vector, rather than raw Euler axes, determines yaw and pitch so face-on, edge-on, and intermediate grip rolls remain equivalent. While engaged, camera motion is reversible and directly follows the change in calibrated aim. A 20-degree wrist sweep maps to about 60 degrees of camera motion at default sensitivity. Sub-degree tremor remains inside a dead zone.

## Movement And Actions

The existing floating joystick remains the movement control and sends changes immediately over the current WebRTC path. Touching its center engages view control without moving the character. The separate flashlight and interaction buttons remain unchanged. Taps outside the joystick continue to be interaction taps, preventing movement touches from firing interactions.

## Feedback

The diagnostic panel shows whether the clutch is `ON` or `OFF`. The joystick gains a clear active visual state while contact is held. Releasing, pausing, backgrounding, changing screen orientation, or losing the pointer always clears the clutch.

## Difference From Netflix Unhinged

Unhinged uses the phone as an in-world handset, pointer, and flashlight in a directed point-and-click horror experience. This prototype instead supports continuous physics locomotion, simultaneous walking and looking, and unlimited accumulated relative rotation. The control distinction is meaningful, but the phone will need additional game-specific meaning beyond joystick plus gyroscope if a later production concept is intended to feel fundamentally different rather than merely more freely navigable.

## Verification

- Orientation tests prove outward and return motion are reversible while engaged.
- Motion-controller tests prove released motion emits no view changes and every engagement recalibrates.
- Joystick tests prove pointer contact opens and closes the clutch while preserving movement output.
- The full test suite and production build pass.
- Phone and desktop browser checks confirm the active state fits without overlap and control packets continue over WebRTC.
