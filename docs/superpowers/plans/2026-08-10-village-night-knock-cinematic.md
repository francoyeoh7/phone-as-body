# Village Night and Knock Cinematic Implementation Plan

1. Add failing regression tests for synchronous mobile speech activation, transcript feedback, and raw phone-audio fallback.
2. Fix the controller voice lifecycle so iOS recognition starts inside pointer-down activation and remains distinct from desktop playback/transcription.
3. Audit local NPC candidates and current runtime framing; replace incoherent assets or enforce a full-body visual fallback, then add rendered quality checks.
4. Add failing night-lighting tests, tune manifest atmosphere/ambient/moon/practicals, and preserve existing ground materials and flashlight controls.
5. Add pure knock detector tests and implement the two-impulse closed-hand state machine.
6. Add director tests and implement door, reaching arm, captured hand pose, deterministic drag/struggle/release, blood wrist mark, abort, and exact restoration.
7. Add hand-response tests and expand open/fist extremes through the authored rest/grab animation endpoints.
8. Integrate ownership and lifecycle into `DesktopApp`, then run focused tests, full tests, build, runtime screenshots/pixel checks, mobile voice event checks, and public deployment verification without changing the tunnel URL.
