# Camera Motion Interaction Design

## Goal

When the player's reticle is close to an enabled interactable, gently attract the camera to that target and arm a phone-camera motion detector. A localized or sudden frame change in the phone's front-camera stream triggers the existing `interact` action once. The camera stream is authorized during the first explicit sensor-enable action, processed locally, and never uploaded.

## User Flow

1. The player joins a room and taps the existing sensor-enable control.
2. The controller requests motion, orientation, and front-camera permission together.
3. The phone keeps a low-resolution camera stream warm, but frame analysis is inactive until the desktop reports a selected target.
4. The desktop selects a target using the existing center ray plus assisted targeting and applies bounded camera aim assist.
5. The desktop sends `{ type: "target-focus", id }` to the phone. The phone arms frame-difference detection.
6. A localized/sudden visual change above the detector threshold emits one existing `interact` action. The phone vibrates and enters a short cooldown.
7. Losing the target disarms detection. Denied camera permission or detector failure leaves the existing short-tap interaction usable.

## Detection Contract

- Input frames are downsampled to a small grayscale buffer for low CPU and network-free processing.
- `measureFrameMotion(previous, current, width, height)` returns normalized mean difference and active-pixel ratio.
- A motion event requires a meaningful mean difference, a non-empty but non-global active region, and a fresh cooldown window.
- Global high-area changes are rejected as likely phone/camera movement; local changes are accepted as a hand/object passing in front of the camera.
- The detector triggers once per target focus and must be re-armed by a new focus event.

## Boundaries

- `src/controller/CameraMotionDetector.js` owns camera permission, hidden video/canvas lifecycle, frame sampling, motion scoring, cooldown, and suspend/resume.
- `src/controller/ControllerApp.js` owns permission-flow messaging, target-focus events, action dispatch, and lifecycle coordination.
- `src/desktop/PlayerController.js` owns assisted target selection and bounded camera attraction.
- `src/desktop/DesktopApp.js` forwards target-focus events through the existing `PhoneSession` channel.
- `tests/camera-motion-detector.test.js` covers pure frame scoring and detector state transitions.

## Failure Handling

- A missing `navigator.mediaDevices`, denied permission, camera startup error, or unavailable canvas reports a recoverable state and does not disable tap interaction.
- Page hide pauses frame analysis and zeros controller input through the existing lifecycle path.
- Destroy stops all camera tracks, cancels animation callbacks, and releases the hidden video element.
- The desktop remains authoritative: an `interact` action only affects the currently selected enabled target.

## Privacy and Performance

- Request `video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } }` and `audio: false`.
- Only derived scalar motion metrics leave the phone; raw frames never leave the browser.
- The implementation uses a lightweight canvas differ rather than a hand-pose model. This matches the requested sudden-appearance/motion signal and avoids a large model download.

## Acceptance Criteria

- Camera permission is requested in the first explicit sensor-enable flow.
- A selected target applies bounded visual aim assist and sends target-focus to the phone.
- A qualifying local frame change triggers exactly one interaction during a focus window.
- Large global camera movement does not trigger the detector.
- Camera denial, target loss, cooldown, page hide, and destroy are safe.
- Existing short-tap, joystick, orientation, pairing, tests, and production build remain passing.
