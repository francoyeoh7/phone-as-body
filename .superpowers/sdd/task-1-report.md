# Task 1 Report: Protocol And Session Transients

## Implementation Summary

- Added the `controller:voice-clip` wire event, voice limits, binary clip validation, optional input `crouch`, and exact per-action validation for voice recording and inventory pointer messages.
- Normalized trusted input snapshots with `crouch: false` for legacy packets and reset snapshots.
- Added registry-owned voice sequence and one-second rate state without storing clip bytes. Accepted clips are reduced to a relay envelope.
- Configured Socket.IO's binary ceiling to 384 KiB, relayed normalized input snapshots, and relayed accepted voice clips only to the owning desktop.
- Added `ControllerSocket.sendVoiceClip`, reliable Socket.IO-only clip transport, crouch snapshot state, and lifecycle resets.
- Added desktop-side clip validation plus `voice-clip` events in `PhoneSession`.

## Files Changed

- `src/shared/protocol.js`
- `server/session-registry.js`
- `server/index.js`
- `src/controller/ControllerSocket.js`
- `src/desktop/PhoneSession.js`
- `tests/protocol.test.js`
- `tests/session-registry.test.js`

## RED Evidence

1. `npm test -- tests/protocol.test.js`
   - Failed as expected: 9 failures for missing voice event/validator/actions and permissive crouch handling.
2. `npm test -- tests/session-registry.test.js`
   - Failed as expected: 3 failures for missing normalized crouch and `acceptVoiceClip`.
3. `npm test -- tests/protocol.test.js`
   - Failed as expected: 3 failures for missing `sendVoiceClip`, desktop voice acceptance, and crouch reset.
4. `npm test -- tests/protocol.test.js`
   - Failed as expected: 3 failures proving disconnect, replacement, and session-end did not reset crouch before the lifecycle implementation.

## GREEN Evidence

1. `npm test -- tests/protocol.test.js`
   - Passed: 52 tests.
2. `npm test -- tests/session-registry.test.js`
   - Passed: 8 tests.
3. `npm test -- tests/protocol.test.js tests/session-registry.test.js tests/desktop-app.test.js`
   - Passed: 3 files, 91 tests.

## Full Verification

- `npm test`
  - Passed: 36 files, 446 tests.
- `npm run build`
  - Passed: Vite production build completed.
- `node --check server/index.js`
  - Passed with no output.

## Self-Review

- Input validation remains backward compatible: `crouch` is optional inbound but boolean when present; registry and desktop snapshots always expose a boolean.
- Action allowlists reject arbitrary action keys, including raw/base64 media on the new action types. Inventory deltas are allowed only for bounded `move` phases.
- Voice clips require a supported MIME base type, positive bounded duration and binary byte length, and are never retained in registry room state.
- Voice clip ownership, monotonically increasing sequence, one-second acceptance limit, replacement reset, and disconnect reset are covered by tests.
- The reliable voice path is Socket.IO-only; neither input nor voice clip paths use the lossy hand DataChannel.
- `.release/` was not modified or staged.

## Concerns

- The full suite and Vite build emit existing warnings about Tailwind content configuration, large chunks, and test-time GLTF blob textures. They do not fail verification and are outside this task's scope.
