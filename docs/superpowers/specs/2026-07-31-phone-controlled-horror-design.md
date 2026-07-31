# Phone-Controlled Horror Demo Design

## Objective

Build an original five-to-ten-minute first-person horror demo for a desktop browser. A phone joins by scanning a QR code and becomes the only player controller. Phone orientation controls the camera and flashlight, a virtual joystick controls movement, and large touch controls handle interaction, flashlight state, recentering, and pause.

The project reproduces the interaction pattern of a phone-controlled horror experience without copying Netflix characters, story, art, audio, or branding.

## Product Scope

- Desktop: full-screen 3D horror scene named "Corridor 617".
- Phone: install-free HTTPS web controller.
- Session: one desktop and one phone paired through a room identifier and QR code.
- Duration: one complete five-to-ten-minute objective chain.
- Supported play: phone-only input, with keyboard and mouse retained as a development fallback.

## Player Experience

The player wakes in a powerless apartment corridor. They must locate a fuse, restore power at an electrical panel, and reach the elevator. The environment uses failing lights, directional sound, off-screen changes, a phone message, and a short pursuit to create tension without relying on copied or graphic material.

The phone receives a message reading "DON'T TURN AROUND" after the fuse is collected. Turning around reveals a distant silhouette that disappears when the flashlight reaches it. Restoring power triggers the final escape sequence.

## Controls

### Phone

- Floating virtual joystick: forward, backward, left, and right movement.
- Device orientation: camera yaw and pitch.
- Flashlight: follows the camera aim and can be toggled.
- Interact: activates the centered highlighted object.
- Recenter: records the current phone orientation as the new neutral direction.
- Pause: pauses desktop simulation.
- Story events: display messages, play a ringtone, and request vibration where supported.

### Desktop Fallback

- WASD: movement.
- Mouse: camera aim.
- E: interact.
- F: flashlight.
- R: recenter simulated phone input.
- Escape: pause.

## Interaction Model

At calibration, the current phone orientation is captured as the neutral quaternion. Later samples are transformed into relative yaw and pitch. An adaptive smoothing filter suppresses hand tremor at low angular velocity and remains responsive during fast turns. A small dead zone prevents drift around center, pitch is clamped, and recentering is always available.

Joystick movement is relative to the current horizontal camera direction. Input becomes zero immediately when the phone disconnects or a touch is cancelled.

## Architecture

### Desktop Client

- Three.js renders the corridor, apartment rooms, props, lighting, flashlight, particles, and scripted events.
- Rapier handles player and environment collision.
- A finite state machine owns objectives and horror events.
- Raycasting identifies centered interactable objects.
- Web Audio provides ambience, footsteps, electrical sounds, and event cues.

### Phone Controller

- A responsive controller page requests motion permission after an explicit tap.
- Device orientation is normalized across portrait and landscape coordinate systems.
- Touch input implements a floating joystick and large command buttons.
- Connection, calibration, permission, and reconnect states are explicit.

### Session Server

- Node.js and Socket.IO host the clients and relay input.
- Each desktop creates a short room identifier and controller QR code.
- The desktop is authoritative; the phone sends only timestamped input state and actions.
- Reconnection replaces the previous controller for the same session.

## Connectivity

Local HTTP remains available for desktop development. Real phone motion access requires a secure browser context on current mobile browsers, so phone testing uses an HTTPS tunnel to the local server. The QR code points to the tunnel URL and includes the room identifier.

If a secure tunnel is unavailable, the UI explains the limitation and exposes the keyboard/mouse fallback for desktop testing.

## Error Handling

- Unsupported motion sensors: show a clear compatibility message.
- Permission denied: provide a retry action and platform-specific guidance.
- Phone disconnect: stop player movement and show the pairing overlay.
- Stale packets: discard samples older than the latest accepted timestamp.
- Reorientation: pause motion mapping until the coordinate system is normalized again.
- Hidden controller tab: stop movement and require an explicit resume.

## Visual Direction

The scene is a restrained apartment corridor during a storm: dirty painted walls, dark wood doors, exposed electrical panels, scattered maintenance objects, cool emergency light, warm flashlight illumination, and occasional lightning. The interface is utilitarian and quiet. The desktop remains nearly HUD-free; the phone provides controls and private story information.

## Verification

- Unit tests cover quaternion-relative orientation, dead zone, smoothing, joystick normalization, room pairing, and objective state transitions.
- Protocol tests simulate controller connect, input, disconnect, and reconnect.
- Desktop and phone layouts are checked at desktop, iPhone, and Android viewport sizes.
- Playwright screenshots verify nonblank 3D output, stable framing, phone control layout, pairing overlay, and no overlap.
- Canvas pixel checks verify the scene is rendered rather than a blank canvas.
- Manual phone verification confirms permission, calibration, simultaneous joystick and orientation input, recentering, interaction, and reconnect behavior.

## Acceptance Criteria

- A phone can join within 30 seconds by scanning the desktop QR code.
- Orientation and joystick work simultaneously.
- The phone controls movement, view direction, flashlight, interaction, pause, and recentering.
- The complete objective chain can be finished with phone-only controls.
- Disconnecting stops movement and reconnecting resumes the session.
- The demo runs smoothly on the current M4 MacBook Air.
- All story, art, audio, and branding are original.
