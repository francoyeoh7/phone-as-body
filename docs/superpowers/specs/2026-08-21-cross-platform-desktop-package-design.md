# Cross-Platform Desktop Package Design

## Goal

Ship Phone as Body as an installable desktop game for Windows and macOS. The desktop application owns the complete Three.js game and all authored assets locally. Opening the application starts a private local game service, creates a temporary HTTPS controller address, and displays the existing pairing QR code. A phone scans the QR code and continues to provide touch, gyroscope, rear-camera hand tracking, and voice input without installing a phone app.

## Product Boundary

- Windows receives an x64 NSIS installer and an unpacked build for smoke testing.
- macOS receives separate arm64 and x64 DMG files built on GitHub macOS runners.
- The game world, GLBs, textures, MediaPipe runtime/model, cinematics, voices, and presentation slides ship inside the desktop application.
- The phone loads only the controller web application and its local hand-tracking runtime through a temporary HTTPS tunnel.
- The desktop does not stream rendered frames. Network traffic is limited to controller assets during phone page load, room signaling, validated input/action packets, hand landmarks, and optional voice/AI requests.
- The current public TryCloudflare game instance remains stopped. A tunnel exists only while an installed application is running.

## Runtime Architecture

Electron embeds Chromium for the desktop game window and Node.js for application orchestration. The current Express, Socket.IO, and Vite production server becomes an importable `createCorridorServer` factory. The CLI entry point continues to support development and existing production commands.

At launch:

1. Electron starts the packaged production server on `127.0.0.1` using an operating-system assigned port.
2. Electron shows a local startup screen while it launches the packaged `cloudflared` binary with `tunnel --url http://127.0.0.1:<port> --no-autoupdate`.
3. The tunnel runner parses the first `https://*.trycloudflare.com` URL from process output.
4. Electron updates the server's controller origin before loading the game URL.
5. The desktop game creates its Socket.IO room, and the existing QR code points to `<temporary-origin>/controller?room=<code>`.
6. On application exit, window close, or startup failure, Electron terminates the tunnel and closes the local HTTP/Socket.IO server.

The Electron renderer has no Node integration and no preload API. It receives the same web application currently served to a browser. Navigation outside the local game origin is denied and opened in the system browser only for explicitly permitted HTTPS links.

## Phone Control Impact

Packaging is neutral-to-positive for the existing inputs:

- Gyroscope behavior is unchanged because `DeviceMotionEvent` and `DeviceOrientationEvent` still run in the phone browser over HTTPS.
- Rear-camera hand tracking is unchanged because MediaPipe inference still runs locally on the phone; camera frames are not sent to Electron, Cloudflare, or GitHub.
- Touch and inventory gestures are unchanged because the controller DOM and protocol remain the same.
- Desktop frame pacing and asset startup improve because the full 3D world is read from local packaged files instead of a public web connection.
- The unavoidable downside is that the phone must load the controller bundle through the tunnel and needs internet access. Temporary tunnel setup can take several seconds or fail on restricted networks.
- Voice transcription and generative NPC dialogue remain optional. Without an API key, packaged NPC voices and the main game continue to work; macOS has no Windows Speech fallback.

## Tunnel Binaries

The repository stores a pinned `cloudflared` version manifest and a downloader script, not the large executables themselves. CI downloads the official Cloudflare release for:

- Windows x64: `cloudflared-windows-amd64.exe`
- macOS Intel: `cloudflared-darwin-amd64.tgz`
- macOS Apple Silicon: `cloudflared-darwin-arm64.tgz`

The downloader verifies SHA-256 values stored in the manifest before placing the executable under `.runtime/cloudflared/<platform>-<arch>/`. `electron-builder` copies only the matching binary into application resources. These generated binaries remain ignored by Git.

## Packaging And Distribution

`electron-builder` packages the application with ASAR enabled. Mutable/native tunnel executables stay outside ASAR under `resources/bin`. The application package includes production dependencies, `dist`, `server`, `src/shared`, Electron main-process modules, notices, and README documentation. Development source, tests, temporary files, Git metadata, and environment secrets are excluded.

GitHub Actions runs a matrix:

- `windows-latest`, x64, NSIS
- `macos-latest`, arm64, DMG
- `macos-13`, x64, DMG

Every run uploads installers as workflow artifacts. A `desktop-v*` tag also publishes the files to a GitHub Release. No `.env.local`, API key, certificate password, or signing credential is committed.

Unsigned local builds are supported for the first release. Windows SmartScreen and macOS Gatekeeper can warn on first launch. Signing and Apple notarization are deliberately a later release step because they require paid/trusted developer credentials; the configuration leaves room for CI secrets without pretending unsigned files are trusted.

## Failure Handling

- Local server failure: show a blocking startup error with a retry command and close cleanly.
- Missing or invalid `cloudflared`: show that the phone connection component is unavailable; never show a stale QR code.
- Tunnel timeout or early exit: show a retry button and the concrete reason; restarting the attempt first terminates any previous child process.
- Temporary tunnel disconnect after pairing: existing Socket.IO reconnect and controller lifecycle behavior applies; if the tunnel process exits, the desktop displays a reconnect-required startup overlay on the next launch.
- App exit: close server sockets and terminate the child process once, even if one cleanup step fails.

## Testing

- Server factory tests prove ephemeral-port listening, mutable controller origin, SPA/static delivery, and clean close.
- Tunnel parser/runner tests prove fragmented output parsing, timeout, early exit, duplicate URL suppression, and cleanup.
- Electron bootstrap tests prove ordered startup, secure browser preferences, correct game URL, and idempotent shutdown using injected adapters.
- Packaging tests inspect builder configuration, platform targets, required application files, ignored secrets, and per-platform tunnel resource mapping.
- Existing full Vitest suite, production Vite build, village asset verification, a Windows unpacked Electron launch, and the current real two-page browser controller sequence remain release gates.

## Git And Release Safety

- Baseline tag: `backup/before-electron-desktop-package-20260821`.
- Implementation commits are split between server extraction, Electron runtime, and distribution configuration.
- Final source and tags are pushed to the private GitHub repository only after tests and local Windows packaging pass.
- The stopped public game is not restarted as part of development or packaging.
