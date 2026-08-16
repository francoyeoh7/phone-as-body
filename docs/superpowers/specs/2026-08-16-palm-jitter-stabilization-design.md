# Palm Jitter Stabilization Design

## Goal

Stop visible left-palm position and orientation tremor while preserving prompt deliberate movement, raw gesture sensitivity, immediate tracked/lost visibility, the rear-camera dorsum contract, finger animation, arm entry, arm length, and all right-hand behavior.

## Root Cause

`HandPoseStream` currently stabilizes `center`, scale, and wrist quaternion, but `FirstPersonHand` positions the rendered wrist from `landmarks[0]`. That landmark remains in the short 28 ms finger smoothing path and has no stationary dead zone. Wrist orientation also uses a 0.02 rad hard dead zone; samples just outside it can repeatedly move the visible palm even when the physical hand is still.

## Design

Maintain separate semantic and visual paths inside `HandPoseStream`:

- `gesturePose` remains an unfiltered clone of every accepted tracked frame. Gesture gates therefore retain the current sensitivity and latency.
- `pose.visualWrist` is a visual-only, normalized camera-space wrist point sourced from `landmarks[0]`, with a continuous 0.008 soft dead zone and the existing adaptive wrist smoothing.
- `pose.wristQuaternion` uses a continuous 0.035 rad soft angular dead zone before the existing adaptive slerp. Movement beyond the radius is not discarded; the dead-zone radius is subtracted so output changes continuously without a boundary jump.
- `FirstPersonHand` uses `pose.visualWrist` when present and falls back to `landmarks[0]` for compatibility.
- Finger landmarks, curls, gesture strengths, confidence, loss handling, and protocol data remain unchanged.

## Responsiveness Contract

- Alternating stationary wrist noise within 0.008 normalized position and 0.035 rad orientation must not move the visual palm.
- A deliberate 0.10 normalized wrist movement and 15 degree turn must complete most of its visible response within two 15 Hz frames, about 132 ms.
- The latest raw gesture pose must still expose the complete unfiltered movement immediately.
- Explicit `lost` frames must continue hiding the hand immediately.

## Scope

Modify only:

- `src/desktop/HandPoseStream.js`
- `src/desktop/FirstPersonHand.js`
- `tests/hand-pose-stream.test.js`
- `tests/first-person-hand.test.js`
- the design and implementation plan documents for this change

Do not modify tracker thresholds, MediaPipe options, hand recognition state, palm/dorsum calibration, finger authored poses, arm geometry, right-hand flashlight behavior, controller transport, or the public tunnel.

## Backup And Verification

Use one pre-change tag and one post-change commit/tag. Run focused stream/hand tests, the broader hand chain, production build, and a browser visual check before pushing the final checkpoint to GitHub.
