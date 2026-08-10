# NPC Spatial Voice AI Design

**Date:** 2026-08-10

## Goal

Add three embodied village NPCs to the existing Three.js web experience. The player first calls to someone in the world, the acoustically best listener notices the player, and only a follow-up statement can begin a formal conversation. Spatial voice is the primary experience: every acknowledgement and reply must originate from the selected NPC's world position and become quieter with distance and orientation.

The implementation must preserve the existing village, movement, phone controller, hand tracking, crouch, sink, and door-defense systems. It must remain playable without paid services or an API key, while allowing a server-only OpenAI key to enable natural real-time conversation.

## Decision

Keep the current web/Three.js application and add a web-native hybrid voice system.

Rejected alternatives:

- Moving to UE5 or Unity would require rebuilding the village, phone WebRTC controls, hand tracking, movement, and current interactions before any NPC work could be demonstrated.
- Opening a formal AI session for the first callout would allow an AI model to bypass the required acoustic listener selection and leak private NPC knowledge before a listener has been chosen.
- Requiring cloud speech services would make the demo fail without billing, connectivity, or an API key.

The selected architecture separates deterministic world interaction from optional generative conversation. It therefore remains fast and demonstrable locally and upgrades in place when a key is configured.

## Experience

The initial village cast is:

| NPC | Public role | Knowledge boundary | Default behavior |
| --- | --- | --- | --- |
| Mara | Innkeeper | Guests, local rumors, recent visitors | Wipes the counter, greets warmly, becomes guarded around private rooms |
| Bram | Blacksmith | Tools, repairs, metalwork, unusual damage | Hammers at the forge, speaks directly, distrusts gossip |
| Elowen | Herbalist | Plants, injuries, remedies, woodland paths | Sorts herbs, observes carefully, avoids unsupported accusations |

Each NPC owns an independent identity, public story, private goal, emotional wounds, evidence thresholds, relationship state, admissions, and recent-turn history. Private facts are never included in another NPC's prompt.

The player flow is:

1. Hold the phone voice control or the desktop callout key and speak for up to four seconds.
2. The game evaluates the transcript against NPC names, greetings, requests, distance, and the player's facing direction.
3. At most one NPC notices. That NPC turns toward the player and gives a short positional acknowledgement.
4. During the follow-up window, the player states a purpose, dismisses the NPC, or remains silent.
5. A clear purpose opens formal conversation and submits the opening utterance exactly once. A dismissal or timeout returns the NPC to its ambient behavior.
6. During conversation the player may interrupt an NPC naturally. Replies remain attached to the NPC's position.

The first callout never opens formal conversation by itself.

## State Model

The explicit attention states are:

`Idle -> CapturingCallout -> NpcNoticed -> AwaitingIntent -> ConversationRequested | Cancelled | ClarifyingIntent -> AwaitingIntent | TimedOut`

Only one exchange may be active. Each capture and AI request carries a monotonically increasing generation token. Late transcription, performer, or Realtime events are discarded when their token no longer matches. Clarification is allowed once; a second ambiguous reply times out.

The callout capture target is 3.8 seconds, the follow-up window is 5 seconds, and a recording may be cancelled immediately. Cancellation phrases such as `没什么`, `算了`, `不是叫你`, and their English equivalents always win over engagement.

## Acoustic Selection

Listener selection is a pure deterministic module with exact word-boundary matching. `Ward` must not match `toward`.

- `hearingRadius = clamp(3.5 + voiceLevel * 10, 3.5, 12)`
- Generic greetings are ignored beyond 8 metres.
- An existing exchange is cancelled beyond `1.25 * hearingRadius`.
- Facing factor is `1` at dot product `>= 0.5`, `0.85` at `>= -0.3`, otherwise `0.65`.
- Cue weights are `0.65` named, `0.25` greeting, `0.4` request, and `0.35` directed.
- Final score adds `distanceFactor * 0.35 + facingFactor * 0.2`.

Confidence below `0.45` cannot engage. Ties are resolved by score, then distance, then stable NPC id so results do not vary frame to frame.

## Components

### Shared conversation domain

- `npc-cues` normalizes transcripts, performs boundary-safe cue matching, and classifies cancellations and intent.
- `npc-listener-resolver` scores the village cast using current world transforms.
- `npc-attention-machine` owns states, deadlines, generation tokens, and clarification count.
- `npc-performer` validates strict AI JSON and provides deterministic local acknowledgements when AI is unavailable or invalid.
- `npc-roster` contains public and private role configuration without scene dependencies.

### Village embodiment

- `VillageNpcActor` owns the loaded model, animation mixer, expression/morph weights, look-at behavior, and an interaction anchor.
- `VillageNpcSystem` places the three actors at authored village anchors and exposes snapshots to the listener resolver.
- NPC loaders accept external GLB assets through a stable manifest. If a downloaded model is missing or incompatible, a polished role-colored fallback actor is created immediately rather than blocking the village.

Free Fab assets are stored locally under `public/assets/npcs`, accompanied by source URL, author, license/EULA, original filename, and download date. The first asset set uses a free animated character with facial morphs for the innkeeper, a free rigged knight character adapted with blacksmith props, and a free rigged older woman for the herbalist. Their role props and material treatment visually unify them while retaining replaceable model boundaries.

### Spatial audio

The camera owns one `THREE.AudioListener`. Each NPC owns one positional voice node at its mouth anchor. A Web Audio `GainNode` and low-pass stage feed that positional node, allowing distance rolloff, facing emphasis, and environment occlusion without altering the global ambience.

Defaults are `refDistance = 1.6`, `maxDistance = 14`, `rolloffFactor = 1.45`, and a directional cone that reduces speech behind the actor without muting it. A ray from camera to mouth checks the existing environment occluders; blocked speech receives a gentle low-pass filter and gain reduction. Subtitles remain available for accessibility but never replace spatial sound.

Local fallback speech uses short bundled voice clips where available and an immediate browser speech-synthesis fallback routed through the NPC panner. The fallback must never wait for a network timeout.

### Phone capture and desktop transport

The existing bounded `controller:voice-clip` path supplies attention callouts and follow-up intent. Desktop receives those clips and posts them to a same-origin transcription endpoint when a server key exists. Without a key, the controller exposes a text fallback for deterministic demo phrases and desktop keyboard input can exercise the same state machine.

Formal conversation adds a third `voice` WebRTC data channel beside the current `controls` and `hand` channels. The phone sends 24 kHz mono PCM16 chunks with `voice-start` and `voice-stop` control frames. The desktop forwards chunks to an active Realtime session using `input_audio_buffer.append` events. This avoids renegotiating the already established phone media connection.

### Optional AI services

The server exposes same-origin endpoints that read `OPENAI_API_KEY` only on the server:

- attention transcription for bounded clips;
- an attention performer returning strict JSON;
- a Realtime WebRTC session bridge receiving browser SDP and returning SDP.

The browser never receives the standard API key. The formal Realtime client uses semantic VAD, transcription, and explicit interruption. When the player begins speaking over an NPC, it sends `response.cancel` and clears the current output audio buffer before forwarding new input.

The performer response schema is validated before use. Unexpected keys, unknown NPC ids, overlong speech, invalid actions, or unsupported emotional states fall back to local authored output.

## Failure Behavior

- Missing API key: show a small `本地对话` status and use authored stateful replies immediately.
- Failed transcription: keep the current state and offer one concise retry, never an endless loader.
- Invalid AI output: use local performer output.
- Realtime disconnect: preserve relationship state and continue through local turn-based dialogue.
- Late response after cancellation or a new callout: discard it using the generation token.
- NPC asset failure: render the fallback actor and keep interaction/audio anchors active.
- Phone disconnect: desktop keyboard/microphone fallback continues to use the same coordinator.

## Security And Cost

No paid third-party asset or service is required for the local experience. All selected model assets must be listed as free and permit use with AI at the download date. AI requests are optional and bounded. Prompts contain only the selected NPC's data and recent turns. Server endpoints enforce clip size, MIME type, request ownership, rate limits, response size, and cancellation.

## Verification

Automated tests cover cue boundaries, scoring thresholds, all state transitions, one-shot handoff, cancellation races, strict JSON validation, NPC-independent memory, audio-node positioning, phone voice frames, Realtime interruption, offline fallback, and the acceptance cases from the integration specification.

Browser verification covers:

- all three NPCs visibly render and animate in the real village;
- looking and moving relative to them changes selection and perceived volume;
- first callout only causes acknowledgement;
- follow-up purpose opens conversation once;
- interruption stops the current reply;
- the phone path and keyboard fallback reach identical states;
- missing network/key/model never causes a black screen or long loading gate;
- desktop and mobile viewports retain existing controls without overlap.

## Replacement Boundaries

NPC models, voices, the AI performer, transcription, and formal conversation transport are interfaces. They may be upgraded independently without changing the acoustic resolver, attention state machine, village movement, or existing interaction systems.
