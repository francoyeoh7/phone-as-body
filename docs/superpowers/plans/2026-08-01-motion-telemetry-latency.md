# Motion Telemetry and Low-Latency Control Plan

**Goal:** Correct phone orientation mapping, expose the complete sensor-to-camera chain, and remove avoidable input batching delay.

- [ ] Add failing tests comparing device-orientation quaternions with Three.js.
- [ ] Add realistic flat, edge-on, intermediate-roll, return-to-neutral, and jitter gesture traces.
- [ ] Correct the `YXZ` conversion and expose physical-angle diagnostic fields.
- [ ] Add failing socket tests for immediate flush, server RTT, and desktop-applied RTT.
- [ ] Implement immediate change flushes with a heartbeat fallback and sequence timing.
- [ ] Return applied sequence and camera angles from desktop to controller.
- [ ] Add the compact phone diagnostic plot and numeric telemetry.
- [ ] Verify controller layouts, page errors, full tests, build, and fresh QR connection.
