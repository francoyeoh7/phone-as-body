# NPC, Voice, Gesture, and Ground Regression Design

**Goal:** Restore coherent Fab NPCs, dependable phone transcription with visible player subtitles, the approved crouch exit gesture, and detailed village ground without reducing the existing game mode.

## Confirmed Causes

- Mara and Bram's GLBs already contain their source-axis transform. An extra outer `+90deg` X rotation turns the upright character sideways before height normalization, so a thin body dimension is scaled to human height and the remaining axes become several metres long.
- The phone may record `audio/mp4`, but the transcription adapter always names the multipart upload `voice.webm`. The desktop also never publishes a successfully recognized player utterance to the subtitle UI, and its status callback points at a UI method that does not exist.
- The crouch exit still implements the earlier vertical flick contract.
- The retained Fab landscape material is named `LAndscapepaint` and has no base-color texture. The pale green surface is the actual untextured material, not a lighting or loader failure.

## Design

Keep the current Three.js/web architecture and all existing interactions. NPC model intake will normalize in root-local coordinates and reject implausible post-normalization dimensions before hiding the coherent fallback actor. The source-axis correction will be removed from the two affected assets.

Phone recordings will retain their real MIME family and matching file extension through the OpenAI transcription request. Every non-empty transcript, whether produced by browser speech recognition or server transcription, will immediately render as `你：<文字>` before listener selection. Recording/transcription/error status gets a dedicated compact UI surface so failure is visible and never becomes a silent no-op.

While crouched, a stand gesture must start in the gameplay joystick surface, finish within 520 ms, travel at least 42 px right and 36 px up, remain predominantly monotonic toward the upper-right, and finish inside a 28 px strip at the right edge. It remains distinct from held forward/backward movement because posture changes only on release after reaching that edge.

The village loader will replace only the known untextured landscape material with a deterministic, seamless canvas texture containing layered grass, earth, worn-path flecks, and fine roughness variation. Buildings, foliage, source geometry, collision, and all other Fab materials remain untouched.

## Verification

Focused tests must first reproduce each regression, then pass after implementation. The complete suite and production build must pass. A browser smoke check must confirm nonblank village rendering, upright bounded NPC dimensions, textured ground, visible player subtitle/status UI, and the public HTTPS demo endpoint.
