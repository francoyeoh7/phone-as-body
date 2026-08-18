# Knock Video and Tracked-Hand Inventory Design

## Goal

Replace the procedural village knock presentation with the supplied five-second
first-person MP4 while preserving arbitrary player positions, exact pose
restoration, and the existing hand/door ownership rules. Add a tracked-hand
right-edge swipe that opens the existing desktop inventory bar and equips the
item selected by the hand cursor.

## Knock presentation

`KnockDoorDirector` remains the single owner of knock detection, input locking,
saved player pose, blood mark, and cleanup. On a valid knock it captures the
player pose, creates a muted/inline video overlay, and starts a short 0.42s
camera alignment from the captured camera pose to the supplied clip's first
frame. The overlay plays the five-second runtime derivative
`/assets/cinematics/village-knock-grab-v1.mp4`; the source MP4 is retained only
as provenance. Video `ended`, load failure, abort, or hidden-page teardown all
remove the overlay and restore the exact saved pose. The existing procedural
director remains the fallback when video playback is unavailable.

The video layer is a sibling of the scene canvas, above the canvas and below
HUD elements. It never enters `scene-host`, so scene replacement cannot orphan
the media element. Playback is one element per cinematic and is disposed on
every terminal path.

## Tracked-hand inventory

The controller's existing touch edge swipe remains available as a fallback.
On the desktop, `HandTrackingDirector` feeds a small state machine from the
same tracked sample used for rendering: a hand entering the right normalized
edge (`x >= 0.82`) and moving left at least `0.18` within 900ms opens the
inventory. While open, normalized hand movement maps to the existing bounded
inventory cursor. A 280ms stationary dwell over an enabled slot commits the
selection; loss, a rightward escape, or a cinematic cancels it. Committing
updates `InventoryState`, closes the bar, and immediately presents the selected
held item through the existing left-hand socket without changing finger pose
or camera control.

## Resource limits

The runtime clip is 1920x1080 H.264/AAC with fast-start metadata. No frame
decoding, canvas recording, or extra camera stream is created. Tests use a
mock media element and synthetic hand samples; visual verification uses one
headless page at a time and a fixed timeout.

## Verification

- Knock tests cover arbitrary starting pose, alignment phase, video lifecycle,
  fallback, abort, and exact restoration.
- Hand tests cover edge swipe activation, cursor movement, dwell commit,
  cancellation, and cinematic suppression.
- Focused tests, production build, one desktop screenshot, public `/` and
  `/api/config` health, and unchanged tunnel/Node PIDs are required.
