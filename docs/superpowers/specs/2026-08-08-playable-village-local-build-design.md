# Playable Village Local Build Design

## Outcome

Corridor 617 ships as a local Windows application that opens the real ElderBoom Hollow village quickly and keeps the existing full phone-control path: HTTPS pairing, device orientation, rear-camera hand interaction, voice, crouch, flashlight, and inventory. The current village contains only the imported village environment, the system hand/flashlight presentation, pickup props, and the washbasin.

The first milestone is a game that opens normally. Home Screen installation and the right-edge inventory gesture are explicitly deferred to the next milestone.

## Current Failure

The selected village GLB is 489,871,748 bytes and embeds 240 source PNG images. Those images represent 680,787,969 texels, which expands to roughly 2.54 GiB as RGBA8 before mipmaps and roughly 3.39 GiB with mipmaps. A browser must also hold the downloaded GLB and decoded image data during startup. This is why a valid asset can still remain on the loading screen or exhaust a mobile/browser process.

The startup retry work also currently classifies every local chunk error as "asset not prepared", and the current desktop bootstrap always creates `HorrorDirector`. The latter advances a picked-up fuse toward a distribution-panel objective even though the current village intentionally does not instantiate the panel or the corridor story set.

## Runtime Asset

The source file remains untouched at `D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb`. The deterministic spatial and foliage subset remains the geometry source of truth. A second deterministic pass optimizes only embedded images:

- base-color and emissive textures: fit within 1024 x 1024;
- normal, metallic/roughness, occlusion, specular, sheen, and anisotropy textures: fit within 512 x 512;
- encode retained images as WebP using Sharp;
- preserve meshes, accessors, node transforms, materials, samplers, GPU instancing, and required material extensions;
- keep the final GLB at or below 128 MiB;
- keep final decoded texels at or below 120,000,000;
- keep draw calls below 450 and expanded triangles below 9,000,000.

The build writes to a temporary path and replaces the runtime GLB atomically only after validation. The manifest receives the final byte count and SHA-256. Generated GLBs and reports remain ignored and local-only.

## Village Gameplay Boundary

`VillageDirector` owns the current village interaction state. It accepts the stable `fuse`, `found-phone`, and `washbasin` interactions. Picking up the fuse adds it to inventory and returns to a neutral "explore the village" objective; it never references a panel. The washbasin remains repeatable. The found phone continues using its existing focused interaction director.

`HorrorDirector`, `ShadowQuestDirector`, `DoorDefenseDirector`, the panel, observation vignette, silhouette, exit door, and procedural corridor remain available in source for a future story mode. They are not constructed or wired by the current ElderBoom scene.

## Startup And Failure Ownership

One startup generation owns one `AbortController`, scene, hand loader, and renderer. Retry and destroy abort the generation. Any late scene or hand-model completion disposes itself instead of attaching to the live scene.

Environment errors retain request phase, HTTP status, URL, and chunk ID. A 404 for the expected local chunk is "asset not prepared". Transport failures, non-404 HTTP responses, hash/length failures, and parse failures use distinct retry messages. Aborts do not show a failure surface.

## Windows Application

The distributable is an Electron portable Windows application, not a browser tab. It contains the production Vite build, optimized village GLB, Node server dependencies, and `cloudflared.exe`. At launch it:

1. starts the production server on an available loopback port;
2. starts a Cloudflare Quick Tunnel to that port and waits for the HTTPS origin;
3. exposes that origin through `/api/config`;
4. opens the desktop game in a native application window without browser toolbars;
5. displays the normal in-game QR code for the phone controller.

The desktop always loads the village from loopback, so the large village asset never crosses the tunnel. The phone downloads only the controller application. If the tunnel cannot start, the pairing gate presents a retryable secure-connection error; the application does not silently switch to a reduced touch-only mode.

The package is generated locally and is not published, uploaded, or attached to a release until Fab entitlement evidence and explicit distribution authorization exist.

## Acceptance

- Double-clicking the portable executable opens a native Corridor 617 window.
- A cold local desktop start reaches an interactive rendered village within 30 seconds on this machine.
- The runtime GLB is no more than 128 MiB and no more than 120,000,000 decoded texels.
- The rendered environment is the real ElderBoom subset and not procedural replacement geometry.
- Only pickup props and the washbasin are present in the current village interaction set.
- Picking up the fuse never requests a panel or corridor objective.
- The QR uses a live HTTPS URL and the phone remains gated on orientation and rear-camera permissions.
- Retry/destroy leaves no late renderer, Rapier world, hand model, or tunnel process attached.
- Automated tests, asset verification, production build, packaged launch, network requests, canvas pixels, and process cleanup all have recorded evidence.

## Deferred Milestone

After the game satisfies the acceptance criteria above, a separate controller milestone will add iOS Home Screen metadata/service-worker behavior and replace the inventory orb with a right-edge leftward drag gesture. Those changes must not block the playable local build.
