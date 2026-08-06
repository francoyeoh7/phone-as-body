# Camera-Matched First-Person Hand Design

## Goal

Replace the floating, fragmented desktop hand with a stable first-person hand and forearm that enters from the bottom of the player's view, reaches the currently focused interactable, and continuously matches the real hand seen by the rear camera.

The existing gyroscope, joystick, flashlight, touch controls, rear-camera-only capture, and landmark-only network transport remain unchanged.

## Approved Interaction

- A tracked hand may drive the desktop hand during normal exploration, not only during a task.
- The virtual forearm always originates outside the lower edge of the game view. It never enters from the top or appears detached in the center.
- The camera frame has an interaction reach region in its lower portion. The palm center and wrist must enter that region before a gesture can affect the game.
- The reticle still selects the semantic target. When a target is focused, the rendered palm is guided toward that target's authored contact point while finger pose and wrist orientation continue to come from the player.
- A grab, release, or brace is valid only while a real hand is tracked with sufficient confidence inside the reach region for the required duration.
- Moving the phone, lighting changes, or objects passing through the camera cannot trigger an interaction because pixel motion has no interaction authority.

## Approaches Considered

### 1. Correct the checked-in WebXR rig and add a licensed forearm presentation (selected)

The existing MIT-licensed left and right GLBs contain the exact 25 named WebXR hand joints expected by the runtime. Their joints are flat children of one armature, so they must receive properly normalized armature-local joint poses rather than raw MediaPipe coordinates. Add a separately anchored, redistribution-safe forearm/sleeve presentation and keep the existing hand as the guaranteed compatible fallback. This has the lowest interaction risk and directly fixes the observed mesh tearing while allowing a better visual asset to be evaluated independently.

### 2. Retarget a third-party FPS arm rig

A CC0 FPS arm asset can provide a more detailed forearm, but its bone names and hierarchy are not compatible with the current 25-joint contract. It would require an offline retarget pass and visual validation before it can replace the checked-in hand. This remains an optional visual upgrade after the corrected rig passes interaction acceptance.

### 3. Use a prerecorded reach animation

A fixed animation would look stable, but it would not preserve the player's real wrist direction, hand position, or finger state. It conflicts with the central requirement and is rejected.

## Coordinate Contract

`MediaPipeHandTracker` remains the source of 21 normalized image landmarks, 21 world landmarks, handedness, confidence, and timestamps. It requests one hand only. The rear-camera image is not treated as a selfie mirror, and phone video rotation is normalized before reach tests and desktop mapping.

The shared pose layer normalizes handedness once and exposes:

- palm center and wrist position in normalized camera coordinates;
- a right/up/forward wrist basis derived from world landmarks;
- five finger curl values and grab/open scores;
- relative hand scale and tracking confidence;
- reach-region eligibility and entry progress.

The first stable lower-edge entry establishes a bounded palm-span baseline. Later palm-span changes produce relative depth, so moving closer to the camera advances the virtual hand and moving away retracts it. The baseline updates only while the hand is stable and never chases rapid intentional depth movement.

The desktop consumes that canonical pose without another left/right flip. Horizontal hand movement maps to the same horizontal direction after accounting for the physical rear-camera orientation. Image Y is explicitly inverted once when it becomes camera-local Y, because MediaPipe image coordinates grow downward. Palm yaw, pitch, and roll are reconstructed from the wrist basis, while each finger chain is positioned and rotated from its tracked segment directions.

The pose adapter follows the separation used by the official Three.js `XRHandMeshModel`: the consumer receives complete joint poses, while the MediaPipe adapter converts its 21 landmarks into that pose space. It does not treat MediaPipe landmarks as ready-made Three.js bone transforms. The 21-to-25 mapping keeps the project's calibrated metacarpal interpolation and copies distal orientation to tips. This is an application-side heuristic, not a quaternion stream supplied by MediaPipe.

## Reach Region And Entry

Reach is stateful so the player must enter naturally from below but can then extend toward a target. Initial acquisition requires the wrist at image Y >= 0.72, palm center at Y >= 0.50, at least 16 of 21 landmarks in frame, and three fresh frames spanning at least 140 ms. This proves the hand entered through the lower camera edge rather than appearing from above.

After acquisition, the hand may move through X = 0.05..0.95 and Y = 0.15..0.96 to reach objects. Crossing the top entry boundary (wrist Y < 0.28) for more than 120 ms, or losing the hand for more than the existing 250 ms grace period, resets acquisition. Inner and outer margins differ by 0.05 so edge jitter does not flap eligibility. All thresholds run after phone-image rotation normalization.

The visible forearm is anchored outside the lower-left edge for a tracked left hand and outside the lower-right edge for a tracked right hand. A smoothed reach parameter blends the wrist from that off-screen anchor toward the focused target. The elbow remains outside the camera view. If the real hand approaches from the upper portion, its pose may be observed for diagnostics but the game hand remains retracted and it cannot interact.

## Target Contact And Aim Assist

Each focused interactable exposes the raycast hit point and normal in world space. When an assisted target has no hit, the system uses the interactable root position with a conservative surface offset. The player controller reports target identity, contact point, and normal together.

The hand director transforms the contact point into camera-local space and gives it to the first-person hand. The virtual wrist moves toward this point with a 150 ms damped transition, while the tracked camera-space offset is preserved within a bounded contact ellipse. Target guidance affects only the arm reach path; it does not synthesize a grab, overwrite finger curls, or replace the tracked wrist orientation. If focus is lost, the hand retracts toward its lower-edge anchor instead of snapping to screen center.

## Skeleton Driving

On asset load, the renderer records every joint's authored armature-local position and quaternion, the asset palm basis, and the asset palm span. The current WebXR joints are flat children of one armature, not a parented finger chain. Runtime updates therefore convert all MediaPipe world landmarks into one consistent armature-local pose before assigning joint positions.

The conversion subtracts the MediaPipe wrist, expresses every point in the tracked palm basis, applies one bounded asset-palm-span scale, then maps it through the asset rest basis and adds the asset wrist position. Joint frames follow the WebXR asset convention: local `-Z` points along the bone away from the wrist and local `-Y` points out through the skin. Each desired frame is converted into armature space and compared with its recorded rest frame. Wrist orientation is applied once, tips inherit their distal frame, and the separate curl rotation currently layered on top of landmark deformation is removed. This prevents the present axis mismatch, double rotation, and double curl.

This preserves coherent joint spacing and mesh continuity while still matching the player's finger positions. Invalid or non-finite transforms are discarded, leaving the last stable pose intact. Handedness changes require stable evidence before switching models.

## Gesture And Task Gating

The ordinary interaction gate is armed only after a target has remained focused for 100 ms. Changing or losing the target resets any candidate pose, so a grab performed before focus cannot consume the next interaction. The gate requires all of the following:

- a focused interactable;
- a fresh MediaPipe hand frame;
- tracking confidence above the enter threshold;
- reach-region eligibility;
- a smoothed grab score above 0.62 for at least 180 ms and three fresh frames (the release threshold is 0.45);
- a release below a separate exit threshold before another grab can fire;
- the existing 500 ms action cooldown.

The confirmed gesture carries the focused target ID, and `PlayerController` verifies the same target before dispatching it. The grab score combines fist curl and thumb/index pinch evidence and uses the stronger stable interpretation instead of requiring one exact hand shape. Door brace uses the calibrated palm-facing sign and a bounded motion check; approach motion is not treated as a failed brace once the hand settles. Door and found-phone hold tasks receive the same reach-eligible pose. Door progress continues only while the required open-palm push is maintained. The found phone remains held only while grab is maintained. Brief confidence or score loss uses the existing grace period; a single bad frame cannot fail a candidate or release the phone. Sustained loss pauses or releases the task instead of driving the hand with bad data.

## Visual State And Failure Handling

- Valid tracked pose: hand and forearm fade in and follow the player.
- Tracked but not acquired through the lower entry: arm stays retracted near the lower edge and cannot trigger an action.
- Low confidence: retain the last stable transforms, reduce opacity gradually, and pause task progress.
- Hand lost: retract/fade over a short interval; never teleport to a default center pose.
- Permission denied, unsupported device, or model failure: hide the tracked hand and preserve the existing touch fallback. These states do not alter gyro requirements.

The checked-in MIT WebXR hand remains the functional fallback because it matches the runtime skeleton exactly. The visible forearm upgrade must use a source with explicit redistribution rights. Current candidates are CC0 FPS arm packages; a candidate is accepted only after its downloaded GLB hierarchy, normals, skin weights, and license are inspected. Assets with missing Fab license terms or unclear provenance are rejected.

## Components

- `src/shared/hand-reach.js`: pure reach-region eligibility, hysteresis, and normalized entry progress.
- `src/shared/hand-pose.js`: canonical camera-space pose and handedness; adds reach data without changing raw transport.
- `src/desktop/FirstPersonHand.js`: rest-referenced skeleton retargeting, lower-edge arm anchor, target contact interpolation, and loss fade.
- `src/desktop/HandTrackingDirector.js`: target/contact context, stable pose ownership, and reach-aware gesture/task routing.
- `src/desktop/PlayerController.js`: reports focused target and its world contact point.
- `src/desktop/DesktopApp.js`: connects focus/contact data to the hand director without changing existing control paths.

## Reusable Prior Art Reviewed

- Google AI Edge's MediaPipe web samples and Hand Landmarker contract were reviewed for the 21-point browser pipeline; only the data contract is absorbed.
- Three.js `XRHandMeshModel` was reviewed for the named 25-joint consumer and per-frame joint-pose update pattern; its XR runtime coordinates are not copied directly into the MediaPipe adapter.
- Three.js `CCDIKSolver` and `SkeletonUtils.retarget` were reviewed as optional helpers for a future full-arm asset. They are not used to infer an elbow from hand landmarks, because the Hand Landmarker does not provide shoulder or elbow points.
- Kalidokit was reviewed for palm-basis and three-point bend-angle heuristics. It is deprecated and VRM-specific, so only the mathematics is reimplemented in the project's coordinate contract.
- The WebXR generic-hand assets remain the known MIT-compatible fallback. Any replacement forearm asset must have explicit redistribution rights and a checked hierarchy; Fab entries with missing license terms are excluded.

## Verification

Automated tests must prove:

- a rest-equivalent pose preserves the authored bind bounds and joint spacing;
- open, fist, and grab poses map through one bounded wrist-relative similarity transform rather than raw MediaPipe coordinates;
- all skeleton transforms remain finite and connected;
- rear-camera left/right and wrist axes are applied once with no second mirror;
- focus epochs prevent a grab candidate from crossing target changes;
- an upper-frame hand cannot acquire reach or trigger an action;
- a hand must first enter from the correct bottom side, after which it can extend through the allowed reach corridor and follow target contact;
- 0, 90, and 270 degree phone orientations preserve the same physical left/right/up/down mapping;
- target guidance never changes tracked finger curls or wrist direction;
- horizontal, vertical, depth, and wrist rotation changes preserve sign and order through the camera-to-game mapping;
- grab hysteresis works only for a fresh, confident, reach-eligible hand;
- loss freezes/fades instead of snapping or fragmenting;
- door brace and found-phone hold continue to require sustained pose input.

Production verification must include desktop screenshots for retracted, reaching, focused-contact, grab, and tracking-loss states, plus a paired HTTPS controller smoke test. The final public build must keep the existing controller, MediaPipe model/WASM, Socket.IO path, and both hand assets reachable.
