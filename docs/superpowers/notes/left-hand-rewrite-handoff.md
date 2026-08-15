# Left-Hand Rewrite Recovery Handoff

Updated: 2026-08-15 17:05 Asia/Shanghai

## Current Runtime

- Local game: `http://127.0.0.1:4176/`
- Public game/controller origin: `https://psp-homepage-advisor-wisdom.trycloudflare.com`
- Production Node PID: `8220`
- Cloudflared PID: `12460`
- Public `/`, `/controller`, and `/api/config`: HTTP 200
- Public Socket.IO: connected over WebSocket
- `.env.local` contains the current public origin and must never be committed.

The public origin is a Cloudflare quick-tunnel URL. It cannot survive a process
or computer restart. After a restart, create a new tunnel, update only
`PUBLIC_CONTROLLER_ORIGIN`, and restart Node without restarting the new tunnel.

## Implemented Contract

- The verified rear-camera convention uses `inputMirrored: true` and acquires a
  physical left hand on the first valid MediaPipe result.
- A tracked spatial candidate survives transient handedness-label flips.
- A physical right hand cannot acquire the tracker from idle.
- The first explicit no-hand result emits `lost`; desktop rendering becomes
  invisible in that same update with no hold, freeze, or fade.
- Structurally valid low-confidence frames keep the visual hand continuously
  visible. Confidence `0.62` still gates semantic task and equipment input.
- The canonical rear-camera physical-left basis renders the model's dorsum.
- The left shoulder enters from the lower-left. Camera wrist motion changes the
  upper-arm/forearm chain length while palm and finger dimensions remain fixed.
- Hand frames remain on reliable Socket.IO transport.

## Verification Evidence

- Rewrite-focused suite: 316 passed; only the two pre-existing authored-finger
  assertions failed. Every tracker, stream, director, basis, adapter, protocol,
  controller, desktop, and new arm-length assertion passed.
- Full suite: 783 passed, 6 pre-existing failures, 1 skipped (790 total).
  The six baseline failures are one environment artifact checksum assertion,
  three right-hand flashlight asset assertions, and two authored left-finger
  animation assertions.
- `npm run build`: passed, 1709 modules transformed.
- Final staged checkpoint was also verified in an isolated worktree: core
  rewrite tests `90/90`, real-model rewrite paths `9/9`, and production build
  passed with 1692 modules from the scoped commit snapshot.
- Successful real-model browser report:
  `.visual-check/latest/left-hand-rewrite-report.json`
- Desktop arm length: `0.5128809` short to `1.0408465` long.
- Palm width: `0.05326613` in both poses.
- Dorsum/palm achieved-normal dot: `-0.9353346`.
- Lifecycle sequence: 120/120 low-confidence frames accepted and continuously
  visible; first lost frame accepted and rendered opacity became zero.
- Desktop and mobile landscape screenshots are under `.visual-check/latest/`.
- Two later full WebGL reruns were interrupted by automatic computer shutdowns.
  Do not repeat the SwiftShader full-scene verifier until the shutdown cause is
  understood. The successful report covers the same rendering code; the only
  later production change separates visual freshness from semantic freshness.

## Recovery Checkpoints

- Design commit: `f481952 docs: define left-hand tracking rewrite`
- Design tag: `backup/left-hand-rewrite-design-20260815`
- Pre-rewrite filesystem backup:
  `D:\蝴蝶效应\backups\corridor-617-before-left-hand-rewrite-20260815-155955`
- Backup manifest:
  `D:\蝴蝶效应\backups\corridor-617-before-left-hand-rewrite-20260815-155955\SHA256SUMS.csv`
- Final implementation tag: `backup/left-hand-rewrite-complete-20260815`
  (points to the commit containing this handoff).

## Codex Crash Cause And Prevention

The failed conversation first hit HTTP 429. Its saved compaction item
`cmp_019fffaa-399c-7790-b736-8e6104945573` was then replayed with invalid or
missing opaque `encrypted_content`. Later turns failed before any project tool
ran with `thinking_signature_invalid` and
`Missing required parameter: input[4].content[1].encrypted_content`.
This was Codex/client or gateway history replay corruption, not a game error.

Codex internal/service code is outside this repository and cannot be patched
from this project. Use this recovery procedure instead:

1. At meaningful milestones, update this handoff and create one scoped Git tag
   plus a filesystem backup. Do not commit on every small edit.
2. If `thinking_signature_invalid`, missing `encrypted_content`, or repeated
   stream-retry errors appear, stop pressing Continue in that conversation.
3. Start a new conversation and point it to this file, the latest Git tag, and
   the backup path. Do not manually edit or reconstruct encrypted compaction
   items in the JSONL session file.
4. Keep the Codex client updated. If the deployment permits it, avoid a gateway
   that rewrites Responses API history items; opaque compaction payloads must be
   stored and replayed unchanged.

Official compaction contract:
`https://developers.openai.com/api/docs/guides/compaction`

## Remaining Real-Phone Check

Open the current public controller URL on the phone, grant rear-camera access,
and verify three physical observations: the dorsum is shown as dorsum, the hand
stays present for a continuous 20-second in-frame hold and disappears on the
first out-of-frame result, and moving the wrist from lower-left toward the
center/upper area changes arm reach without changing palm size.
