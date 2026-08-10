# NPC Spatial Voice AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Add three animated village NPCs with deterministic acoustic attention, positional speech, phone/desktop callouts, stateful local conversation, and an optional server-only OpenAI Realtime upgrade.

**Architecture:** Pure shared modules decide cue meaning, acoustic listener selection, and attention state. A village NPC system owns render actors, animation, expressions, and per-actor positional audio. A coordinator joins those layers to the existing phone clip transport and desktop input. Server adapters provide bounded transcription, strict attention performance, and a WebRTC Realtime bridge without ever exposing the API key.

**Tech Stack:** Three.js, Web Audio, GLTFLoader, Socket.IO/WebRTC data channels, Express, OpenAI HTTP/WebRTC APIs, Vitest.

---

## Task 1: Conversation Domain

**Files:**
- Create: `src/shared/npc-cues.js`
- Create: `src/shared/npc-listener-resolver.js`
- Create: `src/shared/npc-attention-machine.js`
- Test: `tests/npc-cues.test.js`
- Test: `tests/npc-listener-resolver.test.js`
- Test: `tests/npc-attention-machine.test.js`

1. Write failing tests for exact-boundary names, Chinese/English greetings and cancellations, intent classification, radius clamping, distance/facing score, generic greeting cap, stable tie breaking, confidence rejection, every state transition, one clarification, generation-token cancellation, timeout, and one-shot conversation handoff.
2. Run `npx vitest run tests/npc-cues.test.js tests/npc-listener-resolver.test.js tests/npc-attention-machine.test.js` and confirm failures are missing behavior rather than syntax.
3. Implement the smallest dependency-free pure modules satisfying the specification formulas and state graph.
4. Re-run the focused tests and confirm green.

## Task 2: Three Independent Roles And Performer

**Files:**
- Create: `src/desktop/npc/npc-roster.js`
- Create: `src/desktop/npc/NpcPerformer.js`
- Test: `tests/npc-roster.test.js`
- Test: `tests/npc-performer.test.js`

1. Write failing tests proving Mara, Bram, and Elowen have separate public/private knowledge, mutable relationship state, recent-turn limits, unique fallback lines, and no cross-NPC secret leakage.
2. Write failing tests for strict performer JSON validation, allowed actions/emotions, known NPC ids, length limits, invalid-response fallback, and cancellation tokens.
3. Run focused tests and confirm red.
4. Implement authored local acknowledgements, clarifications, dismissals, and stateful conversation replies plus the optional remote performer adapter.
5. Run focused tests and confirm green.

## Task 3: Free NPC Asset Intake And Embodiment

**Files:**
- Create: `public/assets/npcs/manifest.json`
- Create: `public/assets/npcs/PROVENANCE.md`
- Add: `public/assets/npcs/models/*.glb`
- Create: `src/desktop/npc/VillageNpcActor.js`
- Create: `src/desktop/npc/VillageNpcSystem.js`
- Create: `scripts/verify-npc-assets.mjs`
- Test: `tests/npc-assets.test.js`
- Test: `tests/village-npc-system.test.js`

1. Acquire only free Fab models whose listing permits AI use, accepting the Fab EULA through the official listing download flow. Record URL, author, license, date, file hash, animation clips, and morph targets.
2. Write failing asset/manifest tests for three role entries, local files, nonzero geometry, replacement-safe scale/rotation, animation mapping, and authored village positions.
3. Write failing actor tests for animation fallback, expression morph fallback, player look-at, mouth anchor, and immediate procedural actor fallback when a GLB fails.
4. Implement the manifest verifier, GLB loader, animated actors, role props, and village system.
5. Run `node scripts/verify-npc-assets.mjs` and focused tests.

## Task 4: Positional Voice

**Files:**
- Create: `src/desktop/npc/NpcSpatialVoice.js`
- Test: `tests/npc-spatial-voice.test.js`

1. Write failing tests using lightweight audio/Three fakes for one camera listener, per-NPC panners, world-position updates, ref/max distance, rolloff, directional cone, occlusion filtering, subtitle callback, interrupt, and disposal.
2. Run the focused test and confirm red.
3. Implement decoded-buffer playback, media-stream attachment for Realtime output, immediate browser-speech/local tone fallback, interruption, and occlusion updates.
4. Re-run the focused test and confirm green.

## Task 5: Attention Coordinator And Local Conversation

**Files:**
- Create: `src/desktop/npc/NpcConversationCoordinator.js`
- Test: `tests/npc-conversation-coordinator.test.js`

1. Write failing scenario tests from the integration specification: named/generic calls, distance/facing selection, first-call acknowledgement only, clear purpose, dismissal, ambiguity, timeout, moving out of range, overlapping calls, stale responses, one-shot opening utterance, interruption, and offline fallback.
2. Run the focused test and confirm red.
3. Implement orchestration around roster, resolver, machine, performer, actors, spatial voice, and UI callbacks.
4. Re-run the focused test and confirm green.

## Task 6: Phone Voice Transport

**Files:**
- Modify: `src/shared/protocol.js`
- Modify: `src/desktop/PhoneSession.js`
- Modify: `src/controller/ControllerApp.js`
- Modify: `src/controller/ControllerSocket.js`
- Modify: `src/controller/VoiceHoldController.js`
- Test: `tests/protocol.test.js`
- Test: `tests/controller-app.test.js`
- Test: `tests/voice-hold-controller.test.js`

1. Add failing tests for desktop `voice-clip` delivery, a third `voice` RTC data channel, `voice-start`/PCM/`voice-stop` frames, maximum chunk size, ownership, press feedback, and fallback to the existing bounded Socket.IO clip.
2. Run focused tests and confirm red.
3. Implement the reliable voice channel without changing controls/hand ordering or existing recording semantics.
4. Re-run focused tests and confirm green.

## Task 7: Optional Server AI And Realtime Client

**Files:**
- Create: `server/npc-ai.js`
- Create: `src/desktop/npc/RealtimeNpcSession.js`
- Modify: `server/index.js`
- Test: `tests/npc-ai-server.test.js`
- Test: `tests/realtime-npc-session.test.js`

1. Write failing tests for no-key status, MIME/size/rate validation, bounded transcription, strict performer prompts, selected-NPC-only secrets, SDP forwarding, upstream timeout, abort propagation, and sanitized errors.
2. Write failing client tests for WebRTC SDP exchange, 24 kHz PCM append events, semantic VAD configuration, transcript events, remote audio attachment, `response.cancel`, `output_audio_buffer.clear`, reconnect fallback, and generation-token filtering.
3. Run focused tests and confirm red.
4. Implement injectable `fetch` adapters and Express handlers using `OPENAI_API_KEY` only on the server.
5. Re-run focused tests and confirm green.

## Task 8: Village And Desktop Integration

**Files:**
- Modify: `src/desktop/create-scene.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Test: `tests/village-scene.test.js`
- Test: `tests/desktop-app.test.js`

1. Add failing tests that the village scene creates/disposes the NPC system without delaying environment startup, DesktopApp consumes phone clips, Space starts callout when door defense does not own it, phone voice UI reflects capture, coordinator updates each frame, subtitles/status render, and non-village scenes remain unchanged.
2. Run focused tests and confirm red.
3. Integrate the NPC system after the village environment is ready. Do not add NPCs to `interactables`; voice attention owns them.
4. Integrate coordinator lifecycle, keyboard capture/text demo fallback, pause/disconnect cancellation, runtime diagnostics, and cleanup.
5. Re-run focused tests and confirm green.

## Task 9: Acceptance And Build Verification

**Files:**
- Create: `tests/npc-spatial-voice-acceptance.test.js`
- Modify: `README.md` or project run documentation if present

1. Encode all acceptance cases from `D:\md\NPC_SPATIAL_VOICE_AI_INTEGRATION_SPEC.md` as deterministic integration tests.
2. Run `npm test` and fix only regressions caused by this feature while preserving prior user changes.
3. Run `node scripts/verify-npc-assets.mjs` and `npm run build`.
4. Start the app, inspect desktop and mobile controller in a real browser, confirm nonblank canvas pixels, all three NPCs, animations, spatial volume changes, phone capture feedback, local conversation, and no-key failover.
5. Record the local demo URL, optional HTTPS tunnel URL, asset provenance, required environment variable, and exact verification results.
