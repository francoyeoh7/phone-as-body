# Right-Edge Inventory Touch Design

## Goal

Make a one-finger right-to-left swipe reliably open the desktop inventory from a phone while preserving the existing inventory cursor mapping. Normal gameplay and active hand tracking may start the inventory gesture. PPT and cinematic states remain blocked.

## Interaction

- The controller exposes a touch entry lane inside the right side of the viewport, wide enough to start without relying on the operating system's outermost back-swipe zone.
- The play surface captures eligible right-edge pointer events before the joystick handler. This supports starts that land on the surface rather than the narrow visual lane and prevents gameplay ownership from competing with the inventory pointer.
- A qualifying gesture is horizontal, leftward, and at least 44 CSS pixels. It is not rejected solely because the user moves slowly.
- Once opened, the complete phone travel maps to the desktop inventory cursor's usable horizontal span. Pointer release commits; cancel closes without changing equipment.
- Opening inventory clears controller movement, view clutch, voice capture, and desktop hand tracking is paused until inventory closes.

## State Boundaries

- Controller-side `canOpenInventory` continues to reject disconnected, paused, backgrounded, destroyed, presentation, and active found-phone states, but no longer rejects an active hand-task context.
- Desktop-side `canOpenInventory` continues to reject startup, fallback, paused, destroyed, already-open, presentation, door/knock/found-phone/shadow cinematic states, but no longer rejects `handTracking.owner`.
- Desktop hand tracking is paused while the inventory modal is open and resumed after it closes.

## Verification

- Unit tests cover slow qualifying swipes, the expanded edge geometry, capture routing, and hand-task inventory eligibility.
- Focused controller/desktop/inventory suites run before the full test suite.
- A production build updates `dist` without restarting the running Node or Cloudflare processes; the existing public URL remains unchanged.
