# Cross-Platform Village Desktop Design

## Goal

Ship Corridor 617 as a downloadable desktop game for Windows x64 and Apple Silicon macOS while preserving the existing phone gyroscope, virtual joystick, flashlight, rear-camera left-hand tracking, interaction state machines, and task progression. Replace the corridor presentation with a high-fidelity night-time subset of the supplied ElderBoom Hollow GLB and keep the project extensible for later scenes and tasks.

## Confirmed Platforms

- Windows 10/11 x64: portable ZIP containing `Corridor 617.exe`.
- macOS Apple Silicon only: arm64 DMG or ZIP containing `Corridor 617.app`.
- Intel macOS and universal binaries are out of scope.
- Both packages use the same gameplay code, environment manifest, and processed scene chunks.

## Desktop Runtime

Electron provides a native desktop window without browser chrome. The main process owns the local Express/Socket.IO service, process lifecycle, platform paths, logs, and the HTTPS tunnel sidecar. The renderer remains sandboxed with `contextIsolation: true`, `nodeIntegration: false`, and no arbitrary remote navigation.

The existing desktop game runs inside the packaged renderer with no material changes to its phone input protocol. Starting the app creates a session, starts the local service, establishes a temporary HTTPS tunnel, and displays the phone QR code. The phone continues to run the controller page over HTTPS so iOS and Android can grant motion and rear-camera access.

Production play still requires phone motion permission. Camera hand tracking remains an independent optional input: denial, unsupported hardware, or tracking loss hides the virtual hand without corrupting gyro, joystick, flashlight, or touch state.

## HTTPS And Pairing

Each platform package includes one pinned `cloudflared` sidecar for its own architecture. The Electron main process starts a Quick Tunnel against the embedded local server, parses the generated HTTPS origin, and supplies that origin to the existing QR/session flow. Raw camera video never leaves the phone; only derived hand landmarks and interaction state travel through the session.

Tunnel startup has an explicit timeout, retry control, and diagnostic log. A failed tunnel does not leave orphaned processes. Development keyboard controls remain available for diagnostics, but the production experience does not present them as a substitute for mandatory phone motion control.

## ElderBoom Asset Pipeline

The supplied source is `D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb`, a 936,886,692-byte Unreal 5.5.4 export containing one scene, 48,425 nodes, 562 meshes, 909 materials, 1,482 textures, and 1,477 embedded images. The full file is never served or bundled directly.

A deterministic build tool extracts a spatial subset containing:

- one primary complete house and its yard;
- one nearby secondary house or outbuilding;
- connecting ground, paths, fences, vegetation, props, and sight-line blockers;
- enough surrounding terrain and distant silhouettes to avoid an isolated-stage appearance;
- at least two 90-degree turns and a partial loop around the buildings.

The extractor preserves selected source mesh data, texture dimensions, UVs, and PBR material assignments. It removes unused nodes, meshes, materials, and embedded images, then emits versioned GLB chunks plus a manifest. No substitute geometry or procedural village is presented as ElderBoom Hollow.

The licensed 937 MB source remains outside Git. Distribution packages contain only the processed, in-game subset. The target packaged size is approximately 300-600 MB per platform; final size is measured rather than guaranteed before extraction.

## Environment Manifest

`public/assets/environment/elderboom-v1/manifest.json` is the stable boundary between art and gameplay. It declares:

- versioned chunk URLs and root transforms;
- spawn position and orientation;
- Rapier collision proxy boxes/capsules;
- playable bounds and occluder groups;
- night lighting, fog, moon fill, and local emissive-light roles;
- task anchors for washbasin, found phone, observation window, pickup item, fuse panel, and final door;
- interaction contact points, normals, approach directions, and maximum distances;
- cinematic anchors expressed in local task coordinates.

Adding future buildings or tasks means producing another manifest version and chunks rather than rewriting the desktop shell.

## Night Conversion

The imported daylight and sky lights are disabled. A dark sky, cool moon fill, restrained fog, and sparse practical lights establish exterior depth while the existing warm flashlight remains the dominant near-field light. Original albedo, normal, roughness, metallic, and AO inputs remain intact; materials are not darkened to fake night.

Only nearby interaction geometry casts dynamic flashlight shadows. Distant foliage and background geometry use conservative shadow settings to fit the GTX 1060 5 GB target without lowering the retained source texture dimensions.

## Task Placement

Existing task IDs and state-machine contracts remain unchanged. Their transforms move from hard-coded corridor coordinates into the environment manifest:

1. Washbasin beside a sheltered utility wall near the primary house.
2. Found phone on a porch or side path and still held only while the physical grasp persists.
3. Observation window on the primary house with its local vignette behind the glass.
4. Pickup item in a yard or outbuilding corner.
5. Fuse panel on another building face, requiring a turn and short traversal.
6. Door-defense event at the primary entrance after circling the playable area.

Aim assist, target epochs, contact normals, occlusion, hand-grasp authorization, phone drop delay, and sustained door-brace progress continue to use the current shared systems.

## Packaging And Opening

Windows handoff:

1. Extract `Corridor617-Windows-x64.zip`.
2. Double-click `Corridor 617.exe`.
3. Scan the displayed QR code and grant phone motion permission.

macOS handoff:

1. Open `Corridor617-macOS-arm64.dmg` and drag the app to Applications.
2. Open `Corridor 617.app` and scan the displayed QR code.
3. Until an Apple Developer ID is supplied for notarization, the first launch may require Control-click, `Open`, then confirming the Gatekeeper dialog once.

Windows signing and macOS notarization are release credentials, not gameplay dependencies. The build matrix can run locally on the matching OS or through a macOS/Windows CI runner after explicit authorization to upload.

## Failure Handling

- Missing or invalid environment manifest: show a retryable asset error before gameplay begins.
- Missing chunk or decode failure: dispose partial resources and identify the failing chunk.
- Tunnel failure: retry without duplicating the local server or leaving a sidecar process.
- Phone disconnect: freeze movement and return to pairing without losing task state.
- Camera denial or tracking failure: preserve motion/touch controls and fade the hand.
- Low hand confidence: retain the last stable pose briefly and pause sustained progress.
- App shutdown: close Socket.IO, HTTP, renderer resources, Rapier world, and `cloudflared` in order.

## Verification

Automated tests cover manifest validation, asset selection determinism, orphan-resource pruning, task-anchor completeness, collision bounds, platform path resolution, sidecar lifecycle, QR origin propagation, graceful camera failure, and retained input contracts.

Release checks include:

- full Vitest suite and production renderer build;
- Windows x64 package creation and launch smoke test;
- macOS arm64 package creation on a Mac/CI runner and launch smoke test;
- screenshot checks for both houses with flashlight off/on;
- paired phone checks for gyro, joystick, flashlight, sink, phone hold/release, window, pickup/panel, and sustained door defense;
- package size, first-load time, draw calls, triangles, and peak GPU memory on the GTX 1060 5 GB target.

## Explicit Exclusions

- No Intel macOS build.
- No full 937 MB source GLB in Git or the runtime.
- No replacement village made from primitive geometry.
- No rewrite to Unreal Engine or Unity in this phase.
- No GitHub push, Release, or CI upload without explicit user authorization.
