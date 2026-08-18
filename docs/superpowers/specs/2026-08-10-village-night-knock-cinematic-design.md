# Village Night, Voice, NPC, and Knock Cinematic Design

## Goal

Deliver a public mobile-playable village build where NPCs render as complete grounded characters, speech is captured from the phone and appears as player subtitles, the village is readable at night, hand poses reach convincing open/fist extremes, and a two-knock door gesture starts a reversible first-person drag-and-escape cinematic.

## Non-negotiable behavior

- The existing Cloudflare tunnel URL stays unchanged; only the build behind it may be refreshed.
- Phone speech begins from the original pointer-down user activation. Browser speech recognition is the free primary path; phone MediaRecorder audio remains the server-transcription fallback when a valid API key is configured.
- NPC acceptance uses a rendered-frame check, not only GLB load success or bounding boxes. A failed or visually implausible asset is hidden and replaced with a coherent full-body fallback.
- Night is blue-black rather than black: silhouettes, paths, doors, and nearby NPCs remain visible without the flashlight, while the flashlight produces a clear local contrast increase.
- The selected door only accepts two closed-hand forward knock impulses while the player is close and focused. Walking, ordinary grabs, and a single knock do not trigger it.
- The cutscene snapshots the player/camera and triggering hand pose, owns input for its duration, opens the door a crack, shows an arm grab, performs deterministic struggle motion, releases with a blood mark on the wrist, then restores the exact pre-cutscene player pose.
- Cutscene presentation is behind one director boundary so an MP4 presenter can replace the WebGL presenter later without changing gesture detection or state restoration.

## Sequence

1. `KnockGestureDetector` recognizes two forward impulses inside a bounded time window while a fist is held.
2. `KnockDoorDirector` captures player and hand state, pauses gameplay input, and holds the final knock pose.
3. The hinged door opens to a narrow angle; a procedural shadow arm reaches through the gap.
4. The wrist is pulled toward the gap while the camera follows a deterministic layered sway and impact curve.
5. The player recoils and breaks free; the threat arm withdraws and the door closes.
6. A blood handprint/bruise mark remains attached to the player wrist for the rest of the session.
7. Player body, yaw, pitch, render angles, camera order, hand tracking, and control ownership return to their captured values.

## Quality gates

- Voice unit tests prove recognition starts synchronously on `pressed`, is not started twice on `recording`, and stops/cancels on release/error/background.
- NPC GLBs are inspected with real GLTF loading and rendered from gameplay camera. Screen-space character bounds must contain torso and legs, avoid clipping/exploded geometry, and use fallback on failure.
- Night manifest and scene tests enforce a non-black background/fog luminance floor and lower ambient intensity than the flashlight-lit area.
- Gesture tests cover one knock, slow knocks, walking-like motion, two valid knocks, cooldown, and reset after losing focus.
- Cinematic tests cover phase order, preserved knock pose, door crack angle, struggle camera displacement, blood mark, abort cleanup, and exact player restoration.
- Hand adapter tests prove strong fists reach authored closed endpoints and open hands reach authored rest endpoints.
- Final verification includes the full test suite, production build, desktop and mobile-sized Playwright screenshots, console errors, nonblank canvas pixels, and public URL health.
