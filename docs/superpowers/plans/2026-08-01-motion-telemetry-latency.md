# Motion Telemetry and Low-Latency Control Plan

**Goal:** Correct phone orientation mapping, expose the complete sensor-to-camera chain, and remove avoidable input batching delay.

- [x] Add failing tests comparing device-orientation quaternions with Three.js.
- [x] Add realistic flat, edge-on, intermediate-roll, return-to-neutral, and jitter gesture traces.
- [x] Correct the physical device-frame conversion and expose physical-angle diagnostic fields.
- [x] Add failing socket tests for immediate flush, server RTT, and desktop-applied RTT.
- [x] Implement immediate change flushes with a heartbeat fallback and sequence timing.
- [x] Return applied sequence and camera angles from desktop to controller.
- [x] Add the compact phone diagnostic plot and numeric telemetry.
- [x] Verify controller layouts, page errors, full tests, build, and fresh QR connection.
