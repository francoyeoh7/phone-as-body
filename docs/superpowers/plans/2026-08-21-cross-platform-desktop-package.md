# Cross-Platform Desktop Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce installable Windows and macOS editions that run the complete game locally and expose the existing phone controller through an application-owned temporary HTTPS tunnel.

**Architecture:** Extract the current HTTP/Socket.IO process into an injectable server factory, then orchestrate it from a small Electron main process and a tested Cloudflare tunnel runner. Package pinned per-platform tunnel binaries with electron-builder and create Windows/macOS artifacts through GitHub Actions.

**Tech Stack:** Electron 43, electron-builder 26, Express 5, Socket.IO 4, Vite 6, Vitest 3, cloudflared 2026.8.2, GitHub Actions.

## Global Constraints

- Keep the current public game and previous Cloudflare processes stopped.
- Do not change controller protocol, MediaPipe tracking, gyroscope logic, Three.js game behavior, or authored assets.
- Never commit `.env.local`, API keys, signing credentials, downloaded tunnel binaries, or generated installers.
- Package the game and all large authored assets locally; network only serves the phone controller and control/session traffic.
- Preserve CLI development and production startup in addition to Electron startup.

---

### Task 1: Extract An Embeddable Game Server

**Files:**
- Create: `server/create-corridor-server.js`
- Modify: `server/index.js`
- Create: `tests/corridor-server.test.js`

**Interfaces:**
- Produces `createCorridorServer({ root, mode, controllerOrigin, host })`.
- Returned runtime exposes `listen(port = 0)`, `close()`, `setControllerOrigin(origin)`, `getControllerOrigin()`, and `address()`.

- [ ] Write a test that starts the factory on port `0`, checks `/api/config`, mutates the controller origin, retrieves the production shell, and closes without leaving a listener.
- [ ] Run `npx vitest run tests/corridor-server.test.js` and confirm it fails because the module does not exist.
- [ ] Move the current Express/Socket.IO setup into the factory without changing event validation or routes; make `server/index.js` a thin CLI entry point.
- [ ] Re-run the focused server/session/SPA tests and the full suite.
- [ ] Commit `refactor: make the game server embeddable`.

### Task 2: Add The Tunnel Runner

**Files:**
- Create: `electron/TunnelRunner.js`
- Create: `tests/tunnel-runner.test.js`

**Interfaces:**
- Produces `extractTryCloudflareUrl(text)` and `TunnelRunner.start({ executable, localUrl, timeoutMs })`.
- `TunnelRunner.stop()` is idempotent and terminates only its owned process.

- [ ] Write failing tests for fragmented stderr/stdout URL output, timeout, early exit, duplicate URL output, and stop cleanup.
- [ ] Run `npx vitest run tests/tunnel-runner.test.js` and verify the expected missing-module failure.
- [ ] Implement the parser and injected-spawn lifecycle with one launch promise and deterministic cleanup.
- [ ] Re-run the focused tests and commit `feat: manage packaged phone control tunnels`.

### Task 3: Add The Electron Desktop Runtime

**Files:**
- Create: `electron/main.js`
- Create: `electron/AppRuntime.js`
- Create: `electron/startup.html`
- Create: `tests/electron-app-runtime.test.js`
- Modify: `package.json`

**Interfaces:**
- `AppRuntime.start()` starts server, starts tunnel, sets controller origin, and then loads the local game URL.
- `AppRuntime.stop()` shuts down tunnel and server exactly once.

- [ ] Write failing tests for ordered startup, secure `BrowserWindow` preferences, retry after tunnel failure, and idempotent shutdown.
- [ ] Run the new focused test and verify failure because the runtime does not exist.
- [ ] Implement `AppRuntime` with injected Electron adapters; keep `main.js` limited to app lifecycle wiring.
- [ ] Add `desktop:dev`, `desktop:pack`, and `desktop:dist` scripts and pinned Electron dependencies.
- [ ] Run focused tests and a development Electron smoke launch, then commit `feat: run Phone as Body as a desktop app`.

### Task 4: Pin Platform Tunnel Resources And Configure Packaging

**Files:**
- Create: `scripts/fetch-cloudflared.mjs`
- Create: `packaging/cloudflared.json`
- Create: `electron-builder.yml`
- Create: `tests/desktop-packaging.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- `npm run desktop:fetch-tunnel -- --platform=<win32|darwin> --arch=<x64|arm64>` creates one verified executable under `.runtime/cloudflared/<platform>-<arch>/`.
- Builder reads the same output path and places it at `resources/bin/cloudflared[.exe]`.

- [ ] Write failing configuration tests for product identity, NSIS/DMG targets, required files, ASAR resource placement, and ignored build output/secrets.
- [ ] Run the test and verify failure because configuration files are absent.
- [ ] Add a pinned 2026.8.2 manifest with official URLs/SHA-256 values and implement streamed download, tgz extraction, executable mode, and checksum validation.
- [ ] Configure electron-builder for Windows x64 and macOS x64/arm64.
- [ ] Fetch the Windows binary, run the packaging test, and build a Windows unpacked app plus NSIS installer.
- [ ] Commit `build: package Windows and macOS desktop editions`.

### Task 5: Automate GitHub Builds And Document Distribution

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Modify: `README.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `tests/desktop-release-workflow.test.js`

**Interfaces:**
- Workflow artifacts expose Windows x64, macOS arm64, and macOS x64 installers.
- Tags matching `desktop-v*` create GitHub Release assets through the repository token.

- [ ] Write a failing workflow test that parses YAML text and asserts three platform jobs, tunnel fetch, Vite build, Electron packaging, artifact upload, and tag publishing.
- [ ] Add the workflow with pinned Node setup and platform-specific commands.
- [ ] Document install/use flow, internet boundary, unsigned warning, local game assets, phone privacy, and build commands.
- [ ] Run the workflow/config tests, full suite, `npm run build`, and `npm run verify:village`.
- [ ] Commit `ci: build desktop installers on GitHub`.

### Task 6: Verify And Back Up The Release Source

**Files:**
- Generated locally only: `release/` or configured builder output.

- [ ] Launch the Windows unpacked application and verify local game shell, generated room, temporary HTTPS QR origin, and phone controller connection.
- [ ] Inspect the installer to confirm game assets and only the Windows tunnel binary are included.
- [ ] Create `backup/cross-platform-desktop-package-complete-20260821` after all checks pass.
- [ ] Push the feature branch and backup tags to the private GitHub repository.
- [ ] Report exact local installer paths and explain that macOS DMGs will appear as GitHub Actions artifacts because native macOS packaging/signing must run on macOS.
