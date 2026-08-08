# Playable Village Local Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a fast, complete local Windows build of the real ElderBoom village with full HTTPS phone control and only the currently approved pickup/washbasin gameplay.

**Architecture:** Keep the deterministic real-village geometry subset, then run a texture-only glTF Transform pass with strict disk/texel gates. Select a village-only director at desktop startup, make every async startup resource generation-owned, and package the production server plus an automatic Quick Tunnel in a portable Electron shell.

**Tech Stack:** Node.js 20+, Three.js, Rapier, Vite, Socket.IO, glTF Transform 4.4.2, Sharp, Electron, electron-builder, Vitest, Playwright.

## Global Constraints

- The current scene instantiates only the real village, system hand/flashlight gear, pickup props, and washbasin.
- Old corridor/story source remains available but `HorrorDirector`, panel, observation vignette, silhouette, exit door, and door defense are not constructed for the current village.
- Full phone mode remains mandatory: HTTPS, device orientation, rear-camera interaction, voice, crouch, flashlight, and inventory; no touch-only fallback may enter the game.
- Base-color/emissive textures fit within 1024 x 1024; normal/data textures fit within 512 x 512; final images are WebP.
- Runtime GLB is at most 134,217,728 bytes and decoded texture area is at most 120,000,000 texels.
- Draw calls remain below 450 and expanded triangles remain below 9,000,000.
- A cold local desktop start must render an interactive village within 30 seconds on this machine.
- Generated GLBs, build reports, package tools, screenshots, and Windows packages remain ignored and local-only.
- Never touch or stage `.release/`; never upload/push/release the Fab-derived artifact without explicit authorization and entitlement evidence.
- Home Screen installation and right-edge inventory gesture are deferred until this plan is complete.

---

### Task 1: Village-Only Gameplay And Owned Startup

**Files:**
- Create: `src/desktop/VillageDirector.js`
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/HandTrackingDirector.js`
- Modify: `src/desktop/FirstPersonHand.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Modify: `src/desktop/environment/EnvironmentLoader.js`
- Test: `tests/village-director.test.js`
- Test: `tests/desktop-app.test.js`
- Test: `tests/hand-tracking-director.test.js`
- Test: `tests/first-person-hand.test.js`
- Test: `tests/environment-loader.test.js`
- Test: `tests/asset-manifest.test.js`

**Interfaces:**
- Produces: `VillageDirector({ experience, ui, audio, inventory })` with `handleInteraction(id)`, `update(delta)`, `setSettings(settings)`, and `destroy()`.
- Produces: `classifySceneError(error) -> { code, message, retryable }` using `EnvironmentLoadError.status`, `.phase`, `.url`, and `.chunkId`.
- Produces: `HandTrackingDirector.load({ signal } = {})` and `FirstPersonHand.load({ signal } = {})`; both dispose a late-loaded model after abort.
- Preserves: one active scene startup generation and `DesktopApp.retrySceneStart()` from the pending Task 8 changes.

- [ ] **Step 1: Write failing village-boundary tests**

Assert the current ElderBoom experience constructs `VillageDirector`, never constructs `HorrorDirector` or `DoorDefenseDirector`, and keeps only `fuse`, `found-phone`, and `washbasin` interactables. Assert collecting `fuse` adds inventory and restores the neutral village objective without mentioning a panel or corridor.

```js
expect(app.director).toBeInstanceOf(VillageDirector);
expect(app.doorDefense).toBeNull();
expect(ui.setObjective).toHaveBeenLastCalledWith(expect.not.stringMatching(/配电箱|走廊/));
```

- [ ] **Step 2: Run the boundary tests and verify RED**

Run: `npm test -- tests/village-director.test.js tests/desktop-app.test.js`

Expected: FAIL because `VillageDirector` does not exist and `DesktopApp` always creates `HorrorDirector`.

- [ ] **Step 3: Implement the minimal village director and selection**

Use the environment manifest ID `elderboom-v1` as the current mode boundary. Keep `FoundPhoneDirector` separate. `VillageDirector.handleInteraction("fuse")` calls the existing inventory pickup API and hides the prop; `handleInteraction("washbasin")` calls the repeatable basin behavior. Its objective copy stays village-neutral.

- [ ] **Step 4: Write failing error metadata and late-load tests**

Cover a 404 chunk response, 503 chunk response, transport rejection, invalid length/hash/parse, abort, retry during hand load, and destroy during hand load. Require only the actual 404 expected-chunk case to produce `村庄资源尚未准备好。`.

```js
expect(classifySceneError(new EnvironmentLoadError("chunk-load", "missing", {
  status: 404,
  phase: "response",
  url: "/assets/environment/elderboom-v1/chunks/western-core.glb",
})).message).toBe("村庄资源尚未准备好。");
```

- [ ] **Step 5: Run lifecycle tests and verify RED**

Run: `npm test -- tests/environment-loader.test.js tests/desktop-app.test.js tests/hand-tracking-director.test.js tests/first-person-hand.test.js`

Expected: FAIL because chunk errors do not retain full response metadata and hand loads ignore abort ownership.

- [ ] **Step 6: Implement metadata and abort ownership**

Thread `signal` through scene creation, hand director, and model load callbacks. Check `signal.aborted` before attaching models and dispose geometry/material/texture resources on late completion. Treat `AbortError` as silent cancellation. Preserve HTTP status and request phase in `EnvironmentLoadError` options.

- [ ] **Step 7: Run focused regression and commit**

Run: `npm test -- tests/village-director.test.js tests/desktop-app.test.js tests/environment-loader.test.js tests/hand-tracking-director.test.js tests/first-person-hand.test.js tests/controller-app.test.js tests/protocol.test.js tests/asset-manifest.test.js`

Expected: PASS.

Commit: `fix: isolate playable village startup`

---

### Task 2: Deterministic Runtime Texture Optimization

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/environment/optimize-village-textures.mjs`
- Modify: `scripts/build-elderboom-village.mjs`
- Modify: `scripts/verify-elderboom-village.mjs`
- Modify: `public/assets/environment/elderboom-v1/manifest.json`
- Test: `tests/village-texture-optimizer.test.js`
- Test: `tests/village-asset-verifier.test.js`
- Test: `tests/asset-manifest.test.js`

**Interfaces:**
- Produces: `optimizeVillageTextures({ inputPath, outputPath, colorMax=1024, dataMax=512, quality=82 })` returning `{ images, texels, maxColorDimension, maxDataDimension }`.
- Produces: `inspectRuntimeTextures(document) -> { images, texels, colorTexels, dataTexels, maxColorDimension, maxDataDimension, mimeTypes }`.
- Changes: `npm run assets:village` writes the raw subset to a temporary ignored GLB, optimizes it, verifies it, then atomically replaces `western-core.glb` and updates manifest/report identity.

- [ ] **Step 1: Install pinned optimization dependencies**

Run: `npm install --save-dev @gltf-transform/core@4.4.2 @gltf-transform/extensions@4.4.2 @gltf-transform/functions@4.4.2 sharp@0.35.3`

Expected: package and lock files contain the four exact dev dependencies and installation exits 0.

- [ ] **Step 2: Write failing synthetic optimizer tests**

Create an embedded GLB fixture with 2048 color, normal, and metallic/roughness images. Assert color becomes at most 1024, normal/data become at most 512, all output MIME types are `image/webp`, mesh/accessor bytes and `EXT_mesh_gpu_instancing` remain equivalent, and repeated runs produce the same texture metrics.

- [ ] **Step 3: Run optimizer tests and verify RED**

Run: `npm test -- tests/village-texture-optimizer.test.js tests/village-asset-verifier.test.js`

Expected: FAIL because the optimizer and texel gates do not exist and the old verifier requires byte-identical PNG images.

- [ ] **Step 4: Implement slot-aware WebP optimization**

Register `ALL_EXTENSIONS` on glTF Transform `NodeIO`. Run `textureCompress` with Sharp and `slots: /^(baseColorTexture|emissiveTexture)$/` at `[1024, 1024]`, then with all remaining texture slots at `[512, 512]`, `targetFormat: "webp"`, and quality 82. Preserve unknown source metadata only where it remains valid after image replacement.

- [ ] **Step 5: Replace verifier image identity with geometry and budget identity**

Compare every non-image copied source bufferView byte-for-byte, compare every generated instancing bufferView against deterministic generated bytes, validate all material/texture references, require WebP MIME types, and enforce:

```js
invariant(artifactBytes <= 134_217_728, "runtime GLB exceeds 128 MiB");
invariant(textureMetrics.texels <= 120_000_000, "runtime textures exceed 120M texels");
invariant(textureMetrics.maxColorDimension <= 1024, "color texture exceeds 1024");
invariant(textureMetrics.maxDataDimension <= 512, "data texture exceeds 512");
```

- [ ] **Step 6: Generate and verify the real optimized village**

Run: `npm run assets:village`

Expected: exits 0 and atomically writes the optimized local GLB plus tracked manifest identity.

Run: `npm run verify:village`

Expected: PASS with no more than 134,217,728 bytes, no more than 120,000,000 texels, fewer than 450 draw calls, and fewer than 9,000,000 expanded triangles.

- [ ] **Step 7: Re-run deterministic build and commit tracked pipeline files**

Record the first SHA-256, run `npm run assets:village` again, and require the same artifact SHA-256 and byte count. Do not stage the generated GLB/report.

Run: `npm test -- tests/village-texture-optimizer.test.js tests/village-asset-verifier.test.js tests/asset-manifest.test.js tests/environment-loader.test.js`

Expected: PASS.

Commit: `perf: optimize village runtime textures`

---

### Task 3: Portable Windows Application And Automatic HTTPS

**Files:**
- Create: `desktop-shell/main.mjs`
- Create: `desktop-shell/tunnel.mjs`
- Create: `scripts/package-windows.mjs`
- Modify: `server/index.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Test: `tests/server-lifecycle.test.js`
- Test: `tests/tunnel-runner.test.js`
- Test: `tests/package-windows.test.js`

**Interfaces:**
- Produces: `createCorridorServer({ staticRoot, controllerOrigin }) -> { listen(port, host), close(), setControllerOrigin(origin), address() }`.
- Produces: `startQuickTunnel({ executable, localUrl, signal, timeoutMs }) -> Promise<{ origin, close() }>` with output parsing restricted to `https://*.trycloudflare.com`.
- Produces: `npm run package:windows` and ignored `artifacts/Corridor-617-Village-<version>.exe`.

- [ ] **Step 1: Install pinned shell dependencies**

Run: `npm install --save-dev electron@43.3.0 electron-builder@26.15.3`

Expected: package and lock files update and installation exits 0.

- [ ] **Step 2: Write failing server and tunnel lifecycle tests**

Assert an ephemeral loopback server serves production assets, `/api/config` reflects an origin changed after listen, close releases the port, tunnel output extracts only a valid Quick Tunnel origin, timeout rejects, abort kills only the owned child, and malformed output never reaches config.

- [ ] **Step 3: Run lifecycle tests and verify RED**

Run: `npm test -- tests/server-lifecycle.test.js tests/tunnel-runner.test.js`

Expected: FAIL because `server/index.js` starts on import and no tunnel runner exists.

- [ ] **Step 4: Refactor the server and implement the Electron shell**

Keep CLI behavior for `npm run dev` and `npm start`, but export an inert server factory for Electron/tests. Electron starts loopback first, launches bundled `cloudflared.exe`, waits for HTTPS, updates config, then opens a native `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, `autoHideMenuBar: true`, and no external navigation.

- [ ] **Step 5: Write failing package assembly tests**

Assert packaging refuses to proceed without a production build, optimized GLB, matching manifest identity, or a discoverable cloudflared executable. Assert the staging list contains `dist`, the server/shared protocol, Electron shell, and cloudflared but excludes source GLB, build report, `.release`, `.git`, tests, and source maps.

- [ ] **Step 6: Run package tests and verify RED**

Run: `npm test -- tests/package-windows.test.js`

Expected: FAIL because the package script and artifact allowlist do not exist.

- [ ] **Step 7: Implement deterministic local packaging**

`scripts/package-windows.mjs` verifies the runtime asset, locates the installed Cloudflare executable, stages it under ignored `.package-tools`, runs `vite build`, and invokes electron-builder's portable Windows target. Keep the package artifact ignored and print its exact path, bytes, and SHA-256.

- [ ] **Step 8: Build the portable executable and commit tracked shell code**

Run: `npm run package:windows`

Expected: exits 0 and creates one ignored portable `.exe` in `artifacts/`.

Run: `npm test -- tests/server-lifecycle.test.js tests/tunnel-runner.test.js tests/package-windows.test.js tests/session-registry.test.js tests/spa-fallback.test.js`

Expected: PASS.

Commit: `feat: package village as a Windows app`

---

### Task 4: Cold-Start And Packaged Acceptance

**Files:**
- Create: `.superpowers/sdd/packaged-village-smoke.mjs` (ignored evidence script)
- Create: `.superpowers/sdd/packaged-village-report.json` (ignored evidence)
- Modify: `.superpowers/sdd/progress.md` (ignored ledger)
- Modify: `README.md`

**Interfaces:**
- Consumes: the optimized runtime GLB and portable executable.
- Produces: exact cold-start duration, request failures, canvas pixel statistics, tunnel origin, process cleanup result, artifact hash, and physical-phone status.

- [ ] **Step 1: Run all automated verification**

Run: `$env:VILLAGE_ASSETS_REQUIRED='1'; npm test`

Expected: every test file passes; only explicitly documented pre-existing warnings may remain.

Run: `npm run verify:village`

Expected: PASS under every disk, texel, geometry, extension, and reference gate.

Run: `npm run build`

Expected: Vite exits 0 and the production GLB identity matches the manifest.

- [ ] **Step 2: Launch the packaged executable and measure cold start**

Start the exact artifact returned by `npm run package:windows`. Attach Playwright over Electron debugging, start timing before process creation, and stop when the loading overlay is hidden and the imported environment root has rendered non-background pixels.

Expected: interactive render in at most 30,000 ms.

- [ ] **Step 3: Verify real rendering and current interaction boundary**

At 1440 x 900 and 1920 x 1080, require a nonblank WebGL canvas with at least 8 unique sampled RGB values and at least 75 percent non-background samples. Walk from spawn, toggle the flashlight, collect the fuse, open/close the found phone, and use the washbasin twice. Require rendered pixels to change and forbid panel/corridor/door-defense objectives or interactables.

- [ ] **Step 4: Verify secure pairing and cleanup**

Require `/api/config` to expose the live HTTPS Quick Tunnel origin, the QR to use that origin plus the active room, and the tunneled controller shell to return HTTP 200. Close Electron and require its owned server and cloudflared child to exit and its loopback port to close.

- [ ] **Step 5: Record physical handset status honestly**

When the user scans the QR, record whether iOS prompts for motion/orientation and rear camera and whether the complete controller enters the game. Do not claim physical permission or sensor checks passed until the handset confirms them.

- [ ] **Step 6: Update README and request independent review**

Replace stale corridor-only user instructions with current village launch/package instructions, exact local-only asset generation requirements, and the no-public-release rule. Dispatch a whole-branch reviewer; fix every Critical or Important finding with a failing regression test.

- [ ] **Step 7: Commit tracked documentation only**

Run: `git status --short` and `git diff --cached --check`.

Expected: `.release/`, the runtime GLB/report, `.package-tools`, screenshots, logs, and Windows executable are not staged.

Commit: `test: verify packaged village cold start`

---

## Final Review Checklist

- The Windows executable opens the real optimized village within 30 seconds.
- The current interaction set is pickups plus washbasin, with no active corridor story wiring.
- The runtime artifact stays within 128 MiB and 120M decoded texels.
- Geometry, transforms, material references, GPU instancing, and non-image source buffer data pass strict verification.
- Retry/destroy owns and cleans every scene, hand model, server, and tunnel resource.
- Phone pairing is HTTPS and retains the complete motion/camera experience.
- The package is local-only and excludes source assets, reports, `.release`, tests, and repository metadata.
- Home Screen installation and right-edge inventory gesture remain deferred until this checklist passes.
