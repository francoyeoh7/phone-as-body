# Mobile Edge Inventory, Persistent Crouch, and Village Quality Plan

## Goal

Restore the high-quality ElderBoom village runtime and finish the complete phone controller with edge inventory, immediate voice feedback, a settings-only top edge, and persistent crouch/stand flicks.

## Constraints

- Preserve the render-loop fix and all existing motion/camera/hand-task behavior.
- Do not reintroduce the old corridor story into the village scene.
- Do not touch or stage `.release/`.
- Use the existing Socket.IO action and sequenced input contracts unless a narrow validated field is required.

## Tasks

### 1. Controller gesture contracts and tests

- Add failing `InventoryEdgeController` tests for right-edge qualification, left threshold, timeout, cancellation, bounded/coalesced movement, and open metadata.
- Add failing `VoiceHoldController` tests for immediate pressed state, recording state transition, error cleanup, and no false `voice-recording` packet before recorder start.
- Add failing `VirtualJoystick` tests for persistent crouch entry, fresh-pointer locomotion while crouched, fast upward stand, ordinary forward/backward separation, and lifecycle cleanup.
- Add failing protocol/UI tests for `entryY`, right-edge cursor entry, and the absence of visible top status markup.

### 2. Mobile controller implementation

- Replace the orb element with an invisible right-edge gesture surface and rename the module to `InventoryEdgeController`.
- Claim the inventory owner at pointer down, activate only after the horizontal threshold, and send `open` with normalized entry Y. Keep pointer capture and 30Hz bounded deltas after activation.
- Add voice `pressed`, `recording`, and `error` presentation states independent of recorder activity. Trigger haptics on accepted pointer down.
- Remove visible header/status/diagnostic controls except settings and update lifecycle cleanup to cancel the edge controller.
- Make crouch state external to the joystick pointer. Detect entry and exit flicks with the approved thresholds, neutralize only at posture transitions, and leave new joystick pointers fully usable while crouched.

### 3. Desktop inventory and posture behavior

- Extend the validated `inventory-pointer` open payload with optional normalized `entryY`.
- Start the desktop inventory cursor at the right edge and entry Y, leaving the equipped item unselected until the cursor reaches it.
- Preserve the existing inventory truth and commit/cancel behavior.
- Keep desktop crouch input, speed/eye presentation, and reset paths compatible with the persistent controller boolean.

### 4. Restore and regenerate the village asset

- Restore ElderBoom foliage cap to 8 instances per mesh per cell and remove the emergency global/high-poly caps.
- Restore texture optimizer defaults to 1024/512.
- Run `npm run assets:village` and `npm run verify:village`; confirm the manifest/report/artifact identity and high-quality metrics.

### 5. Verification and handoff

- Run focused controller, desktop, protocol, and asset tests, then the complete `npm test` suite.
- Run `npm run build` and launch the local demo. Check the controller at mobile and desktop viewport sizes, including right-edge inventory and voice press feedback.
- Report the exact local URL and generated high-quality asset metrics. Leave `.release/` unchanged.
