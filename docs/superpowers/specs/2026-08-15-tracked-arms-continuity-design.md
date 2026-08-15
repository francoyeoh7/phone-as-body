# Tracked Arms Continuity Design

## Goal

Make the tracked left arm enter naturally through a moving lower-left boundary,
and make the persistent right flashlight arm point downward while remaining a
continuous hand, sleeve, and off-screen arm.

## Left Arm

- Derive the shoulder entry from the tracked wrist center instead of using one
  fixed camera-space point.
- Keep the entry inside a bounded lower-left envelope so the sleeve may cross
  either the left or bottom edge, but its shoulder-end surface never appears.
- Preserve the existing wrist position, bounded reach, palm rotation, finger
  tracking, immediate visibility, and smoothing behavior.

## Right Arm

- Remove the whole-model wrist roll that turns the fingers upward and pulls the
  shoulder into the viewport. The authored grab pose and camera-aligned frame
  remain responsible for the grip, while the flashlight socket continues to aim
  along the camera-forward direction.
- Generate the skinned right sleeve from the intact source arm before removing
  covered skin triangles. Remove upper-arm and forearm skin only after the sleeve
  owns its complete geometry, leaving the hand visible without overlapping skin.
- Use the skinned sleeve cuff at the wrist and keep the complete upper sleeve.
  The shoulder-end sleeve surface must remain outside the bottom-right viewport.

## Verification

- Left-hand tests cover a moving lower-left entry, bounded arm length, and hidden
  shoulder-end sleeve vertices at multiple tracked wrist positions.
- Right-hand tests cover downward finger projection, forward flashlight aim,
  complete sleeve geometry, hidden covered arm skin, wrist continuity, and an
  off-screen shoulder edge.
- Run the full hand-related test suite, production build, local/public HTTP
  checks, and public Socket.IO room creation/join without headless WebGL capture.

## Non-Goals

- No changes to MediaPipe recognition, hand presence timing, room protocol,
  environment content, NPC systems, or the public Cloudflare address.
- No replacement hand skeleton and no procedural fake arm layered over the rig.
