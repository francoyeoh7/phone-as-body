# Continuous Hand Interaction Fix Design

## Problem

The current build has two competing camera input sources. Pixel-difference motion can directly trigger ordinary interactions, while MediaPipe tracking only starts inside the found-phone and door tasks. A 1.5 second startup timeout can permanently route a task back to pixel motion before the MediaPipe model is ready. This explains all three reported symptoms: the game hand is absent during exploration, small camera changes trigger the faucet, and a real hand may not advance the door progress.

## Approved Behavior

- Rear-camera MediaPipe tracking starts after camera permission and remains active while the controller session is playable.
- A successfully tracked hand drives the first-person hand during normal exploration and during tasks. Losing tracking fades the hand instead of snapping it.
- Crosshair focus selects the interaction target; it does not itself trigger an action.
- Ordinary targets react only to a stable grab transition with hysteresis and a 500 ms action cooldown.
- Door defense continues to require a stable open-palm brace for four seconds. Low confidence pauses or reduces progress; a single bad frame never completes or immediately fails the task.
- Pixel-difference motion has no authority to trigger an interaction or advance a task. It may remain as local diagnostics only.
- If tracking is unavailable, existing screen tap interaction remains available. Gyroscope, joystick, flashlight, and full-screen touch behavior are unchanged.
- Motion/orientation permission remains mandatory for starting gameplay; there is no gyroscope-denied play mode.

## Found Phone Hold

The floor phone can only be acquired by a confirmed hand-grab while the reticle is focused on it. The phone is readable only while the grab remains held. A confirmed release or sustained tracking loss closes the phone UI, ends the cinematic, and animates the prop back to the floor. The prop is disabled for three seconds after release before it can be grabbed again. Touch tap and pixel motion cannot pick it up.

## Flashlight Presentation

The established gyroscope input and camera-target math remain unchanged. The rendered flashlight beam follows the final camera pose with a short frame-rate-independent inertial lag, creating weight without adding controller latency. The core and spill lights use a brighter, longer profile so corridor targets remain readable at greater distance.

## Architecture

`ControllerApp` owns the persistent tracker lifecycle. `MediaPipeHandTracker` emits pose/status frames continuously after permission, and task messages no longer restart the model. `HandTrackingDirector` always consumes those frames and always drives `FirstPersonHand`; its task state machine remains optional and is only enabled while a semantic task owns the hand.

A small hysteresis gate converts a stable grab pose into a one-shot ordinary interaction. `DesktopApp` applies that pulse only when `currentTargetId` is non-null and no cinematic task owns input. Door and found-phone directors continue to interpret poses through `HandTaskStateMachine`; found-phone starts pre-calibrated because the same confirmed grab acquired it, then requires the held pose continuously. They never receive pixel-presence success events, and pixel motion is not used as a fallback completion source.

## Failure Handling

Tracker startup and temporary frame loss are treated as recoverable states. A later valid frame restores visual tracking and task evaluation. Only an explicit `unavailable` status enables touch fallback. Status frames keep the task paused and the hand faded; they cannot trigger a scene action.

## Verification

Automated tests cover persistent startup, exploration visibility, delayed-frame recovery, stable grab pulses, absence of pixel-triggered interaction, and door progress with loss grace. A production build and an HTTPS two-client smoke test verify controller assets, hand models, Socket.IO, and the deployed scene.
