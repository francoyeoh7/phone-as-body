# Rear-Camera Hand Tracking and L-Corridor Design

**Date:** 2026-08-04

## Objective

Add an optional rear-camera hand-tracking mode that continuously drives a first-person rigged hand and supplies stable task actions, while preserving every existing phone input path. Expand the playable environment into a wider L-shaped corridor and move the door-defense climax to the new wing.

## Non-Negotiable Compatibility

- Do not change `MotionController`, orientation math, joystick semantics, flashlight control, fullscreen touch interactions, or click/drag behavior.
- Keep one rear-camera stream. The existing `CameraMotionDetector` remains the owner of `getUserMedia()` and continues to enforce `facingMode: { exact: "environment" }`.
- Hand tracking is task-scoped and optional. Permission denial, unsupported WebAssembly, model load failure, camera loss, or tracking loss must leave the old camera-motion/touch interaction paths usable.
- Never send camera pixels or video to the desktop. Send derived landmarks and state only.
- Do not treat a single frame as an action success or failure.

## Selected Technology and Assets

- MediaPipe `@mediapipe/tasks-vision@1.0.1` Hand Landmarker in `VIDEO` mode, using a locally served model and WASM runtime. It may inspect two candidates to preserve identity when multiple hands enter, but selects, transmits, and drives exactly one sticky hand.
- The tracker consumes the hidden rear-camera `<video>` already created by `CameraMotionDetector` and runs only while a desktop hand task is active.
- WebXR Input Profiles `generic-hand` `left.glb` and `right.glb` models provide skinned, independently addressable finger joints. The assets package explicitly publishes its glTF/GLB files under the MIT License.
- Three.js `GLTFLoader` loads the local hand assets. No primitive-based replacement hand is generated.

Primary references:

- https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- https://github.com/immersive-web/webxr-input-profiles/tree/main/packages/assets/profiles/generic-hand
- https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/assets/LICENSE.md

## Architecture

### 1. Rear camera ownership

`CameraMotionDetector` remains the sole camera owner. It exposes a read-only `getVideoElement()` method after permission succeeds. `MediaPipeHandTracker` never calls `getUserMedia()` and cannot accidentally open the front camera or a second stream.

The existing motion detector continues in its current pulse/presence modes. During a hand task, MediaPipe is preferred; if MediaPipe reports unavailable, the task director continues to accept the existing `gesture-presence` fallback.

### 2. Phone hand tracker

`MediaPipeHandTracker` is lazy:

1. It receives a `hand-task` desktop event.
2. It verifies that the rear video is live.
3. It dynamically initializes Hand Landmarker with the local model and WASM files.
4. It transfers `ImageBitmap` frames to a dedicated Worker at a maximum of 15 Hz with a one-frame-in-flight guard so inference cannot block gyro/touch handlers or queue stale frames.
5. It marks the rear-camera input as explicitly unmirrored, swaps MediaPipe's raw handedness label into physical left/right semantics, then selects one hand deterministically: retain the previously tracked handedness/center when possible, otherwise choose the highest handedness score.
6. It emits a compact derived frame or a rate-limited lost frame.
7. It stops inference immediately when the task ends, the page backgrounds, the camera ends, the controller disconnects, or the app is destroyed.

The initial one-second calibration accepts a naturally open hand with stable scale and center. It records handedness, median palm span, and neutral center. Calibration is per task, short, and has no settings screen.

### 3. Hand frame protocol

High-frequency hand data uses a dedicated `controller:hand` event rather than expanding the stable controller-input packet.

```js
{
  version: 1,
  seq: 17,
  capturedAt: 4102.3,
  modeEpoch: 4,
  state: "tracked", // or "lost"
  handedness: "left",
  handConfidence: 0.94,
  trackingConfidence: 0.87,
  landmarks: [[x, y, z], /* exactly 21 */],
  worldLandmarks: [[x, y, z], /* exactly 21 */],
  center: [x, y, z],
  wrist: { right: [x, y, z], up: [x, y, z], forward: [x, y, z] },
  curls: [thumb, index, middle, ring, pinky],
  openness: 0.82,
  grabStrength: 0.18,
  palmFacing: 0.76,
  relativeScale: 1.04,
  velocity: 0.03
}
```

The server validates the complete envelope, caps its serialized size at 12 KiB, accepts only the attached controller, and relays it to that room's desktop. A separate unreliable/unordered WebRTC hand channel is preferred; Socket.IO is the reliable fallback. Sequence numbers and `modeEpoch` reject stale frames and results from a prior task. Desktop freshness uses local receive time, not subtraction between unrelated phone and desktop `performance.now()` clocks.

### 4. Pose extraction

Pure shared math derives:

- center from wrist plus the four finger MCP landmarks;
- palm scale from wrist-to-middle-MCP and index-MCP-to-pinky-MCP spans;
- a handedness-corrected palm basis from wrist, index MCP, middle MCP, and pinky MCP;
- per-finger curl from the joint angles across each digit;
- openness from the inverse non-thumb curl mean plus thumb extension;
- grab strength from finger curls and thumb opposition;
- palm-facing score from the palm normal;
- temporal continuity confidence from in-frame coverage, scale continuity, center velocity, and handedness continuity.

Every MediaPipe sample carries an explicit `inputMirrored` boolean. The rear-camera paths always pass `false`; a dedicated MediaPipe-label adapter swaps the raw left/right label for unmirrored input before constructing the handedness-corrected palm basis. The existing one-argument `normalizeHandedness(value)` helper keeps its public semantics; only the adapter requires the mirror flag. Missing or non-boolean mirror metadata is rejected so worker and main-thread fallback cannot silently disagree about physical handedness.

MediaPipe directly supplies the handedness category score, landmarks, and world landmarks. `handConfidence` and `trackingConfidence` are explicitly derived quality scores; they are never represented as raw model confidence outputs.

The feature extractor rejects malformed coordinates and degenerate palm bases. Non-hand camera changes cannot create a hand frame because only a valid Hand Landmarker result reaches this layer.

### 5. Desktop filtering and action state

`HandPoseStream` receives valid frames and provides a smoothed render pose:

- center and joint positions use time-based exponential smoothing;
- wrist orientation uses quaternion slerp;
- curls and task metrics use scalar damping;
- low confidence freezes the last stable pose for 250 ms, then fades it over 350 ms;
- reacquisition blends from the frozen pose rather than snapping;
- handedness can change only after 500 ms of continuous higher-confidence evidence.

`HandTaskStateMachine` is independent of rendering. Its states are:

```text
untracked -> tracking -> candidate -> confirmed -> held -> success
                                  \-> failed
held -> unstable -> held
held -> unstable -> failed
```

Default thresholds:

- enter tracking: confidence >= 0.62 for 120 ms;
- enter action candidate: action score >= 0.72;
- confirm action: candidate continuously valid for 220 ms;
- remain held: action score >= 0.55;
- transient loss grace: 250 ms;
- sustained loss/invalid pose: unstable, then task-specific pause/decay;
- release confirmation: release score valid for 180 ms;
- open-palm calibration: openness >= 0.72, palmFacing >= 0.45, confidence >= 0.65 for 900 ms.

Enter and exit thresholds differ to provide hysteresis.

### 6. First-person hand

`FirstPersonHand` preloads the two local generic-hand assets, maps their named WebXR joints, and attaches its render root to the camera. MediaPipe's 21 joints are expanded to the model's 25 joints by interpolating the four non-thumb metacarpals between the wrist and MCP landmarks.

The renderer drives:

- root screen-relative position from calibrated hand center;
- near/far movement from calibrated relative palm scale and landmark depth;
- wrist rotation from the palm basis;
- each finger bone position and orientation from the smoothed landmark chain;
- opacity from tracking confidence/loss state.

Only the hand matching stable handedness is visible. The hand is visible only during a hand task or while valid task-scoped tracking is active. Asset-load failure leaves it hidden and does not block the task fallback.

### 7. Task semantics

The pose layer emits continuous measurements. The task layer interprets them in context:

- `open`: open palm score with hysteresis;
- `fist`: high four-finger curl and thumb curl;
- `grab`: high grab strength with thumb opposition;
- `release`: low grab strength and open hand;
- `brace`: open, camera-facing palm with low short-term velocity;
- `hold`: the currently required action remains above its exit threshold.

For the found phone, the first confirmed grab enters inspection and a confirmed release returns to exploration. Existing presence fallback remains available if hand tracking is unavailable.

For the door, calibration precedes bracing. Only a continuously held brace advances the four-second defense bar. A transient confidence drop pauses progress. Sustained instability decays progress at 0.65 seconds per real second; reaching zero restarts the action attempt without freezing the cinematic. Haptics run only while a valid brace is held. Success ends the hand task, fades the hand, restores the saved camera/body pose, and returns exploration control.

### 8. L-shaped environment

The main corridor is widened to 6.4 m and lengthened to the turn. A second 6.4 m-wide wing extends 20 m to the right at 90 degrees. The junction overlaps both floor/ceiling volumes so there is no collision seam. Side-wall colliders stop at the opening, new outer-wall colliders close the L perimeter, and the exit door is transformed to the far end of the new wing.

`ExitDoor` accepts position and yaw rather than hard-coding the old endpoint. It exposes an inward normal and trigger position, allowing `DoorDefenseDirector` to place the cinematic camera correctly for any door orientation. Existing props remain in the first corridor leg. Lighting and fog are extended into the new wing without increasing shadow-casting light count beyond the existing budget.

## Failure Policy

- Permission denied: show the existing non-blocking fallback state and retain touch/camera-motion interaction.
- Hand model or WASM load fails: send one unavailable status, stop retry loops for that task, and use fallback.
- No hand/partial occlusion/low light: freeze then fade the hand; pause or decay task progress.
- Multiple hands: track exactly one using continuity and confidence.
- Handedness flips: retain the prior hand until the new label remains stronger for 500 ms.
- Camera orientation changes: clear calibration and require a fresh short calibration; do not feed rotated stale joints.
- Network reordering: reject non-increasing sequence numbers.
- Network silence: treat locally as lost after 350 ms, without inventing a pose.
- Lifecycle interruption: stop inference and sampling, emit/derive lost state, stop haptics, release task ownership, and preserve the existing explicit resume flow.

## Acceptance Evidence

- Pure tests cover feature extraction, invalid landmarks, calibration, hysteresis, loss grace, grab/release, brace hold, decay, stale frame rejection, and no false hand from non-landmark input.
- Protocol and registry tests prove strict relay validation and room ownership.
- Controller lifecycle tests prove a single rear camera and independent optional tracker cleanup.
- Desktop tests prove joint, wrist, center, fade, task, and fallback behavior.
- Scene layout tests prove a navigable 90-degree junction and correctly transformed endpoint door/colliders.
- Full Vitest suite and production build pass.
- Desktop and mobile Playwright screenshots plus canvas pixel checks prove a nonblank L corridor, visible tracked-hand test pose, correct framing, and no UI overlap.
- A phone-on-public-HTTPS smoke test verifies rear camera permission, one-hand tracking, hand loss, found-phone release, and sustained door progress.
