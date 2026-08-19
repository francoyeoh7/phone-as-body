# Village Regression Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the inherited village regression work so the rear-camera left hand is stable, the right hand holds one flashlight naturally, the village prioritizes frame rate, and phone PTT transcription is visible on the desktop.

**Architecture:** Keep the existing scene and Socket.IO contracts. Correct handedness at the MediaPipe boundary, correct the flashlight socket and sleeve coverage inside the shared `psx-arms.glb` rig, and reduce non-story village costs through deterministic foliage, texture, renderer, shadow, and collider budgets. The procedural knock-door prop remains outside the environment asset budget and keeps its existing PBR material path.

**Tech Stack:** JavaScript ES modules, Three.js, MediaPipe Tasks Vision, Rapier, Socket.IO, Vite, Vitest, GLB/WebP asset build pipeline.

## Global Constraints

- Preserve the inherited dirty working tree; do not reset, checkout, or make broad commits.
- The right hand must use `/assets/hands/psx-arms.glb` and its `Arms` skin material, the same source as the left hand.
- The right hand remains palm-down, lower-right, near the player, and shows exactly one visible flashlight aimed generally forward.
- Each finger centerline must remain at least `flashlightRadius * 0.78` from the flashlight axis, with grip spread at most `flashlightRadius * 0.75`.
- The rear camera is unmirrored; a MediaPipe `Right` label is the physical left hand used for desktop hand interaction.
- Render-pose deadband must not suppress raw knock gesture data.
- Preserve the knock-door's separate high-quality PBR construction while optimizing noncritical imported environment detail.
- The shipped village target is below `2,900,000` expanded triangles, below `50 MiB` for `western-core.glb`, and caps WebP textures at `768` color / `384` data pixels.
- Keep the current public tunnel process alive; only restart the Node process on port `4176` after the production build succeeds.

---

### Task 1: Restore Rear-Camera Physical Left Selection

**Files:**
- Modify: `src/controller/MediaPipeHandTracker.js`
- Modify: `tests/media-pipe-hand-tracker.test.js`
- Modify: `tests/hand-pose-stream.test.js`

**Interfaces:**
- Consumes: MediaPipe `categoryName`, rear camera video, `normalizeMediaPipeHandedness(value, inputMirrored)`.
- Produces: `createTrackedHandFrame()` only for the physical left hand and a stable render pose plus raw `gesturePose`.

- [x] **Step 1: Write failing rear-camera regression tests**

```js
tracker.handleResult({ result: handResult({ label: "Right" }), capturedAt: 20 });
expect(callbacks.onFrame).toHaveBeenCalledWith(expect.objectContaining({
  state: "tracked", handedness: "left", inputMirrored: false,
}));
```

Add the inverse assertion that an unmirrored `Left` result is rejected, and add one stream-level assertion that a deadband-frozen render pose still exposes a newer raw `gesturePose` for knock detection.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/media-pipe-hand-tracker.test.js tests/hand-pose-stream.test.js`

Expected before code change: the physical-left test fails because the default uses `inputMirrored: true`.

- [x] **Step 3: Make the boundary correction**

```js
// MediaPipe labels are mirrored by convention; CameraMotion supplies rear frames.
inputMirrored = false,
```

Leave explicit callers able to pass `true` only for a real mirrored preprocessing path.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run tests/media-pipe-hand-tracker.test.js tests/hand-pose-stream.test.js`

Expected: all focused tests pass, with raw gesture data still available while the rendered left hand is frozen.

### Task 2: Repair the Shared Right-Hand Grip and Sleeve Boundary

**Files:**
- Modify: `src/desktop/RightHandFlashlight.js`
- Modify: `src/desktop/realistic-sleeve.js`
- Modify: `tests/right-hand-flashlight.test.js`
- Modify: `tests/right-hand-asset-integration.test.js`

**Interfaces:**
- Consumes: right-side bones from `psx-arms.glb`, shared `ArmsMesh` material, flashlight socket, and sleeve skin influences.
- Produces: `RightHandFlashlight.flashlightBody`, `RightSleeveShell`, and the same source skin material contract as the left hand.

- [ ] **Step 1: Write failing grip and sleeve-coverage tests**

```js
expect(Math.min(...Object.values(distances))).toBeGreaterThanOrEqual(radius * 0.78);
expect(Math.max(...Object.values(distances)) - Math.min(...Object.values(distances)))
  .toBeLessThanOrEqual(radius * 0.75);
expect(uncoveredSubstantialArmTriangles).toBe(0);
```

Calculate substantial-arm triangles using a per-vertex upper-arm/forearm skin weight of at least `0.25`, rather than only the dominant bone. Also compare the right `ArmsMesh` map dimensions, color space, metalness, and roughness against a retained left-side clone from the same GLB.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/right-hand-asset-integration.test.js tests/right-hand-flashlight.test.js`

Expected before code change: the middle finger reaches only about `0.0173 m` from a `0.0281 m` radius flashlight axis and substantial sleeve triangles are uncovered.

- [ ] **Step 3: Correct only the socket offset and sleeve selection**

```js
const bodyCenterWorld = gripCenterFromCurledFingers(bones)
  .addScaledVector(gripAcross, -radius * 0.36 + 0.003)
  .addScaledVector(gripDepth, -radius * 0.62 + 0.009);

const isArmSurface = triangle.every((vertex) => (
  vertexBoneWeight(skinIndex, skinWeight, vertex, armIndexes) >= 0.25
));
```

Keep one flashlight mesh and the current palm-down wrist transform. Do not reintroduce MakeHuman materials, visible beam cones, free-standing sleeve tubes, or finger-ring geometry.

- [ ] **Step 4: Run focused tests and a rendered visual check**

Run: `npx vitest run tests/right-hand-asset-integration.test.js tests/right-hand-flashlight.test.js`

Then build and capture the desktop camera using `.visual-check/capture-desktop.mjs` and `.visual-check/capture-right-hand-audit.mjs`. Review against `.visual-check/reference/right-hand-reference-2.png`: close lower-right pose, palm down, natural curl, one visible flashlight, no pale/detached mesh, and no sleeve tear.

### Task 3: Enforce a Meaningful Village Frame-Rate Budget

**Files:**
- Modify: `scripts/environment/elderboom-v1.config.mjs`
- Modify: `scripts/environment/optimize-village-textures.mjs`
- Modify: `src/desktop/environment/EnvironmentLoader.js`
- Modify: `src/desktop/environment/colliders.js`
- Modify: `src/desktop/create-scene.js`
- Modify: `tests/village-performance-budget.test.js`
- Modify: `tests/environment-loader.test.js`
- Modify: `tests/environment-colliders.test.js`
- Modify: `tests/village-scene.test.js`
- Regenerate: `public/assets/environment/elderboom-v1/chunks/western-core.glb`
- Regenerate: `public/assets/environment/elderboom-v1/build-report.json`
- Regenerate: `public/assets/environment/elderboom-v1/manifest.json`

**Interfaces:**
- Consumes: ElderBoom source GLB, `ELDERBOOM_V1_CONFIG`, environment manifest, renderer capability settings, curated collider definitions.
- Produces: a manifest-valid optimized `western-core.glb`, bounded imported-environment renderer cost, and at most `48` generated collision proxies in addition to curated manifest collision.

- [ ] **Step 1: Tighten the tests before changing the budgets**

```js
expect(ELDERBOOM_V1_CONFIG.foliage).toMatchObject({
  maxInstancesPerMeshPerCell: 2,
  maxInstancesPerMesh: 120,
  maxHighPolyInstancesPerMesh: 0,
});
expect(report.metrics.expandedTriangles).toBeLessThan(2_900_000);
expect(report.metrics.bytes).toBeLessThan(50 * 1024 * 1024);
```

Add loader assertions for texture anisotropy `2` and a `1024 x 1024` moon shadow map. Add an 80-instance synthetic collider fixture asserting that only 48 automatic proxies are generated; curated proxies remain unbounded and route-critical.

- [ ] **Step 2: Run the performance tests and verify RED**

Run: `npx vitest run tests/village-performance-budget.test.js tests/environment-loader.test.js tests/environment-colliders.test.js tests/village-scene.test.js`

Expected before code change: the 3.65M-triangle / 67MB report violates the new frame-rate budget and current loader/collider settings violate the new limits.

- [ ] **Step 3: Apply the deterministic quality budget**

```js
foliage: {
  maxInstancesPerMeshPerCell: 2,
  maxInstancesPerMesh: 120,
  maxHighPolyInstancesPerMesh: 0,
}
export const VILLAGE_TEXTURE_LIMITS = Object.freeze({ color: 768, data: 384 });
const ENVIRONMENT_ANISOTROPY = 2;
light.shadow.mapSize.set(1024, 1024);
const MAX_GENERATED_COLLIDERS = 48;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
```

Keep the procedural knock-door and its PBR texture path unchanged. Regenerate the GLB with `npm run assets:village`; validate the manifest hash and report with `npm run verify:village`.

- [ ] **Step 4: Verify GREEN and inspect the protected story space**

Run: `npx vitest run tests/village-performance-budget.test.js tests/environment-loader.test.js tests/environment-colliders.test.js tests/village-scene.test.js`

Run: `npm run assets:village && npm run verify:village`

Expected: strict asset budget passes, manifest hash matches, and a desktop screenshot still shows the PBR knock-door scene at the task location without visible environment collapse.

### Task 4: Rebuild, Exercise Phone Voice to Desktop Subtitle, and Publish the New Process

**Files:**
- Verify: `src/controller/VoiceHoldController.js`
- Verify: `src/controller/ControllerApp.js`
- Verify: `src/controller/PcmVoiceStreamer.js`
- Verify: `src/desktop/DesktopApp.js`
- Verify: `src/desktop/ui.js`
- Verify: `server/index.js`
- Verify: `tests/voice-hold-controller.test.js`
- Verify: `tests/pcm-voice-streamer.test.js`
- Verify: `tests/desktop-app.test.js`
- Verify: `tests/protocol.test.js`

**Interfaces:**
- Consumes: phone `pointerdown` PTT, browser recognition / PCM WAV upload, `/api/npc/transcribe`, and `voice-transcript` Socket.IO action.
- Produces: desktop bottom subtitle text that remains visible in clean game view for 4.8 seconds.

- [ ] **Step 1: Run the recovered PTT and desktop routing suites**

Run: `npx vitest run tests/voice-hold-controller.test.js tests/pcm-voice-streamer.test.js tests/browser-voice-recognizer.test.js tests/controller-app.test.js tests/desktop-app.test.js tests/protocol.test.js tests/npc-ai.test.js`

Expected: all PTT lifecycle, WAV upload, protocol limit, desktop display, and transcription fallback tests pass.

- [ ] **Step 2: Build before touching the public process**

Run: `npm run build`

Expected: Vite creates a current `dist/` with no build error. Do not restart port `4176` if this fails.

- [ ] **Step 3: Restart only the local Node process and preserve the tunnel**

Stop the listener that owns `4176`, start `NODE_ENV=production node server/index.js` from this repository, and confirm `/`, `/api/config`, and `/api/npc/config` return `200`. Do not terminate `cloudflared.exe`.

- [ ] **Step 4: Use a paired Socket.IO/browser test and screenshots for final evidence**

Submit the existing short WAV fixture through the real local `/api/npc/transcribe` path, relay the corresponding `voice-transcript` action through the paired desktop session, and assert the rendered DOM contains the resulting bottom player subtitle. Capture the desktop canvas and subtitle layer after the fresh build. Run `npm test` as the final suite.
