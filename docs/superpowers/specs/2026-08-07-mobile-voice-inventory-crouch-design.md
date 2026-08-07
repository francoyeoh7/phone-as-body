# Mobile Voice, Inventory Trackpad, Crouch, and Held Equipment Design

## Goal

Add three phone interactions to Corridor 617 without changing the current gyroscope algorithm or breaking full-screen touch, movement, flashlight, rear-camera hand tracking, found-phone inspection, or sustained hand tasks:

1. A small bottom phone region records and sends voice while held.
2. A persistent top-right orb opens a desktop inventory bar and acts as a relative trackpad for item selection.
3. A fast downward joystick gesture into the bottom edge, followed by a hold, crouches the player.

The first version deliberately excludes speech-to-text, voice understanding, NPC replies, and voice persistence.

## Non-Negotiable Input Invariants

- The existing gyroscope sampling, gain, fast-turn behavior, pitch suppression, smoothing, clutch, and recenter logic are unchanged.
- Rear-camera hand tracking remains independent from touch. Camera denial or tracking loss cannot block gyro, movement, flashlight, or touch fallback.
- A pointer owner is chosen on pointer down and cannot change until pointer up or cancellation.
- A pointer that begins in the voice region is never a joystick tap, world interaction, or crouch gesture.
- A pointer that begins in the gameplay surface can become crouch after entering the bottom region, but can never become voice.
- Voice may coexist with one already-owned gameplay pointer, so the player may speak while moving or looking.
- Inventory is touch-modal. Opening it cancels voice, neutralizes movement, resets the current joystick gesture, and closes the existing gyro clutch through the current reset path. The motion sensor remains enabled; the player re-engages view control after inventory closes.
- Semantic hand tasks and focused world interactions always have priority over displaying an equipped item.

## Phone Layout

The phone remains a quiet, screen-first controller. It adds only two persistent controls:

- Bottom voice region: `clamp(68px, 12dvh, 96px)` high, including the bottom safe-area inset, with a centered microphone glyph and no instructional copy.
- Inventory orb: a 52px circular icon button at the top-right. The existing settings button moves left within the same utility row so the hit targets never overlap.

Both controls use Lucide icons and explicit stable dimensions. The voice region and orb receive pointer events; all other decorative children remain non-interactive.

## Pointer Ownership

A controller-side pointer coordinator owns the following state:

| Owner | Claim | Coexistence | End behavior |
| --- | --- | --- | --- |
| `gameplay` | Down outside bottom region and modal UI | May coexist with one voice pointer | Existing tap, drag, movement, and gyro clutch behavior |
| `voice` | Down inside bottom region | May coexist with gameplay | Stop and send on normal release; discard on cancellation |
| `inventory` | Down on the top-right orb | Exclusive for touch | Commit hovered slot on release; cancel on lifecycle loss |
| `crouch` | Substate of a gameplay pointer | Keeps the current gameplay clutch until release | Send stand state exactly once, then perform normal reset |

Voice and orb handlers synchronously call `preventDefault()` and `stopPropagation()` before any asynchronous permission work. This is necessary because the current joystick treats a second bubbling pointer as multitouch before consulting its ignored-target callback.

Every delayed transition stores the pointer ID and a generation token. Pause, reorientation, disconnect, replacement, page hide, lost pointer capture, and destruction invalidate the generation before releasing capture. Cleanup is idempotent because releasing capture may synchronously generate another cancellation event.

## Voice Recording

### Recognition

- Pointer down in the voice region starts microphone permission preparation during the user activation.
- Recording commits after a 420ms dwell if movement remains within 14px and the pointer remains in the region.
- A short press, early exit, excessive movement, or permission denial consumes the pointer but does not create a clip or world interaction.
- Once committed, the phone sends `voice-recording: active`, begins `MediaRecorder`, and shows an active microphone state.
- Normal release stops recording, sends `voice-recording: inactive`, then sends the completed clip.
- Inventory opening, backgrounding, pausing, disconnecting, or cancellation sends inactive exactly once and discards the unfinished clip.
- Recording automatically stops and sends at 10 seconds. Continued physical holding does not start another clip until the pointer is released and pressed again.

### Transport And Privacy

Recording state uses the existing reliable controller-action Socket.IO path. Completed audio uses one new reliable binary event, `controller:voice-clip`. It does not use the lossy hand DataChannel and does not block input or hand frames.

Each clip has:

- protocol version and monotonic sequence;
- duration, MIME type, and binary bytes;
- maximum duration of 10,000ms;
- maximum payload of 256KiB;
- MIME base allowlist of `audio/webm`, `audio/ogg`, and `audio/mp4`;
- a per-controller acceptance limit of one completed clip per second.

The server validates ownership, keys, duration, MIME type, byte length, sequence, and rate before relaying. It never stores audio. The desktop validates again and dispatches an in-memory `voice-clip` event for a future NPC system. No transcript, recognized intent, NPC response, playback, file write, or database field is created in this phase.

The desktop shows a compact microphone status glyph at the bottom center only while the accepted recording state is active. It never shows this indicator for permission preparation or a failed short press. Subtitles remain above it and do not overlap.

## Inventory Trackpad

### Interaction

1. Orb pointer down immediately opens the top-center desktop inventory bar.
2. The phone captures the orb pointer, cancels active voice, resets the joystick, and blocks new gameplay pointer claims.
3. Pointer movement is coalesced to at most 30Hz and sent as bounded relative `dx`/`dy` deltas over the reliable ordered controller-action path.
4. The desktop owns the inventory cursor. It starts over the equipped slot, otherwise the first acquired slot, otherwise the center of the empty bar.
5. The desktop integrates relative deltas within the inventory bounds and highlights the slot under the cursor.
6. Normal release flushes the final delta, commits the hovered enabled slot, closes the bar, and returns the orb to its home position.
7. Release outside a slot or release with an empty inventory is a no-op and preserves the previous equipped item.
8. Cancellation closes the bar without changing equipment.

Inventory messages use one validated action, `inventory-pointer`, with phases `open`, `move`, `commit`, and `cancel`. Socket.IO ordering avoids cross-channel release races. Move payloads accept only finite deltas clamped to a small per-message range.

The bar contains acquired items only; it is not a catalog. The first registered item is `spare-fuse`:

- The bar is empty at game start.
- Successfully collecting the scene fuse acquires `spare-fuse` and reveals its slot.
- Selecting its slot marks it equipped.
- Installing it in the power panel consumes it and removes the slot.
- Touch fallback may still install a carried fuse when camera tracking is unavailable, preserving the existing playable fallback path.

The data model separates story history from inventory truth. "Fuse was collected" remains a story fact after installation, while ownership changes from acquired to consumed.

## Equipped Item And Hand Priority

The existing target-bound `HandGestureGate` remains target-bound. It is not weakened to accept a null target. A separate untargeted hold gate controls only equipped-item presentation.

Priority is:

1. paused, destroyed, or cinematic suppression;
2. active semantic hand task such as door defense or found-phone hold;
3. focused world target with matching target ID and epoch;
4. equipped-item presentation when no target or task owns the hand.

For an equipped item, a stable raw-pose grab for at least three fresh samples and 160ms shows the item in the tracked left hand. Release uses a lower grab threshold and at least 120ms of open-hand evidence before hiding it. This hysteresis prevents single-frame flashing. Tracking loss freezes the last stable pose briefly and fades the hand and item together.

Entering a task, acquiring a target, starting a cinematic, pausing, or disconnecting hides the held item and suppresses the hold gate until an open-hand release. A grab that began for an inventory item therefore cannot leak into a door, phone, panel, or other world interaction.

The held fuse is a detached render-only clone attached to an explicit palm grip anchor in the existing left-hand rig. It does not reuse or reparent the scene interactable, halo, collider, or disposal ownership. Its transform follows the same tracked palm position, wrist rotation, and finger pose as the visible hand.

When the panel is focused, a target-authorized grab has priority. With hand tracking available, panel use requires the fuse to be equipped and then consumes it. With camera fallback active, the existing touch interaction may consume a carried fuse without requiring a tracked pose.

## Crouch Gesture

Crouch is recognized only from the pointer already owned by the virtual joystick:

- pointer begins outside the bottom voice region;
- it enters that same bottom region within 280ms of pointer down;
- downward displacement is at least 48px;
- `abs(dx) <= 0.65 * dy`, rejecting diagonal movement;
- it remains inside the bottom region for 180ms.

If any condition fails, the gesture remains ordinary joystick movement. A pointer that begins in the voice region can never crouch. Crouch recognition is disabled while the joystick is repurposed as the door-defense fallback hold.

On commit, the controller sends zero movement immediately and sets `crouch: true` in the existing sequenced input snapshot. Further movement from that pointer is suppressed while held. Pointer up, cancel, pause, disconnect, reorientation, or destruction sends `crouch: false` exactly once and performs the existing joystick reset.

The desktop smoothly damps the camera eye offset from 0.55m to approximately 0.20m and movement speed from 3.25m/s to 2.0m/s with a roughly 0.12s time constant. The first version keeps the standing Rapier capsule because the current scene has no crouch-only clearance; shrinking it safely would require body-center compensation and an overhead clearance test before standing. Keyboard fallback uses hold `Control` or `C` and shares the same presentation state.

## Protocol Changes

- Add optional inbound `crouch` to controller input, normalized to `false` for older clients and all disconnect/stale snapshots.
- Add controller actions `voice-recording` and `inventory-pointer` with action-specific exact-key validation.
- Add `controller:voice-clip` and a binary clip validator.
- Relay normalized accepted input rather than the original untrusted object.
- Reset voice sequence/rate bookkeeping on controller replacement and disconnect.
- Do not modify hand-frame schema, RTC negotiation, orientation payloads, or gyroscope settings.

## Failure And Lifecycle Handling

- Microphone unsupported or denied: voice zone becomes unavailable for that attempt; gameplay continues.
- Oversized, invalid, stale, or rate-limited clip: discard and acknowledge failure; never block controls.
- Inventory opened before gameplay or during a cinematic/task: reject, close, and leave equipment unchanged.
- Phone disconnect: recording indicator off, inventory closed, cursor cleared, crouch released, held item hidden, movement neutralized.
- Desktop pause or page hide: same transient cleanup while acquired/equipped inventory ownership remains.
- Tracking confidence loss: no new held-item transition; preserve then fade the last stable hand pose.
- Multiple hands: the existing rear-camera left-hand selection remains authoritative.

## Verification

Automated tests cover:

- pointer ownership, voice/gameplay coexistence, inventory modal exclusion, and stale timer invalidation;
- voice short press, dwell, movement slop, permission denial, cancellation, size/time limits, MIME validation, ordering, rate limit, and no persistence;
- inventory open/move/commit/cancel ordering, cursor bounds, empty release, acquire/equip/consume, and task/cinematic rejection;
- crouch success and failures at the displacement, timing, direction, bottom-region, and door-fallback boundaries;
- immediate neutral movement on crouch, exactly-once stand cleanup, and frame-rate-independent camera-height damping;
- equipped-item grab/release hysteresis, target/task priority, suppression-until-release, tracking loss, and resource disposal;
- protocol backward compatibility for UE bridge and older neutral input packets;
- disconnect, replacement, pause, background, reorientation, and destroy cleanup.

Manual phone-to-desktop acceptance checks verify:

1. Speaking while moving does not cancel movement or create a world interaction.
2. The desktop microphone icon exactly follows actual recording.
3. Orb drag feels like a relative trackpad, selects only acquired items, and never rotates or moves the player.
4. A collected fuse can be equipped, appears only while a stable left-hand grab is held, and is consumed at the panel.
5. A fast downward joystick gesture crouches, normal backward movement does not, and release always stands.
6. Gyroscope view behavior, flashlight, sink, found phone, window task, target grab, and door defense remain unchanged.

## Explicit Exclusions

- No speech-to-text, intent classification, NPC dialogue, voice playback, or NPC response.
- No saved voice files or server-side audio history.
- No new complex hand-gesture vocabulary.
- No gyroscope algorithm or camera-selection changes.
- No crouch-only collision passages until safe capsule resizing and stand-clearance checks are implemented.
- No GitHub push, Release upload, or public deployment without explicit user authorization.
