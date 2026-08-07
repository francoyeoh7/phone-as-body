# Left-Hand Village Experience Design

## Goal

Replace the current rigid two-hand presentation with a responsive physical-left-hand interaction system, and relocate the existing Corridor 617 tasks into a realistic night-time exploration area built from a high-fidelity subset of the ElderBoom Hollow Fab environment.

The retained village assets keep their source texture resolution, PBR material detail, and close-range geometry. Scope is reduced by omitting unused parts of the 12 GB source environment, not by lowering the visual quality of the selected houses or nearby route.

## Binding Constraints

- The existing phone gyroscope view algorithm, virtual joystick movement, flashlight control, full-screen touch behavior, pairing protocol, and mandatory motion permission must not regress.
- The rear camera is the only camera used. Raw video remains on the phone; only derived landmarks and state are transmitted.
- Only the player's physical left hand may drive the virtual hand or authorize a hand interaction. Physical right-hand samples are ignored.
- The virtual left forearm originates outside the lower-left of the desktop view. The right side remains visually reserved for the implied flashlight hand.
- The hand is visible during normal exploration whenever left-hand tracking is valid, but it stays in a short neutral reach when no target is selected.
- A focused target may guide the hand toward an authored contact point, but focus alone must never synthesize a gesture or pull the arm fully across the scene.
- Camera denial or tracking loss must preserve the existing non-camera controls and must never block the game after the mandatory motion permission succeeds.
- All implementation commits remain local until the user explicitly authorizes another GitHub push.

## Approaches Considered

### Selected: High-fidelity spatial subset

Keep one or two complete houses, their immediate yards, connecting path, corners, vegetation, and sight lines. Preserve original texture resolution and the close-range meshes for everything the player can approach. Omit the rest of the village and stream the retained area in spatial chunks.

This provides multiple routes, turns, observation angles, and a realistic material response without forcing a browser to download the full 12 GB source pack.

### Rejected: One linear road

A single road would load quickly but would reproduce the corridor problem: weak spatial exploration, few meaningful turns, and poor opportunities to look around a building.

### Rejected: Full village export

The complete pack is unsuitable for a QR-launched browser build. It would create excessive initial download, GPU memory pressure, shader compilation time, and mobile-to-desktop demonstration risk. The task does not need every distant house to prove the interaction.

## Left-Hand Camera Contract

Camera landmarks are first normalized into the displayed rear-camera orientation. Handedness is corrected once for the non-mirrored rear camera. Samples labelled as the physical right hand are discarded before reach state, transport authority, rendering, or gesture classification.

Initial acquisition requires the physical left wrist and palm to enter through the normalized lower-left portion of the camera frame. Acquisition uses a short multi-frame dwell and coverage check rather than a single frame. Once acquired, the hand may move farther toward the center to complete an interaction, but the virtual shoulder and elbow remain outside the desktop's lower-left edge. Entering from the upper edge or presenting only a right hand cannot acquire interaction authority.

Phone rotation must be resolved from actual video dimensions and orientation events rather than silently assuming zero degrees. Tests cover portrait and both landscape rotations.

## Responsive Tracking Pipeline

The current effective cadence is reduced by waiting a full sample interval after every inference. The new scheduler uses video-frame availability and absolute deadlines so inference time consumes the interval instead of extending it. The worker path is preferred where supported, with a main-thread fallback that remains latest-frame-only. Old camera frames are never queued for reliable replay.

Tracking confidence no longer treats ordinary intentional movement as evidence that the hand disappeared. Confidence combines MediaPipe detection/handedness evidence, landmark coverage, plausible palm-scale change, and bounded temporal continuity. Large impossible jumps are rejected as outliers; normal reach and finger motion remain valid.

Rendering and semantic recognition use separate filters:

- Wrist position and rotation use one velocity-adaptive visual filter with a short response time.
- Finger joints use light per-joint smoothing that preserves pinch and splay.
- Gesture scores use a short raw-feature window with hysteresis and a brief confidence-loss grace period.

Target measurements are an actual tracked cadence of at least 12 Hz, wrist 50 percent step response within 100 ms, and 90 percent response within 180 ms on the test device.

## Hand Pose And Model

The renderer is locked to the left-hand rig. There is no 500 ms handedness competition or initial right-hand activation. Every finger segment receives its own tracked direction or bend instead of sharing one curl value across an entire finger.

The runtime first uses the precise joint-mapped rig as the correctness path. A higher-detail redistribution-safe FPS left arm may replace the presentation only after its hierarchy is verified and each phalanx can be driven independently. A visually detailed asset must not be accepted if it reintroduces rigid whole-finger interpolation or broken skinning.

The arm has two presentation states:

- Neutral exploration: the forearm stays near the lower-left, with no more than roughly the bottom third of the hand/arm visible and depth driven only within a conservative range.
- Targeted reach: the elbow remains off-screen while the palm follows the player's measured reach toward the focused contact point. Contact normal controls the final surface offset and palm orientation. Full contact occurs only after a valid action candidate, not at focus time.

On low confidence the last stable pose freezes briefly and fades or retracts. No pose may snap to the screen center or apply non-finite bone transforms.

## Gesture Semantics

The canonical pose exposes independent curls, pinch strength, fist strength, openness, palm facing, grasp strength, relative depth, confidence, and reach eligibility. `graspStrength` is shared by ordinary interactions and hold tasks so a valid pinch cannot trigger selection and then immediately fail the phone task.

An ordinary action requires a stable focused target, fresh physical-left-hand tracking, acquired lower-left reach, and a confirmed grasp. A 100-140 ms confidence gap pauses rather than clears a candidate. Separate enter and exit thresholds prevent rapid state toggling. The existing 500 ms action cooldown remains.

Sustained tasks continue to require sustained input:

- Found phone: grasp to lift, keep grasping to browse, release to drop, then retain the existing three-second repickup delay.
- Door defense: open-palm push/brace must remain valid while progress advances; brief instability pauses, sustained release decreases or restarts progress according to the existing task contract.
- Sink and pickup: one confirmed grasp toggles or collects the target, then requires release before another activation.

## Aim Assist And Contact

Interactables expose authored interaction anchors, contact radius, maximum use distance, and optional approach direction. Selection ranks screen-space distance to the reticle, world distance, and current-target hysteresis. It uses the anchor rather than the object's arbitrary root origin.

The environment participates in an occlusion raycast so a target cannot be selected through a house or wall. A nearby target receives a subtle reticle magnet and bounded camera assistance; losing it for a few frames uses hysteresis rather than immediate target churn. The hand's visual contact point and the gesture gate always use the same target epoch.

## Village Environment

The selected Fab source is `ElderBoom Hollow Massive Medieval Village Environment`, listing ID `e12de9d5-be28-40df-a387-42ae6f84e05c`. The retained area contains:

- one primary explorable house exterior and yard;
- one secondary house or outbuilding that creates an alternate side path;
- a loop or partial loop around the buildings with at least two 90-degree turns;
- fences, vegetation, ground, props, and sight-line blockers needed to preserve the source scene's realism;
- enough depth beyond the playable boundary that the area does not look like an isolated stage.

Source texture dimensions and PBR maps are retained. Selected close-range meshes are not decimated. Unused village sectors are omitted. Spatial chunks, frustum culling, original-quality GPU texture encoding, conservative shadow casting, and a limited dynamic-light budget provide performance without making retained materials look worse.

The browser runtime loads a versioned environment manifest. It describes chunk URLs, root transforms, collision proxies, spawn, task anchors, cinematic paths, occluders, and semantic light roles. Render geometry and gameplay collision remain separate; imported decorative meshes are not used as expensive full-detail physics meshes.

## Night Conversion

Daylight, bright sky contribution, and daytime directional lighting are disabled. The scene uses a dark night sky, cool moon fill, low ambient exposure, local emissive windows or lamps where composition requires them, fog tuned for depth, and the existing warm flashlight as the dominant near-field light.

Original albedo, normal, roughness, metallic, and AO maps remain intact. Night appearance is produced by lighting and tone mapping rather than darkening or replacing the source textures. Only a small set of nearby objects casts dynamic flashlight shadows; distant/static detail uses baked or non-shadowed lighting to avoid stalls.

## Task Layout

The route begins near the primary house and allows the player to look around before committing to a direction. Existing task IDs and director contracts remain stable while their world transforms move into the manifest.

1. The washbasin and faucet sit beside or just inside a sheltered utility area near the first house and remain repeatable.
2. The found phone lies along a side route or porch where the player must turn and deliberately grasp it.
3. The observation-window task is mounted on the primary house and uses a complete local vignette behind the window.
4. The pickup item is placed in an outbuilding, crate area, or yard corner and remains part of the fuse objective.
5. The installation panel is on a different face of a building, forcing another turn and short traversal.
6. The final door defense occurs at the primary house entrance or a gate reached after circling the buildings.

All mandatory tasks must be reachable by the Rapier player capsule. Cinematic movement and threats use anchor-local directions, not hard-coded world Z assumptions.

## Architecture

- `src/controller/MediaPipeHandTracker.js`: left-only candidate selection, fixed-deadline sampling, rotation normalization, stable calibration, worker/fallback inference.
- `src/shared/hand-pose.js`: motion-tolerant confidence and shared grasp features.
- `src/shared/hand-reach.js`: lower-left acquisition and continuous reach amount.
- `src/desktop/HandPoseStream.js`: single adaptive visual smoothing path.
- `src/desktop/FirstPersonHand.js` and `hand-asset-adapter.js`: left-only arm, independent phalanx driving, neutral/reach presentation, surface contact.
- `src/desktop/HandGestureGate.js` and `hand-task-state.js`: unified gesture hysteresis, grace, and sustained-task semantics.
- `src/shared/interaction.js` and `PlayerController.js`: anchor-aware sticky aim assist and environment occlusion.
- `src/desktop/environment/`: manifest validation, GLTF chunk loading, decoder setup, material preservation, collision proxies, ownership, and disposal.
- `src/desktop/create-scene.js`: assembles the environment contract and existing gameplay components without owning conversion details.

## Failure Handling

- Asset acquisition unavailable: continue implementing and validating the hand and environment interfaces against a small fixture; do not represent a substitute environment as the requested Fab scene.
- Environment chunk failure: show a retryable loading state and dispose partial resources. The current playable build remains available separately.
- Camera or MediaPipe failure: hide the virtual hand and preserve existing touch controls; no pixel-motion fallback is allowed to authorize a hand action.
- Low light or partial occlusion: freeze the last stable hand briefly, pause sustained progress, and provide unobtrusive tracking feedback.
- Network delay: discard stale or out-of-order poses and send latest-only updates.

## Verification

Automated tests must prove left-only selection, lower-left acquisition in all supported rotations, right-hand rejection, fixed-deadline scheduling, motion-tolerant confidence, independent finger motion, unified pinch/grasp behavior, target hysteresis, occlusion, manifest validity, arbitrary task transforms, collider alignment, and local-basis cinematics.

Performance instrumentation records controller inference cadence, phone-to-desktop pose age, render response, environment load size/time, draw calls, triangles, and GPU memory estimates. A paired HTTPS phone/desktop smoke test validates sink toggling, phone hold/release, window task, pickup/panel progression, door defense, neutral hand range, and night flashlight behavior.

Visual acceptance uses fixed screenshots around both houses with flashlight off/on and close material inspection. Selected source textures and PBR maps must retain their original dimensions, and the scene must provide multiple turns and observation angles rather than a single linear road.
