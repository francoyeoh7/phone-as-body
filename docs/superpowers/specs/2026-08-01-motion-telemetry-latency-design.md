# Motion Telemetry and Low-Latency Control Design

## Goal

Make phone aiming observable and testable from sensor input through desktop camera application, correct the device-orientation conversion, and reduce avoidable joystick and motion latency.

## Human Motion Model

The neutral pose is whatever pose the player holds during calibration. The phone's lower end is treated as the wrist pivot and its long axis points toward the intended aim direction. Sweeping the phone's top left or right changes yaw; lifting or lowering it changes pitch. Rotating around the phone's long axis is a grip change and should produce little or no camera movement. The same sweep must behave consistently from face-on, edge-on, and intermediate grip rolls.

Automated gesture traces will sample realistic paths from neutral to 20 degrees, back to neutral, and outward again. A 20-degree outward sweep should produce about 80 degrees of view movement at the default gain, the return path must not reverse the camera, sub-degree jitter must remain still, and a pure 90-degree grip roll must remain still.

## Sensor And Mapping Diagnostics

After motion permission is granted, the controller shows a compact diagnostic instrument that does not overlap the joystick or action controls. It displays:

- raw `alpha`, `beta`, and `gamma` values;
- calibrated physical yaw and pitch;
- filtered yaw and pitch sent to the game;
- grip-roll estimate and sensor sample rate;
- joystick X/Y, packet rate, Socket.IO transport, server RTT, and desktop-applied RTT;
- the desktop camera yaw and pitch reported after an input sequence is applied.

A two-axis plot shows the calibrated physical aim and filtered output together. Values update through `requestAnimationFrame` so sensor events do not cause excessive DOM work.

## Correct Orientation Conversion

`deviceOrientationToQuaternion` will implement the W3C Device Orientation physical frame directly: intrinsic `Z-X'-Y''` rotations, with device `x` pointing right, `y` pointing toward the screen top, and `z` pointing out of the screen. This avoids the camera-coordinate correction that previously pushed the phone long axis toward a singularity while the phone was flat. Tests compare several real `alpha/beta/gamma` combinations against equivalent Three.js axis-quaternion composition and then run posture-independent gesture traces through the tracker.

The tracker will expose diagnostic fields alongside its existing yaw and pitch output. Protocol payloads continue to send only bounded yaw and pitch values.

## End-To-End Telemetry

Each controller input has a sequence number and local send timestamp. The server acknowledgement produces server RTT. After the desktop applies a new sequence, it sends a `control-feedback` desktop event containing the sequence and resulting camera yaw/pitch. The controller matches that sequence to its local send time to calculate end-to-end applied RTT without comparing clocks across devices.

## Latency Reduction

Joystick and orientation changes flush immediately instead of waiting for the 30 Hz interval. The interval remains as a heartbeat so sustained movement survives dropped pointer events. Immediate sends are naturally limited by browser pointer and orientation event rates. Joystick release sends zero immediately.

Runtime measurement showed the public tunnel adding roughly 440-510 ms of RTT, so controller snapshots and desktop feedback use an unordered, zero-retransmit WebRTC data channel after Socket.IO performs signaling. This keeps movement and view updates on the local peer-to-peer path while preserving Socket.IO as an automatic fallback. Controller actions remain on the reliable Socket.IO path.

## Verification

- Unit tests validate the Three.js-equivalent orientation formula and realistic hand-motion traces.
- Socket tests validate immediate flush, acknowledgement RTT, and desktop-applied RTT matching.
- Controller tests validate telemetry rendering and joystick separation.
- The full test suite and production build must pass.
- Browser smoke tests verify the diagnostic panel fits phone portrait and landscape layouts and produces no page errors.
