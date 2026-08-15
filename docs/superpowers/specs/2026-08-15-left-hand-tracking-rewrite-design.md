# Left-Hand Tracking Rewrite Design

Date: 2026-08-15
Status: Approved direction, pending document review

## Purpose

Replace the current left-hand tracking path with one coherent implementation.
The rewrite must make a physical left hand appear on the first valid camera
result, remain visible for every valid result, and disappear on the first
result with no hand. It must also preserve palm-versus-dorsum orientation and
derive visible arm length from the tracked wrist instead of using a fixed arm
length.

The public controller origin, village systems, NPC systems, voice systems,
right-hand flashlight, and network protocol names are outside this rewrite.

## Observed Failure

The current code combines incompatible recovery attempts:

- The real phone path previously used the MediaPipe mirrored handedness
  convention, while the current controller explicitly selects the opposite
  convention.
- Candidate selection discards every result whose handedness label does not
  match exactly, even after a physical left hand is already being tracked.
- The tracker, pose stream, director, and hand renderer each have separate
  confidence or loss rules. A valid result can therefore be visible in one
  layer and rejected by another.
- The forearm root direction is dynamic, but the virtual shoulder-to-wrist
  magnitude is discarded. Arm length is still effectively fixed apart from
  uniform model scaling.
- Historical rollback attempts alternated between a fixed 42-degree root and
  a dynamic root. Neither is a reliable base for another partial restore.

## Behavioral Contract

### Acquisition

- The controller samples the existing rear-camera video at up to 15 Hz.
- In the idle state, a valid MediaPipe candidate that matches the established
  physical-left camera convention starts tracking immediately.
- The first valid result emits a `tracked` frame. No multi-frame dwell or
  reach calibration is required for visual presentation.
- Reach calibration may still gate interaction semantics, but never hand
  visibility.

### Retention

- Once a left hand is acquired, the tracker follows the spatially continuous
  candidate in each result.
- A temporary MediaPipe handedness-label flip does not interrupt an otherwise
  continuous visible hand.
- A structurally valid tracked frame always updates the visible hand. Numeric
  confidence remains available to gesture gates but does not control visual
  existence.
- No prior pose is rendered in place of an available current pose.

### Loss

- A result containing no hand landmarks emits `lost` immediately and returns
  the tracker to idle.
- An explicit `lost` frame sets renderer opacity to zero in the same desktop
  update. There is no freeze interval or fade-out.
- A network-silence watchdog exists only for a missing transport connection.
  It is not part of normal camera loss and must be no longer than two sample
  intervals.
- A new physical hand after loss must pass acquisition again, preventing a
  right hand from inheriting the previous left-hand lock.

## Controller Tracker

`MediaPipeHandTracker` remains the public controller adapter so other controller
code does not need a second tracking API. Its internal candidate and lifecycle
logic will be replaced with a small state machine:

1. `idle`: select an acquisition candidate using the verified rear-camera
   handedness convention.
2. `tracking`: select the candidate nearest the prior wrist, with a bounded
   continuity distance. Label disagreement is tolerated only in this state.
3. `lost`: emitted immediately when a result has no usable candidates, then
   transition to `idle` and clear calibration and continuity state.

MediaPipe task creation continues to use one hand and the worker-first path.
The rewrite will not add a second camera request or a second inference engine.

## Palm And Dorsum Orientation

The pose basis is derived directly from metric world landmarks:

- longitudinal axis: wrist to middle-finger MCP;
- transverse axis: index MCP to pinky MCP;
- palm normal: the handed cross product of the two axes;
- corrected longitudinal axis: recomputed from the normal and transverse axis
  to keep an orthonormal basis.

The verified camera handedness convention is applied once at controller input.
The adapter then performs one camera-to-Three conversion `(x, -y, -z)`. No
later layer may swap handedness or negate the normal again.

The arm rig test will compare the achieved authored palm normal with the target
Three.js normal. Separate synthetic palm-facing and dorsum-facing poses must
produce opposing normals and opposing rendered sides.

## Wrist Placement And Arm Length

The presentation model remains wrist-centered because this matches the current
asset and avoids moving the whole camera rig.

For every tracked frame:

1. Map normalized wrist center and apparent palm scale into a camera-local
   wrist target.
2. Use a fixed lower-left camera-local shoulder entry as the other endpoint.
3. Compute the shoulder-to-wrist vector. Its direction drives the arm root
   quaternion; its magnitude drives arm extension.
4. Stretch only the authored arm-chain translations between shoulder,
   upper-arm, forearm, and hand. Palm and finger scale stay controlled by palm
   scale and are not elongated with the arm.
5. Recenter the presentation model with the extended hand offset so the wrist
   remains exactly on the tracked target.

The neutral mapping is tuned to the supplied reference image: the sleeve enters
from the lower-left, the wrist reaches toward the center, and a substantial
forearm remains visible. Extension is clamped to the useful range of the rig to
avoid mesh inversion when a hand touches a camera boundary.

The phone camera has no elbow landmark, so this is a camera-space visual arm
length, not a measurement of anatomical length in centimeters. Wrist position
and apparent depth must nevertheless change it continuously and monotonically.

## Desktop Pose Stream

`HandPoseStream` becomes a low-latency pose interpolator, not a second detector.

- It validates ordering, epoch, left-hand ownership, and finite pose data.
- Every valid `tracked` frame updates wrist, landmarks, curls, and target
  orientation.
- Short exponential smoothing is allowed for movement and rotation only.
- Confidence is reported without freezing or hiding the render pose.
- `lost` clears presentation immediately.
- Gesture consumers continue to receive raw confidence and can retain their
  existing safety thresholds.

## Transport

Hand frames continue over reliable Socket.IO using the existing
`controller:hand` event. The rewrite does not restore the lossy WebRTC hand
channel and does not change QR or public-origin configuration.

## Tests

Tests are written before implementation and cover:

1. First valid physical-left result emits a visible tracked frame immediately.
2. A continuous left hand survives a temporary handedness-label flip.
3. A result with no landmarks emits lost immediately and clears the lock.
4. A right hand cannot acquire from idle.
5. Low-confidence but structurally valid tracked frames remain visible and
   update pose.
6. Explicit lost produces zero opacity in the same update.
7. Palm-facing and dorsum-facing normals remain opposite after rig mapping.
8. Moving the wrist away from the lower-left entry increases arm length;
   moving it toward the entry decreases arm length.
9. Arm extension changes arm-chain length without changing hand dimensions.
10. The extended rig remains wrist-centered and all transforms stay finite.
11. Hand frames still use reliable Socket.IO and the public configuration is
    unchanged.

Browser verification will inject a sequence rather than one isolated frame:

- acquire, continuous motion, temporary label flip, loss;
- palm view and dorsum view;
- near-entry short arm and center-screen long arm;
- desktop and mobile-landscape screenshots;
- nonblank canvas, no page errors, and expected bone/world transforms.

Real-phone verification remains required because synthetic fixtures cannot
prove a device-specific MediaPipe handedness convention.

## Git And Recovery Checkpoints

Only files in the left-hand rewrite are staged at each checkpoint. Unrelated
dirty village, NPC, asset, and voice files remain untouched.

Create named commits or tags at these points:

1. approved design and current hand baseline;
2. failing rewrite regression tests;
3. passing controller/stream/arm implementation;
4. verified production build and deployment record.

Before implementation, also create a timestamped filesystem backup outside the
repository. Maintain a small recovery handoff recording the current checkpoint,
test commands, public URL, running process IDs, and the next action. A new Codex
conversation can resume from that file without replaying a corrupted compacted
conversation.

## Completion Criteria

The rewrite is complete only when:

- focused controller, pose, stream, adapter, renderer, protocol, and recovery
  tests pass;
- the production build succeeds;
- desktop and mobile visual checks pass with no browser errors;
- the current public controller URL still returns HTTP 200 and its QR target is
  unchanged;
- a real phone confirms immediate appearance, continuous presence while the
  left hand is visible, immediate disappearance after it leaves, correct
  palm/dorsum orientation, and responsive arm length.

