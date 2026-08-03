# Washbasin Interaction and Public Preview Design

**Date:** 2026-08-03
**Project:** Corridor 617

## Goal

Add a visibly recognizable washbasin interaction to the corridor and expose the running game through a temporary HTTPS URL so other people can scan the QR code from their phones.

## Scope

The washbasin is a reusable test interaction, separate from the existing fuse, panel, elevator, and shadow sequence. It has two stable states:

- `off`: dry basin and faucet, no water stream, no running-water audio.
- `on`: water stream and droplets are visible, a small water surface ripple is animated, and the running-water cue is active.

Every accepted `interact` toggles the state. It must remain interactable after either transition so the tester can repeat the cycle indefinitely.

The public preview uses a temporary HTTPS tunnel. The QR payload must use the tunnel origin, never `localhost`; the URL is intentionally ephemeral and ends when the tunnel process stops.

## Architecture

`create-scene.js` creates a `washbasin` object group and registers one interactable target with the existing `PlayerController` list. The group owns its visible state and exposes `setRunning(boolean)` and `toggle()` so gameplay logic does not manipulate individual meshes. `HorrorDirector` handles the `washbasin` id before the story objective state and delegates the toggle to the scene object.

The washbasin is placed on the right-hand wall in the first corridor section, near the starting area but outside the spawn capsule. Its geometry uses low-to-medium polygon primitives already used by the scene: a rounded ceramic bowl, tiled/metal counter, cylindrical faucet neck and spout, drain, supply pipes, a transparent water column, and a small set of animated droplet meshes. No external asset download is required, keeping the preview package small.

The temporary public preview runs the existing Node server on port `4174` and starts Cloudflare Quick Tunnel with `cloudflared tunnel --url http://localhost:4174`. The resulting `https://<random>.trycloudflare.com` origin is passed to the desktop QR URL via `PUBLIC_CONTROLLER_ORIGIN`, and the same origin serves `/controller` so camera permission is available in a secure context.

## Interaction Flow

1. Desktop creates a room and displays a QR code containing the public HTTPS controller URL.
2. Phone scans and joins the room.
3. Desktop crosshair selects `washbasin`; the existing target-focus event arms local phone camera frame analysis.
4. A short tap or qualified camera-frame change sends the existing `interact` action.
5. `HorrorDirector.handleInteraction("washbasin")` calls `washbasin.toggle()` and updates the running-water cue.
6. The target remains enabled, allowing the same flow to turn water off and on repeatedly.

## Error Handling and Lifecycle

- Camera permission denial does not prevent short-tap interaction.
- The washbasin defaults to `off` and remains valid if audio is unavailable.
- Scene disposal stops animation references through the existing scene disposal traversal.
- The tunnel is a development preview only; its random hostname and process lifetime are reported to the user.

## Testing

- Unit-test a pure washbasin state machine for initial `off`, `toggle()` transitions, idempotent `setRunning()`, and repeated cycles.
- Unit-test `HorrorDirector` routing to the washbasin without altering the existing story objective.
- Run the full Vitest suite and production build.
- Smoke-test the local server and public tunnel URL, including `/` and `/controller` responses.
