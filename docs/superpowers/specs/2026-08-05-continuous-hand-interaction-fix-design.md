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

## Architecture

`ControllerApp` owns the persistent tracker lifecycle. `MediaPipeHandTracker` emits pose/status frames continuously after permission, and task messages no longer restart the model. `HandTrackingDirector` always consumes those frames and always drives `FirstPersonHand`; its task state machine remains optional and is only enabled while a semantic task owns the hand.

A small hysteresis gate converts a stable grab pose into a one-shot ordinary interaction. `DesktopApp` applies that pulse only when `currentTargetId` is non-null and no cinematic task owns input. Door and found-phone directors continue to interpret poses through `HandTaskStateMachine`. They never receive pixel-presence success events when MediaPipe is available, and pixel motion is not used as a fallback completion source.

## Failure Handling

Tracker startup and temporary frame loss are treated as recoverable states. A later valid frame restores visual tracking and task evaluation. Only an explicit `unavailable` status enables touch fallback. Status frames keep the task paused and the hand faded; they cannot trigger a scene action.

## Verification

Automated tests cover persistent startup, exploration visibility, delayed-frame recovery, stable grab pulses, absence of pixel-triggered interaction, and door progress with loss grace. A production build and an HTTPS two-client smoke test verify controller assets, hand models, Socket.IO, and the deployed scene.
