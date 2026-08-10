# NPC, Voice, Gesture, and Ground Regression Implementation Plan

**Goal:** Fix the four reported regressions without changing the complete village gameplay surface.

## Task 1: NPC normalization

- Add failing actor/asset tests for upright source transforms, root-local grounding, and bounded normalized dimensions.
- Remove the incorrect outer rotations and implement local-coordinate grounding plus a model quality gate.
- Run the focused NPC tests.

## Task 2: Phone transcription and subtitles

- Add failing server tests for MIME-derived upload filenames and runtime tests for player subtitles/status forwarding.
- Preserve supported recording MIME types through multipart upload, add WAV diagnostics, publish player transcripts, and implement the missing voice status UI.
- Run focused server/runtime/UI tests and a real same-origin transcription request without exposing the API key.

## Task 3: Upper-right stand arc

- Replace the vertical-flick expectation with failing tests for a quick upper-right path that reaches the right edge, plus negative tests for forward walking, short movement, slow movement, and edge misses.
- Implement sampled path qualification while leaving crouched locomotion and view control active.
- Run the joystick/controller tests.

## Task 4: Village ground detail

- Add a failing environment-loader test proving only `LAndscapepaint` receives a detailed repeating texture.
- Add a deterministic canvas ground texture and dispose it with the environment.
- Run environment and village scene tests.

## Task 5: End-to-end verification

- Run all tests and the production build.
- Launch the production server, check API configuration and transcription, inspect desktop/mobile rendering, then publish the refreshed HTTPS demo URL.
