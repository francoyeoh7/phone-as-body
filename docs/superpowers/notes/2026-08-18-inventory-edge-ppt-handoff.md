# Inventory Edge and Presentation Checkpoint

Updated: 2026-08-18 23:05 Asia/Shanghai

## Completed

- The controller inventory strip uses a 32–56px right-edge hit target.
- A transient `lostpointercapture` event no longer cancels an active swipe.
- Coalesced pointer movement is split into packets at the existing 96px
  protocol limit, preserving the complete displacement.
- Horizontal movement is proportionally expanded from the actual right-edge
  start point when a narrow phone cannot physically provide the desktop bar's
  350px cursor span.
- The desktop cursor still opens at the right edge (`entryEdge: "right"`) and
  clamps at the left edge after a full right-to-left swipe.
- `public/assets/presentation/slide-01.png` through `slide-13.png` match the
  13 numbered PNGs in `D:\素材图片\最终答辩ppt` byte-for-byte by SHA-256.

## Verification

- `npx vitest run tests/inventory-edge-controller.test.js tests/controller-app.test.js tests/desktop-app.test.js`
  passed (154 tests).
- `npm test` passed: 74 files, 850 tests, 1 skipped.
- `npm run build` passed.
- `npm run verify:village` passed with the current optimized environment
  artifact.
- A real Chromium DOM run at `http://127.0.0.1:4177/controller?preview=1`
  (320×800 touch viewport) emitted four bounded movement packets and a commit,
  with no page errors. The temporary development server was stopped afterward.
- The existing production Node and cloudflared processes were left untouched
  (PIDs 27576 and 11196 at verification time).

## Recovery

- Pre-edit Git tag: `backup/before-inventory-edge-ppt-fix-20260818`.
- Pre-edit file backup: `D:\蝴蝶效应\backups\corridor-617-before-inventory-edge-ppt-fix-20260818`.
- The final scoped checkpoint tags point at the commit that contains this
  handoff and the verified implementation.

Final checkpoint: `backup/inventory-edge-ppt-complete-20260818` and
`backup/knock-video-hand-inventory-complete-20260818`

## Remaining physical check

On a real phone, open the current controller URL, grant motion/camera access,
and verify the edge swipe opens the inventory, starts the desktop cursor at the
right edge, reaches the left edge on a full swipe, and commits the hovered item.
