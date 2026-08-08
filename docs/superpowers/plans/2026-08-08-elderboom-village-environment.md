# ElderBoom Village Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the procedural L-corridor presentation with a locally generated, high-fidelity night-time subset of the real ElderBoom Hollow Fab GLB while preserving Corridor 617's phone, hand, inventory, story, and door-defense contracts.

**Architecture:** A deterministic Node.js build tool reads the external 936,886,692-byte GLB, selects the western-core spatial region, prunes unreachable glTF resources, and converts repeated leaf meshes to `EXT_mesh_gpu_instancing` without resizing source textures or decimating retained meshes. The renderer loads ignored local GLB chunks through a versioned, tracked manifest; a focused environment layer owns loading, proxy collision, semantic lights, task anchors, resource disposal, and retryable failures while `createScene()` retains its existing public contract.

**Tech Stack:** JavaScript ES modules, Node.js file streams, glTF 2.0/GLB, Three.js r178 `GLTFLoader`, `EXT_mesh_gpu_instancing`, Rapier 3D 0.19, Vitest, Vite, Playwright visual smoke tests.

## Scope Split

- This plan implements the real village asset pipeline and a complete playable browser-runtime integration. It consumes the already completed responsive-left-hand Tasks 1-5.
- Mobile crouch presentation, held fuse/equipment, and transient lifecycle remain in `docs/superpowers/plans/2026-08-07-mobile-voice-inventory-crouch.md` Tasks 5-7 and execute first because they overlap the same orchestration files.
- Electron packaging, pinned `cloudflared` sidecars, Windows ZIP, macOS arm64 app/DMG, signing, and notarization form a separate deliverable after the playable village passes Task 9. They do not change the environment manifest/runtime boundary and are not mixed into this plan.

## Global Constraints

- Source asset: `D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb`, exact SHA-256 `0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB`.
- Never copy, stage, serve, or bundle the complete 936,886,692-byte source GLB.
- Use source region `x=-10..25`, `y=-2..30`, `z=12..48`, shifted at runtime by `[-7.5, -1, -30]`.
- Apply `rootTransform` only to imported GLB chunk roots. Spawn, task, collider, occluder, light, and cinematic coordinates in the manifest are already in post-transform game space and must not be shifted a second time.
- Preserve retained mesh data, UVs, source texture dimensions, PBR material assignments, and `KHR_materials_specular`, `KHR_materials_sheen`, `KHR_materials_anisotropy`, and `KHR_texture_transform` data.
- Omit unused sectors and deterministically thin only repeated foliage instances; do not decimate retained architecture or prop meshes.
- Generate real assets under `public/assets/environment/elderboom-v1/chunks/`; keep generated GLBs and reports ignored by Git. Track the build configuration, manifest, code, tests, and provenance notes.
- Keep the existing `createScene()` return contract, interaction IDs, target epochs, contact points/normals, hand authorization, phone protocol, gyro algorithm, joystick, flashlight, inventory ownership, and task state-machine IDs.
- Keep camera denial and hand-tracking failure non-blocking after phone motion permission succeeds.
- Do not push GitHub commits, publish a Release, upload to CI, or distribute the generated Fab subset without explicit user authorization and archived Fab entitlement evidence.
- Leave existing untracked `.release/` files untouched and unstaged.
- Complete Mobile Voice/Inventory/Crouch plan Tasks 5-7 before Task 6 below because both plans modify `PlayerController`, `DesktopApp`, `HorrorDirector`, `HandTrackingDirector`, and `create-scene.js`.

---

## File Structure

- `scripts/environment/glb-io.mjs`: bounded GLB header/JSON reads, alignment helpers, and streaming output.
- `scripts/environment/glb-graph.mjs`: glTF reference traversal, index remapping, orphan checks, and material-extension texture discovery.
- `scripts/environment/elderboom-v1.config.mjs`: immutable source hash, AABB, origin, exclusion, foliage, instancing, and output rules.
- `scripts/build-elderboom-village.mjs`: CLI orchestration, selection, chunk generation, metrics, and manifest artifact update.
- `scripts/verify-elderboom-village.mjs`: source/artifact hashes, GLB integrity, dependency closure, bounds, instancing, and performance gates.
- `tests/fixtures/synthetic-glb.js`: in-memory deterministic GLB fixture builder for extractor tests.
- `src/desktop/environment/manifest.js`: strict runtime manifest validation and immutable normalization.
- `src/desktop/environment/EnvironmentLoader.js`: GLTF chunk lifecycle, world transforms, curated occluders, progress, and partial-failure cleanup.
- `src/desktop/environment/resources.js`: deduplicated geometry/material/all-texture disposal.
- `src/desktop/environment/colliders.js`: rotated Rapier proxy collider creation and disposal.
- `public/assets/environment/elderboom-v1/manifest.json`: tracked art/gameplay boundary for chunks, spawn, bounds, colliders, lights, tasks, and cinematics.
- `public/assets/environment/elderboom-v1/PROVENANCE.md`: source identity, local-only generation rule, and distribution gate.
- `src/desktop/create-scene.js`: assemble imported environment and existing gameplay props without owning extraction/loading details.
- `src/desktop/PlayerController.js`: consume manifest spawn/yaw, exterior camera far plane, and curated occluders.
- `src/desktop/HorrorDirector.js`: consume semantic story lights and local-basis threat anchors.
- `src/desktop/ShadowQuestDirector.js`: animate figure and operating door along authored local vectors.
- `src/desktop/DesktopApp.js`: expose retryable environment load failure and cancel stale startup attempts.
- `.superpowers/sdd/village-visual-smoke.cjs`: local Playwright screenshots, pixel checks, scene metrics, and fixed camera acceptance.

---

### Task 1: Deterministic GLB Intake And Spatial Report

**Files:**
- Create: `scripts/environment/glb-io.mjs`
- Create: `scripts/environment/glb-graph.mjs`
- Create: `scripts/environment/elderboom-v1.config.mjs`
- Create: `tests/fixtures/synthetic-glb.js`
- Create: `tests/glb-intake.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `readGlbDocument(path) -> { json, jsonChunkLength, binOffset, binLength, totalLength }` without loading the BIN chunk.
- Produces: `walkNodeWorldTransforms(json)`, `nodeWorldBounds(json, nodeIndex, worldMatrix)`, `collectDocumentReferences(json, nodeIndices)`, and `assertClosedDocument(json)`.
- Produces: immutable `ELDERBOOM_V1_CONFIG` with `source.sha256`, `selection.bounds`, `rootTransform`, node exclusions, foliage rules, and output paths.

- [ ] **Step 1: Write the synthetic GLB fixture and failing intake tests**

Create a fixture containing two root mesh nodes, one nested mesh node, shared accessors, one embedded image, one punctual light, and a material using core textures plus all four retained KHR material extensions. Test header validation, JSON-only reads, world transforms, accessor-bound transformation, reference closure, exact source hash rejection, and the fixed ElderBoom region.

```js
const document = await readGlbDocument(fixture.path);
expect(document.binLength).toBeGreaterThan(0);
expect(document).not.toHaveProperty("bin");
expect(walkNodeWorldTransforms(document.json).get(2).elements[12]).toBeCloseTo(7);
expect(collectDocumentReferences(document.json, new Set([2])).textures).toEqual(
  new Set([0, 1, 2, 3, 4, 5, 6, 7]),
);
expect(() => assertExpectedSourceHash("BAD", ELDERBOOM_V1_CONFIG)).toThrow(/source hash/i);
```

- [ ] **Step 2: Run the intake tests and verify RED**

Run: `npm test -- tests/glb-intake.test.js`

Expected: FAIL because the environment scripts and fixture helper do not exist.

- [ ] **Step 3: Implement bounded GLB reads and complete reference traversal**

`readGlbDocument()` reads the 12-byte header, the JSON chunk header/body, and the BIN chunk header only. `collectDocumentReferences()` must cover primitive indices/attributes/targets, accessor sparse views, material core texture infos, `KHR_materials_specular`, `KHR_materials_sheen`, `KHR_materials_anisotropy`, texture source/sampler, embedded image buffer views, node punctual lights, and selected ancestors/descendants.

```js
export const ELDERBOOM_V1_CONFIG = Object.freeze({
  source: {
    defaultPath: "D:\\3d资产\\ElderBoomHollow\\source\\elderbloom_hollow.glb",
    bytes: 936_886_692,
    sha256: "0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB",
  },
  selection: { bounds: { min: [-10, -2, 12], max: [25, 30, 48] } },
  rootTransform: { position: [-7.5, -1, -30], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  excludeNamePatterns: [
    /^LandscapeHeightfieldCollisionComponent/,
    /^InstancedFoliageActor/,
    /^NS_/,
  ],
  outputs: {
    directory: "public/assets/environment/elderboom-v1/chunks",
    report: "public/assets/environment/elderboom-v1/build-report.json",
  },
});
```

- [ ] **Step 4: Add read-only inspection command and verify the real source**

Add `"inspect:village": "node scripts/build-elderboom-village.mjs --inspect"` to `package.json`. The inspection path must not create chunks or mutate the manifest.

Run: `npm run inspect:village`

Expected: PASS and report source bytes `936886692`, source hash beginning `0DFDDCB9`, scene `Village`, 48,425 nodes, and western-core candidate metrics without writing under `public/assets/environment`.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- tests/glb-intake.test.js`

Expected: PASS.

Commit: `feat: inspect deterministic village source`

---

### Task 2: Dependency-Safe Spatial Extraction And GPU Instancing

**Files:**
- Modify: `scripts/environment/glb-io.mjs`
- Modify: `scripts/environment/glb-graph.mjs`
- Modify: `scripts/environment/elderboom-v1.config.mjs`
- Create: `scripts/build-elderboom-village.mjs`
- Create: `tests/glb-subset.test.js`
- Modify: `tests/fixtures/synthetic-glb.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 GLB document, transforms, bounds, references, and config.
- Produces: `selectSpatialNodes(json, config) -> Selection` using transformed mesh bounds, not node origins.
- Produces: `buildSubsetDocument(document, selection, options) -> { json, copiedViews, generatedViews, metrics }`.
- Produces: `writeGlbStream(sourcePath, outputPath, subset)` that copies selected BIN ranges without buffering the source BIN.
- Produces: `EXT_mesh_gpu_instancing` nodes for repeated leaf meshes with generated `TRANSLATION`, `ROTATION`, and `SCALE` accessors.

- [ ] **Step 1: Write failing extraction tests**

Cover transformed AABB intersection, deterministic foliage thinning, stable node order, ancestor preservation, exact core/KHR texture retention, image byte identity, index remapping, sparse accessors, 4-byte alignment, no orphan resources, deterministic SHA-256, and instanced transforms matching the source node world matrices.

```js
const first = await extractFixture({ seed: "elderboom-v1" });
const second = await extractFixture({ seed: "elderboom-v1" });
expect(first.sha256).toBe(second.sha256);
expect(first.json.extensionsUsed).toContain("EXT_mesh_gpu_instancing");
expect(readEmbeddedImage(first, 0)).toEqual(readEmbeddedImage(source, 0));
expect(() => assertClosedDocument(first.json)).not.toThrow();
expect(first.metrics.drawCalls).toBeLessThan(first.metrics.sourceSelectedDrawCalls);
```

- [ ] **Step 2: Run subset tests and verify RED**

Run: `npm test -- tests/glb-subset.test.js`

Expected: FAIL because selection, remapping, instancing, and streaming output are absent.

- [ ] **Step 3: Implement exact spatial selection and deterministic thinning**

Select every architecture/prop mesh whose transformed accessor bounds intersect the western-core AABB. For names beginning `FoliageInstancedStaticMeshComponent_5:`, `_6:`, or `_7:`, retain the lowest stable SHA-256 rank per 4m x 4m cell up to 18 instances per mesh per cell. Retain all other selected trees, fences, props, and architecture. Exclude collision helpers and particle placeholders from Task 1.

```js
export function keepDenseFoliage(node, cell, config) {
  const key = `${config.seed}|${node.index}|${node.name}|${cell.x}|${cell.z}`;
  return createHash("sha256").update(key).digest().readUInt32LE(0);
}
```

- [ ] **Step 4: Implement dependency remapping and streaming GLB output**

Rebuild arrays in original-index order. Copy every retained source `bufferView` byte-for-byte to an aligned output offset, append generated instancing accessors, update `buffers[0].byteLength`, and emit valid JSON/BIN chunk lengths. Keep extension payloads and texture transforms unchanged except remapped integer references.

- [ ] **Step 5: Ignore only generated licensed artifacts and add build scripts**

Append:

```gitignore
public/assets/environment/elderboom-v1/chunks/*.glb
public/assets/environment/elderboom-v1/build-report.json
```

Add:

```json
"assets:village": "node scripts/build-elderboom-village.mjs --write",
"verify:village": "node scripts/verify-elderboom-village.mjs"
```

- [ ] **Step 6: Run focused tests and generate the real western-core chunk**

Run: `npm test -- tests/glb-intake.test.js tests/glb-subset.test.js`

Expected: PASS.

Run: `npm run assets:village`

Expected: exit 0, create `public/assets/environment/elderboom-v1/chunks/western-core.glb`, keep the source untouched, and report fewer than 900 render nodes, fewer than 450 draw calls, fewer than 9,000,000 expanded triangles, no more than 260 retained images, and output size between 250 MiB and 550 MiB.

- [ ] **Step 7: Commit code only**

Run: `git status --short`

Expected: extraction code/tests/config plus `.gitignore` and `package.json` are tracked changes; generated `western-core.glb` and `build-report.json` do not appear.

Commit: `feat: extract instanced ElderBoom village subset`

---

### Task 3: Versioned Environment Manifest And Provenance Boundary

**Files:**
- Create: `public/assets/environment/elderboom-v1/manifest.json`
- Create: `public/assets/environment/elderboom-v1/PROVENANCE.md`
- Create: `src/desktop/environment/manifest.js`
- Create: `tests/environment-manifest.test.js`
- Modify: `scripts/build-elderboom-village.mjs`

**Interfaces:**
- Produces: `validateEnvironmentManifest(value) -> deeply frozen manifest`.
- Produces: exact manifest version `elderboom-v1`, one `western-core` chunk, root transform, post-transform game-space spawn/bounds/colliders/occluders/lights/tasks, and cinematic local vectors.
- Produces: artifact metadata `{ bytes, sha256 }` updated only after a successful deterministic build.

- [ ] **Step 1: Write failing strict-schema tests**

Assert rejection of unknown top-level/nested keys, path traversal, non-HTTPS remote URLs, non-finite transforms, non-positive collider extents, duplicate IDs, missing task IDs, invalid normals, unreachable bounds, and mutable snapshots. Assert the tracked real manifest validates.

```js
const manifest = validateEnvironmentManifest(validManifest());
expect(manifest.id).toBe("elderboom-v1");
expect(Object.keys(manifest.tasks).sort()).toEqual([
  "exit-door", "found-phone", "fuse", "panel", "shadow-window", "washbasin",
]);
expect(() => { manifest.spawn.position[0] = 99; }).toThrow();
```

- [ ] **Step 2: Run manifest tests and verify RED**

Run: `npm test -- tests/environment-manifest.test.js`

Expected: FAIL because validator and manifest do not exist.

- [ ] **Step 3: Implement exact allowlist validation**

Use explicit allowed-key sets at every object boundary. Normalize vectors/quaternions to copied arrays, require chunk URLs under `/assets/environment/elderboom-v1/chunks/`, and freeze recursively.

- [ ] **Step 4: Author the western-core gameplay manifest**

Use these post-root-transform coordinates:

```json
{
  "id": "elderboom-v1",
  "version": 1,
  "coordinateSpace": "game",
  "rootTransform": { "position": [-7.5, -1, -30], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
  "spawn": { "position": [6.5, 1.05, -2.0], "yaw": 3.141592653589793 },
  "playableBounds": { "min": [-17.5, -0.2, -18], "max": [17.5, 8, 18] },
  "tasks": {
    "washbasin": { "position": [5.7, 0.08, -8.8], "rotationY": 0, "contactNormal": [0, 0, 1], "approachDirection": [0, 0, -1], "maxUseDistance": 2.35 },
    "found-phone": { "position": [7.7, 0.08, -0.3], "rotationY": -0.35, "contactNormal": [0, 1, 0], "approachDirection": null, "maxUseDistance": 2.35 },
    "shadow-window": { "position": [4.4, 1.25, 4.0], "rotationY": 0, "contactNormal": [0, 0, -1], "approachDirection": [0, 0, 1], "maxUseDistance": 2.35 },
    "fuse": { "position": [2.0, 0.18, 2.0], "rotationY": -0.22, "contactNormal": [0, 1, 0], "approachDirection": null, "maxUseDistance": 2.35 },
    "panel": { "position": [-0.1, 1.1, 15.4], "rotationY": 1.5707963267948966, "contactNormal": [1, 0, 0], "approachDirection": [-1, 0, 0], "maxUseDistance": 2.35 },
    "exit-door": { "position": [11.52, 0, -9.92], "rotationY": 0, "triggerPosition": [11.52, 1.35, -8.4], "inwardNormal": [0, 0, 1] }
  }
}
```

Add four boundary colliders plus split wall-box proxies around the primary house (`x=5..15.6,z=-14..-9.7`) and secondary house (`x=-1.2..4.5,z=4..15.5`) so doors/windows remain approachable. Add occluder proxies matching those boxes. Define semantic lights `moon`, `storm`, `power-sequence`, `emergency`, and `practical` with stable IDs.

- [ ] **Step 5: Record provenance and distribution gate**

`PROVENANCE.md` records the Fab listing ID `e12de9d5-be28-40df-a387-42ae6f84e05c`, source hash/size/generator, local source path, exact extraction command, unchanged texture-dimension policy, generated-artifact Git ignore, and the rule that publishing requires archived account entitlement plus explicit user authorization. Do not claim a license tier not present on disk.

- [ ] **Step 6: Run tests, update artifact metadata, and commit**

Run: `npm run assets:village`

Expected: update only `manifest.json` chunk `bytes` and `sha256` fields after successful output verification.

Run: `npm test -- tests/environment-manifest.test.js`

Expected: PASS.

Commit: `feat: define ElderBoom village environment contract`

---

### Task 4: Runtime Chunk Loading, Ownership, And Retryable Errors

**Files:**
- Create: `src/desktop/environment/resources.js`
- Create: `src/desktop/environment/EnvironmentLoader.js`
- Create: `tests/environment-loader.test.js`

**Interfaces:**
- Consumes: Task 3 validated manifest and Three.js `GLTFLoader`.
- Produces: `EnvironmentLoadError` with codes `manifest-fetch`, `manifest-invalid`, `chunk-load`, and `chunk-invalid` plus `retryable: true`.
- Produces: `loadEnvironment({ scene, manifestUrl, fetchImpl, loader, signal, onProgress }) -> EnvironmentInstance`.
- `EnvironmentInstance` exposes `{ manifest, root, chunks, occluderRoots, anchors, lights, dispose() }`.

- [ ] **Step 1: Write failing loader and disposal tests**

Test URL resolution, root transform application, chunk ordering, progress aggregation, abort, one failed chunk after one successful chunk, no partial scene roots, semantic-light lookup, curated occluders, shared geometry/material/texture disposal exactly once, all PBR texture slots, and idempotent disposal.

```js
await expect(loadEnvironment(harness({ chunkFailure: true }))).rejects.toMatchObject({
  name: "EnvironmentLoadError",
  code: "chunk-load",
  retryable: true,
  chunkId: "western-core",
});
expect(scene.children).not.toContain(successfulPartialRoot);
expect(sharedNormalMap.dispose).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run loader tests and verify RED**

Run: `npm test -- tests/environment-loader.test.js`

Expected: FAIL because loader/resource ownership modules do not exist.

- [ ] **Step 3: Implement abortable manifest and GLTF loading**

Fetch and validate the manifest first. Fetch each chunk `ArrayBuffer` with `AbortSignal`, then pass it to an injectable `GLTFLoader.parseAsync` adapter; attach no chunk to the live scene until every required chunk succeeds. Apply root transform once at the environment root, set imported decorative meshes to receive shadows, and enable casting only for manifest-selected nearby node-name patterns.

- [ ] **Step 4: Implement deduplicated full PBR disposal**

Collect identities in `Set`s before disposal. Cover geometry; material arrays; `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`, `alphaMap`, `bumpMap`, `displacementMap`, `lightMap`, `specularIntensityMap`, `specularColorMap`, `sheenColorMap`, `sheenRoughnessMap`, `anisotropyMap`, and environment textures owned by the instance.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/environment-manifest.test.js tests/environment-loader.test.js`

Expected: PASS.

Commit: `feat: load owned village environment chunks`

---

### Task 5: Rotated Proxy Collision And Reachable Village Route

**Files:**
- Create: `src/desktop/environment/colliders.js`
- Create: `tests/environment-colliders.test.js`
- Create: `tests/village-route.test.js`
- Modify: `public/assets/environment/elderboom-v1/manifest.json`

**Interfaces:**
- Consumes: Task 3 collider definitions `{ id, shape, position, halfExtents|radius|halfHeight, rotation }`.
- Produces: `createEnvironmentColliders({ RAPIER, world, manifest }) -> { colliders, dispose() }`.
- Produces: proxy `THREE.Mesh` occluder roots only in test/debug mode; production raycasts use invisible boxes with `userData.environmentOccluder = true`.

- [ ] **Step 1: Write failing rotated-collider tests**

Use real Rapier to assert box yaw/quaternion, capsule dimensions, collider center after root transform, no duplicate handles, idempotent removal, and no render geometry used as a physics trimesh.

```js
const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest() });
expect(instance.colliders[0].rotation().y).toBeCloseTo(Math.sin(Math.PI / 8));
expect(instance.colliders.every((entry) => entry.shapeType() !== RAPIER.ShapeType.TriMesh)).toBe(true);
```

- [ ] **Step 2: Write the route reachability test and verify RED**

Create the real player capsule and sweep waypoints from spawn to washbasin, found phone, shadow window, fuse, panel, and exit-door trigger. The route must include heading changes of at least 90 degrees at two waypoints and a return segment to the primary house without collider penetration.

Run: `npm test -- tests/environment-colliders.test.js tests/village-route.test.js`

Expected: FAIL because collider construction and the village route harness do not exist.

- [ ] **Step 3: Implement box/capsule proxies and curated occluders**

Create fixed Rapier bodies/colliders directly from validated post-transform game-space definitions; do not apply the GLB root transform again. Build separate invisible Three.js box roots for interaction occlusion; exclude all interactable roots and contact anchors from that list.

- [ ] **Step 4: Tune only manifest proxies until the route passes**

Do not change source mesh transforms to fix navigation. Adjust the tracked proxy boxes/gaps in `manifest.json`, keeping the primary and secondary building envelopes blocked while every task approach point retains at least `0.9m` capsule clearance.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/environment-colliders.test.js tests/village-route.test.js`

Expected: PASS.

Commit: `feat: add reachable village collision proxies`

---

### Task 6: Scene Assembly, Spawn, Night Lighting, And Existing Props

**Files:**
- Modify: `src/desktop/create-scene.js`
- Modify: `src/desktop/PlayerController.js`
- Modify: `src/desktop/FoundPhoneProp.js`
- Modify: `src/desktop/Washbasin.js`
- Modify: `src/desktop/ExitDoor.js`
- Modify: `tests/scene-props.test.js`
- Modify: `tests/player-controller.test.js`
- Create: `tests/village-scene.test.js`

**Interfaces:**
- Consumes: Tasks 3-5 environment instance, colliders, semantic lights, spawn, and task anchors.
- Preserves: `createScene(host) -> { RAPIER, scene, camera, renderer, world, interactables, staticOccluderRoots, objects, update, dispose }`.
- Produces: `spawn: { position, yaw }` on the experience contract and `objects.environment` while retaining `objects.corridor.anchors` as a compatibility alias to manifest task/cinematic anchors.
- Produces: `PlayerController` constructor option `spawn`, exterior `far=140`, and manifest-curated occluders.

- [ ] **Step 1: Write failing scene-contract tests**

Inject a fake environment loader and assert asynchronous load order, imported root attachment, root disposal, task props at manifest anchors, stable IDs, contact normals/approach directions/max distances, semantic lights, spawn propagation, camera far plane, and unchanged return/dispose contract.

```js
const experience = await createScene(host, { loadEnvironment: fakeVillageLoader });
expect(experience.objects.environment.manifest.id).toBe("elderboom-v1");
expect(experience.objects.corridor.anchors).toBe(experience.objects.environment.anchors);
expect(experience.interactables.map(({ id }) => id)).toEqual([
  "fuse", "panel", "found-phone", "washbasin", "shadow-window",
]);
expect(experience.camera.far).toBe(140);
```

- [ ] **Step 2: Write failing player spawn tests and verify RED**

Assert capsule translation and initial camera yaw use the supplied spawn, while absent spawn preserves `[0,1.05,1.2]` and yaw `0` for isolated legacy tests.

Run: `npm test -- tests/village-scene.test.js tests/scene-props.test.js tests/player-controller.test.js`

Expected: FAIL because `createScene` is corridor-only and `PlayerController` ignores spawn.

- [ ] **Step 3: Split procedural prop materials from corridor construction**

Keep the existing flashlight, fuse, panel, washbasin, found-phone, observation vignette, silhouette, and animated exit-door factories. Remove procedural corridor walls/floors/ceilings/inner doors from the village path. Place every prop from manifest anchors and copy authored `contactNormal`, `approachDirection`, and `maxUseDistance` into its interaction contract.

- [ ] **Step 4: Assemble environment, proxies, and semantic night lights**

Load `manifest.json` before creating gameplay props. Use a dark neutral sky, cool moon fill, low hemisphere/ambient contribution, restrained fog, sparse practical lights, and the existing warm flashlight as dominant near-field light. Do not mutate imported material colors or texture dimensions. Map manifest light roles to compatibility arrays `ceilingLights`, `emergencyLights`, `stormLight`, and `hemi`.

- [ ] **Step 5: Add spawn/yaw and curated occluders to PlayerController**

Use `RigidBodyDesc...setTranslation(...spawn.position)` and initialize camera logical/render yaw from `spawn.yaw`. Keep the capsule dimensions, gyro gain/smoothing, movement mapping, interaction scoring, and target epoch logic unchanged.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/village-scene.test.js tests/scene-props.test.js tests/player-controller.test.js tests/interaction.test.js tests/door-defense-director.test.js tests/found-phone-director.test.js`

Expected: PASS.

Commit: `feat: replace corridor presentation with real village`

---

### Task 7: Anchor-Local Story, Shadow, And Door Direction

**Files:**
- Modify: `src/desktop/HorrorDirector.js`
- Modify: `src/desktop/ShadowQuestDirector.js`
- Modify: `src/desktop/DoorDefenseDirector.js`
- Modify: `public/assets/environment/elderboom-v1/manifest.json`
- Modify: `tests/horror-director.test.js`
- Modify: `tests/shadow-quest.test.js`
- Modify: `tests/door-defense-director.test.js`

**Interfaces:**
- Consumes: manifest `story` anchors `firstReveal`, `pursuitSpawn`, `pursuitTargetOffset`; shadow `peekPosition`, `peekTarget`, `figureStart`, `figureTravel`, `doorTravel`; exit door `triggerPosition` and `inwardNormal`.
- Preserves: objective IDs/events, repeatable washbasin, fuse/panel state, found-phone hold/release, and four-second sustained door defense.

- [ ] **Step 1: Write failing arbitrary-basis director tests**

Rotate the full anchor basis by 90 degrees and assert silhouette reveal/pursuit, figure travel, operating-door travel, peek camera, and door brace all follow authored vectors rather than world `+Z`. Assert semantic power lights replace `ceilingLights[2]` assumptions.

```js
director.collectFuse();
expect(silhouette.position.toArray()).toEqual(manifest.story.firstReveal);
shadow.startCinematic();
shadow.updateFigure(FIGURE_END);
expect(shadowFigure.position.toArray()).toEqual(add(figureStart, figureTravel));
```

- [ ] **Step 2: Run director tests and verify RED**

Run: `npm test -- tests/horror-director.test.js tests/shadow-quest.test.js tests/door-defense-director.test.js`

Expected: FAIL on hard-coded light index and world-Z movement.

- [ ] **Step 3: Consume semantic anchors without changing state machines**

Read all positions/vectors once in each constructor, clone them, and animate with `addScaledVector(authoredVector, progress)`. `HorrorDirector` uses named power lights and exact story anchors. `ShadowQuestDirector` uses manifest-local figure/door vectors. `DoorDefenseDirector` keeps its existing inward-normal derivation and uses the manifest trigger directly.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- tests/horror-director.test.js tests/shadow-quest.test.js tests/door-defense-director.test.js tests/objectives.test.js`

Expected: PASS.

Commit: `fix: make village cinematics anchor local`

---

### Task 8: Retryable Startup And Cross-Feature Lifecycle

**Files:**
- Modify: `src/desktop/DesktopApp.js`
- Modify: `src/desktop/ui.js`
- Modify: `src/desktop/styles.css`
- Modify: `tests/desktop-app.test.js`
- Modify: `tests/asset-manifest.test.js`

**Interfaces:**
- Consumes: Task 4 `EnvironmentLoadError`, Mobile Task 7 transient cleanup, and existing scene disposal.
- Produces: one active startup generation, `retrySceneStart()`, retryable asset status, and no stale scene attachment after retry/destroy.

- [ ] **Step 1: Write failing startup generation tests**

Assert manifest failure, chunk failure after partial load, retry success, double-click suppression, destroy during load, stale first attempt resolving after second, missing ignored local chunk messaging, no orphan renderer/Rapier world, and transient controls cleared once.

```js
await app.startGame(false);
expect(ui.showSceneError).toHaveBeenCalledWith(expect.objectContaining({
  retryable: true,
  code: "chunk-load",
}));
await app.retrySceneStart();
expect(app.experience.objects.environment.manifest.id).toBe("elderboom-v1");
```

- [ ] **Step 2: Run desktop tests and verify RED**

Run: `npm test -- tests/desktop-app.test.js tests/asset-manifest.test.js`

Expected: FAIL because startup has only a generic refresh message and no generation ownership.

- [ ] **Step 3: Implement idempotent retry ownership**

Each start attempt owns an `AbortController` and incrementing generation. Retry aborts/disposes the previous attempt before starting one new attempt. A stale completion disposes itself and never assigns `this.experience`. Destroy aborts before normal runtime cleanup.

- [ ] **Step 4: Add restrained retry UI and local-asset diagnostic**

Use the existing pairing/loading surface, one `rotate-ccw` Lucide retry icon, and concise status text. Distinguish invalid manifest, missing generated chunk, and failed decode. Do not expose filesystem paths or source-license details in the in-game UI.

- [ ] **Step 5: Verify tracked manifests and optional local artifact**

`tests/asset-manifest.test.js` always validates the tracked village manifest and extraction configuration. When `VILLAGE_ASSETS_REQUIRED=1`, it also requires the generated chunk, exact byte count, and SHA-256 from the manifest.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/desktop-app.test.js tests/asset-manifest.test.js tests/controller-app.test.js tests/protocol.test.js`

Expected: PASS.

Commit: `fix: make village startup retryable`

---

### Task 9: Real Asset Verification, Visual Acceptance, And Full Regression

**Files:**
- Create: `scripts/verify-elderboom-village.mjs`
- Create: `.superpowers/sdd/village-visual-smoke.cjs`
- Create: `.superpowers/sdd/village-visual/report.json` (ignored evidence)
- Create: `.superpowers/sdd/village-visual/*.png` (ignored evidence)
- Modify: `.superpowers/sdd/progress.md` (ignored handoff record)
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks and generated local chunk.
- Produces: source/chunk integrity report, nonblank Three.js screenshots, fixed scene metrics, complete paired-input acceptance record, and current handoff status.

- [ ] **Step 1: Implement strict local asset verification**

The script validates source hash/size, generated GLB header/chunk lengths, manifest artifact hash/size, closed references, western-core bounds, required KHR extensions, `EXT_mesh_gpu_instancing`, unchanged retained image dimensions/bytes, no source-path leakage, no full-source copy, and report performance gates.

Run: `npm run verify:village`

Expected: PASS with one real chunk, source hash `0DFDDCB9...`, fewer than 450 draw calls, fewer than 9M expanded triangles, no more than 260 images, and 250-550 MiB output.

- [ ] **Step 2: Run all focused scene/interaction suites**

Run:

```powershell
npm test -- tests/environment-manifest.test.js tests/environment-loader.test.js tests/environment-colliders.test.js tests/village-route.test.js tests/village-scene.test.js tests/scene-props.test.js tests/player-controller.test.js tests/interaction.test.js tests/horror-director.test.js tests/shadow-quest.test.js tests/door-defense-director.test.js tests/found-phone-director.test.js tests/hand-tracking-director.test.js tests/desktop-app.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full automated suite and production build**

Run: `$env:VILLAGE_ASSETS_REQUIRED='1'; npm test`

Expected: all tests pass; existing Node GLTF texture-blob and Tailwind warnings may remain, but no new unresolved asset, schema, WebGL, or disposal warning is accepted.

Run: `npm run build`

Expected: Vite exits 0 and `dist/assets/environment/elderboom-v1/chunks/western-core.glb` exists with the manifest-recorded byte count/hash.

- [ ] **Step 4: Start a local server on an unused port**

Use this PowerShell flow and keep the returned process ID for cleanup. Do not start Cloudflare or any public tunnel.

```powershell
$villagePort = 4180
while (Get-NetTCPConnection -State Listen -LocalPort $villagePort -ErrorAction SilentlyContinue) {
  $villagePort += 1
}
$env:PORT = "$villagePort"
$villageServer = Start-Process npm -ArgumentList "run", "dev" -WorkingDirectory "D:\蝴蝶效应\corridor-617" -WindowStyle Hidden -PassThru
```

- [ ] **Step 5: Run Playwright desktop visual checks**

At 1920x1080, 1440x900, and 390x844, capture fixed manifest camera anchors showing the primary house, secondary house, well/path, flashlight off/on, every task prop, and the final door. Sample at least 48 WebGL pixels per view and require at least 8 unique RGB values and 75 percent non-background pixels. Assert no UI overlap and record console/network errors.

- [ ] **Step 6: Verify movement and live canvas behavior**

Use keyboard fallback only for automation. Move from spawn through the two turns to every task approach, confirm camera/position changes, confirm rendered pixels change after movement and flashlight toggle, and assert the imported root remains visible with finite world matrices. Stop the server process after screenshots.

- [ ] **Step 7: Perform paired phone acceptance when a handset is available**

Without changing the gyro algorithm, verify QR pairing, mandatory motion permission, joystick movement, flashlight, rear-camera denial fallback, physical-left-hand sink/phone/window/fuse/panel interactions, inventory equip/consume, and sustained door defense. Record unavailable physical-device checks explicitly rather than claiming them passed.

- [ ] **Step 8: Update handoff state and request independent review**

Record exact commits, source/chunk hashes, generated-asset location, automated counts, visual report path, physical-device status, known warnings, and the no-push/no-release rule in `.superpowers/sdd/progress.md`. Dispatch an independent reviewer over the complete village commit range; fix every Critical or Important finding with a failing regression test.

- [ ] **Step 9: Commit tracked verification/docs only**

Run: `git status --short` and `git diff --cached --check`.

Expected: no `.release/`, generated GLB, build report, screenshots, logs, source asset, or entitlement data is staged.

Commit: `test: verify real ElderBoom village integration`

---

## Final Review Checklist

- The rendered village is the real ElderBoom source subset, not procedural replacement geometry.
- The complete source GLB is outside the web repository and never served or packaged.
- Retained images keep source dimensions and bytes; retained architecture/props are not decimated.
- Dense repeated foliage is deterministically thinned and GPU-instanced.
- Generated licensed chunks and reports are ignored; the manifest/config/provenance boundary is tracked.
- The route contains the primary house, secondary structure, well/campfire/yard detail, at least two 90-degree turns, and a return to the final door.
- Rapier uses proxy boxes/capsules only; render meshes are not physics trimeshes.
- Occlusion uses curated proxies and never self-occludes an interactable anchor.
- Spawn, task transforms, story threats, shadow cinematic, and door defense are anchor/local-basis driven.
- Existing interaction IDs, target epochs, contact normals, hand ownership, inventory ownership, phone controls, and state-machine events remain stable.
- Missing/corrupt chunks fail with retry and dispose partial resources.
- Full tests, production build, Playwright screenshots, canvas pixel checks, movement checks, and available physical-phone checks are recorded with evidence.
- No GitHub push, Release, CI upload, public tunnel, or Fab subset distribution occurs without explicit authorization and archived entitlement evidence.
