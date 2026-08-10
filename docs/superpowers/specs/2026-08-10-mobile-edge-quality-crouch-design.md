# Mobile Edge Inventory, Persistent Crouch, and Village Quality Design

## Scope

This change keeps the existing complete controller experience and village story boundary. It restores the Fab village runtime to the original quality budget, removes the visible inventory orb, and makes the phone controls legible without adding old corridor content.

## Village Asset Quality

- Restore the source selection and foliage density used by the original ElderBoom build (`maxInstancesPerMeshPerCell: 8`).
- Restore slot-aware texture limits to 1024px for color/emissive textures and 512px for normal/data textures.
- Keep the actual black-screen fixes: optional debug story lookup, daytime atmosphere, stronger scene lights, and asynchronous first-frame preparation.
- Regenerate and verify the local runtime artifact from the pinned Fab source. Do not modify or stage the existing `.release/` directory.

## Mobile Surface

After gameplay begins, the top edge contains only the settings icon. Room code, connection label, Wi-Fi status, status dot, and diagnostic plot are removed from the visible controller surface. Internal diagnostics remain available to code and tests.

The voice control stays as the bottom interaction region. A pointer-down immediately enters a visible `pressed` state and emits a short haptic pulse. Successful MediaRecorder start changes it to `recording`; release returns it to idle; permission failure briefly shows an error state and then returns to idle. Press feedback is local UI state and is not sent as a fake recording event.

## Right-Edge Inventory Gesture

The inventory has no floating orb or visible button. A transparent 24px activation strip is attached to the right viewport edge, below the settings hit target. A pointer that starts there is claimed as an inventory candidate, preventing joystick ownership. It opens only after a leftward displacement of at least 44px within 260ms, with horizontal movement at least 1.25 times the absolute vertical movement. Failed candidates cancel without opening.

On open, the controller sends `inventory-pointer` phase `open` with an optional normalized `entryY` so the desktop cursor can enter from the right edge at the same vertical location. Subsequent moves remain bounded and coalesced at 30Hz. Release commits the hovered item; cancellation closes without equipping.

The desktop inventory cursor starts at the right boundary of the bar, not over the equipped or first slot. Its vertical position is derived from `entryY`, then relative deltas move it into acquired slots.

## Persistent Crouch Gesture

Crouch is a substate of a gameplay joystick pointer and is never recognized from the voice region or the inventory edge.

- Entry: while standing, complete a downward flick within 240ms, with `dy >= 64px`, `abs(dx) <= 0.55 * dy`, and the pointer entering the bottom movement region (`clamp(68px, 12dvh, 96px)`). The gesture immediately sends neutral movement and `crouch: true`.
- Persistence: the crouch state belongs to the controller, not to the pointer lifetime. Releasing the entry gesture does not stand the player. A new joystick pointer can move normally, and gyroscope view remains independent.
- Exit: while crouched, release a fast upward flick completed within 220ms, with `-dy >= 72px`, `abs(dx) <= 0.55 * -dy`. It does not need to reach the top edge. The controller sends neutral movement and `crouch: false`.
- Distinction: a normal forward/backward input is a held drag or a slower displacement, so it remains locomotion. A downward drag that does not reach the bottom region remains backward movement.
- Lifecycle: pause, disconnect, reorientation, page hide, cancel, or destroy clears crouch exactly once. Door-defense fallback disables both posture gestures.

## Wire Compatibility

`inventory-pointer` accepts `entryY` only on `open`, as a finite normalized number from 0 to 1. Existing open packets without it remain valid. Crouch continues to use the existing sequenced input boolean and remains false for older or stale snapshots.

## Acceptance Checks

- No inventory orb is visible or present in the phone header.
- A right-edge left swipe opens the desktop bar and the cursor visibly enters from the right.
- A normal forward hold never stands a crouched player; a short upward flick does.
- A crouched player can begin a fresh walk, turn, use voice, and interact.
- Pressing voice visibly changes the phone UI before microphone permission or the 420ms recording dwell resolves.
- The regenerated village report returns the original high-quality texture and foliage metrics and remains within the runtime geometry budget.
