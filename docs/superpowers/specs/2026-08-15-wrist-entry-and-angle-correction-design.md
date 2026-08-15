# Wrist Entry And Angle Correction Design

Date: 2026-08-15
Status: Approved direction

## Goal

Correct the visible left-hand wrist and arm tracking, then match the persistent
right flashlight wrist to the supplied reference photo. The left arm must move
through the viewport boundary with the camera-observed wrist instead of staying
at a fixed lower-left position. The right hand must show its dorsum toward the
camera with the forearm entering diagonally from the lower right.

The existing palm silhouettes, authored grab pose, and finger curl/spread
behavior remain unchanged.

## Confirmed Root Causes

### Left hand

- `pose.center` is the average of the wrist and four MCP landmarks, but the
  renderer currently treats it as the wrist. The actual MediaPipe wrist is
  `pose.landmarks[0]`.
- The current wrist and shoulder mappings contain broad clamp plateaus. In the
  lower part of the phone image, different camera wrist positions therefore
  produce the same virtual endpoint.
- When the requested shoulder-to-wrist distance exceeds the arm extension
  clamp, the adapter currently preserves the shoulder and moves the rendered
  wrist away from its requested target.
- With explicit endpoints, the forearm frame uses a fixed camera-forward normal.
  Palm rotation is therefore concentrated at `handL`, leaving the forearm roll
  visually frozen at the wrist seam.
- Existing tests assert shoulder movement and hidden sleeve vertices, but do
  not assert the rendered wrist position or the arm's viewport-boundary
  intersection.

### Right hand

- The load sequence applies a wrist direction, rotates `handR` by a fixed
  `Math.PI`, and then overwrites the arm-chain direction. The final wrist pose is
  therefore a side effect of conflicting fixed transforms rather than a
  reference-defined palm frame.
- All three right arm segments currently use the same near-vertical direction.
  The hand-to-bottom-boundary line moves only about `0.106` NDC horizontally,
  which does not match the lower-right-to-upper-left reference silhouette.
- The current palm-plane normal has only about `0.09` alignment with camera
  forward, so the dorsum is nearly edge-on instead of facing the player.

## Selected Approach

Retain both existing GLB rigs and their authored finger animation. Correct only
the endpoint solver, arm roll, and right wrist world frame.

Rejected alternatives:

- Relaxing the existing clamps would keep the incorrect palm-center anchor and
  would still move the wrist when the palm rotates.
- Adding a procedural arm would break continuity with the skinned GLB hand and
  sleeve.

## Left-Hand Data Flow

1. Read `pose.landmarks[0]` as the camera wrist anchor. Fall back to
   `pose.center` only for old or synthetic frames that do not contain a valid
   wrist landmark.
2. Map that normalized wrist coordinate to a camera-local wrist target without
   the current lower-image clamp plateau. Keep only narrow safety bounds that
   prevent the model from leaving the usable viewport completely.
3. Derive the forearm-outward screen direction from the average of landmarks
   5, 9, 13, and 17 toward landmark 0. Blend degenerate or implausible samples
   toward a lower-left fallback, then intersect the ray with the left or bottom
   viewport boundary.
4. Place the shoulder-side endpoint beyond that intersection by enough margin
   to keep the sleeve end outside the viewport. The selected endpoint moves
   continuously as the tracked wrist moves and may cross either the left or
   bottom edge.
5. Treat the wrist target as the hard positional constraint. If the requested
   entry is outside the arm's reachable range, move the shoulder-side endpoint
   toward the wrist along the same ray; never pull the rendered wrist back
   toward a fixed shoulder.
6. Use the tracked palm normal as the forearm frame's roll seed. Existing root
   quaternion damping absorbs high-frequency motion, while `handL` still
   reaches the exact tracked palm orientation.

`pose.center` remains available for tracking confidence, gesture semantics, and
legacy fallback. Palm scale and finger transforms remain independent from arm
extension.

## Right-Hand Reference Frame

1. Preserve the authored `grab.R` result for every palm, thumb, and finger
   child bone.
2. Aim the shoulder, upper arm, and forearm toward a diagonal camera-local
   direction near `(-0.50, 0.84, -0.20)`, so the arm enters from the lower right
   and reaches toward the upper left.
3. Replace the fixed `Math.PI` wrist turn with a geometry-derived `handR` world
   frame. Define the longitudinal axis from `handR` toward the finger roots and
   the lateral axis from `palm04R` toward `palm01R`. Target longitudinal is near
   `(-0.30, 0.95, 0)`, target lateral is near `(-0.95, -0.30, 0)`, and their
   cross product aligns with camera forward. This presents the dorsum to the
   player as in the supplied photo.
4. Apply the wrist frame only to `handR`. No `palm*`, `thumb*`, or `f_*` local
   quaternion is rewritten.
5. Build the flashlight socket after the final wrist alignment and retain the
   existing camera-forward flashlight-axis correction.
6. Keep the skinned sleeve continuous and keep its shoulder end outside the
   viewport for the full idle/walk/run bob envelope.

## Bounds And Failure Handling

- Invalid or missing wrist landmarks use the existing finite `pose.center`
  fallback; a fully invalid pose keeps the previous finite transform.
- Degenerate wrist-to-palm screen direction uses a bounded lower-left default.
- All solved vectors and quaternions must be finite and normalized.
- The existing immediate tracked/lost visibility contract is unchanged.
- No new camera, transport, timing, confidence, or gesture thresholds are
  introduced.

## Regression Tests

Tests must be written and observed failing before production changes.

### Left hand

- A rendered wrist follows `landmarks[0]` within `0.02` camera-local units at
  multiple phone-frame positions.
- Holding `landmarks[0]` fixed while changing the palm center does not move the
  rendered wrist.
- The arm's actual left/bottom viewport intersection moves monotonically with
  the tracked wrist and changes by at least `0.15` NDC over representative
  horizontal and vertical camera-wrist movements.
- Short and long reaches keep the sleeve connected and the shoulder-end sleeve
  vertices outside the viewport.
- Changing palm roll produces bounded forearm roll while preserving the target
  palm normal and all authored finger transforms.

### Right hand

- The geometry-derived dorsum normal aligns with camera forward by at least
  `0.88` dot product.
- The wrist-to-bottom-boundary intersection is at least `0.16` NDC to the right
  of the wrist, establishing the lower-right-to-upper-left diagonal.
- Every authored palm, thumb, and finger local quaternion still matches the
  final `grab.R` animation sample; only `handR` and arm-chain bones may change.
- Flashlight aim, finger-to-handle contact, hand scale, sleeve continuity,
  off-screen sleeve entry, bounded bob, and disposal tests continue to pass.

## Verification And Checkpoints

1. Run focused left adapter/renderer tests after each red-green cycle.
2. Run focused right flashlight tests after its red-green cycle.
3. Run the complete hand/controller/protocol regression set and production
   build.
4. Verify local and public HTTP plus a public Socket.IO room create/join flow.
5. Do not restart `cloudflared` unless the existing tunnel is no longer usable.
6. Create one scoped implementation commit and annotated backup tag after all
   verification. Do not stage unrelated village, NPC, environment, or voice
   changes.

Pre-implementation filesystem backup:

`../backups/corridor-617-before-wrist-entry-fix-20260815-211810`

Baseline Git commit: `ce596bcb7f383022aee6fe08e4d0658ea5a3a9eb`.

## Non-Goals

- No change to hand acquisition, disappearance timing, MediaPipe sampling,
  handedness selection, Socket.IO protocol, QR code, public origin, village,
  NPC, voice, or environment systems.
- No replacement model, procedural fake arm, palm resculpting, or finger-range
  change.
- No headless WebGL capture, because prior GPU capture attempts coincided with
  machine shutdowns.
