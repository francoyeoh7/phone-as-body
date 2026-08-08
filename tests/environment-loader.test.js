import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  EnvironmentLoadError,
  loadEnvironment,
} from "../src/desktop/environment/EnvironmentLoader.js";

const manifestPath = new URL(
  "../public/assets/environment/elderboom-v1/manifest.json",
  import.meta.url,
);

const PBR_TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "lightMap",
  "specularIntensityMap",
  "specularColorMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "anisotropyMap",
  "envMap",
];

async function manifestFixture(chunkBytes = 4) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.chunks[0].artifact.bytes = chunkBytes;
  return manifest;
}

function jsonResponse(value, url = "https://game.test/assets/environment/elderboom-v1/manifest.json") {
  return {
    ok: true,
    status: 200,
    url,
    json: vi.fn(async () => structuredClone(value)),
  };
}

function bufferResponse(bytes, url, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    url,
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )),
  };
}

function renderRoot(name = "chunk-root") {
  const root = new THREE.Group();
  root.name = name;

  const selected = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  selected.name = "SM_House_Main";
  selected.position.set(1, 2, 3);

  const decorative = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  decorative.name = "VillageRock";
  decorative.castShadow = true;
  root.add(selected, decorative);
  return { root, selected, decorative };
}

function makeFetch(manifest, chunkResponses) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return jsonResponse(manifest, String(url));
    const response = chunkResponses[calls.length - 2];
    return typeof response === "function" ? response(String(url), options) : response;
  });
  return { fetchImpl, calls };
}

describe("EnvironmentLoader", () => {
  it("validates, resolves, prepares, and atomically attaches the village environment", async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    const manifest = await manifestFixture(bytes.byteLength);
    const { root: chunkRoot, selected, decorative } = renderRoot();
    const loader = { parseAsync: vi.fn(async () => ({ scene: chunkRoot })) };
    const { fetchImpl, calls } = makeFetch(manifest, [
      (url) => bufferResponse(bytes, url),
    ]);
    const scene = new THREE.Scene();
    const controller = new AbortController();
    const progress = vi.fn();

    const instance = await loadEnvironment({
      scene,
      manifestUrl: "https://game.test/app/village-manifest.json",
      fetchImpl,
      loader,
      signal: controller.signal,
      onProgress: progress,
    });

    expect(calls.map(({ url }) => url)).toEqual([
      "https://game.test/app/village-manifest.json",
      "https://game.test/assets/environment/elderboom-v1/chunks/western-core.glb",
    ]);
    expect(calls.every(({ options }) => options.signal === controller.signal)).toBe(true);
    expect(loader.parseAsync).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "https://game.test/assets/environment/elderboom-v1/chunks/",
    );
    expect(scene.children).toContain(instance.root);
    expect(instance.root.children).toContain(chunkRoot);
    expect(instance.root.position.toArray()).toEqual(manifest.rootTransform.position);
    expect(instance.root.quaternion.toArray()).toEqual(manifest.rootTransform.rotation);
    expect(instance.root.scale.toArray()).toEqual(manifest.rootTransform.scale);
    expect(chunkRoot.position.toArray()).toEqual([0, 0, 0]);
    expect(selected.position.toArray()).toEqual([1, 2, 3]);
    expect(selected.receiveShadow).toBe(true);
    expect(selected.castShadow).toBe(true);
    expect(decorative.receiveShadow).toBe(true);
    expect(decorative.castShadow).toBe(false);
    expect(instance.chunks.map(({ id }) => id)).toEqual(["western-core"]);
    expect(instance.lights.byId["moon-key"].isDirectionalLight).toBe(true);
    expect(instance.lights.byRole.moon).toHaveLength(2);
    expect(instance.anchors.tasks.panel).toBe(instance.manifest.tasks.panel);
    expect(instance.anchors.story).toBe(instance.manifest.story);
    expect(instance.occluderRoots).toHaveLength(instance.manifest.occluders.length);
    expect(instance.occluderRoots.every((root) => root.userData.environmentOccluder)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({
      chunkId: "western-core",
      completedChunks: 1,
      totalChunks: 1,
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      ratio: 1,
    });
  });

  it("keeps manifest chunk order and reports aggregate progress", async () => {
    const manifest = await manifestFixture(2);
    manifest.chunks.push({
      ...structuredClone(manifest.chunks[0]),
      id: "yard-detail",
      url: "/assets/environment/elderboom-v1/chunks/yard-detail.glb",
      artifact: {
        ...manifest.chunks[0].artifact,
        bytes: 3,
      },
    });
    const first = new Uint8Array([1, 1]);
    const second = new Uint8Array([2, 2, 2]);
    const roots = [renderRoot("first").root, renderRoot("second").root];
    const loader = {
      parseAsync: vi.fn(async (buffer) => ({
        scene: roots[new Uint8Array(buffer)[0] - 1],
      })),
    };
    const { fetchImpl } = makeFetch(manifest, [
      (url) => bufferResponse(first, url),
      (url) => bufferResponse(second, url),
    ]);
    const progress = vi.fn();

    const instance = await loadEnvironment({
      scene: new THREE.Scene(),
      manifestUrl: "https://game.test/manifest.json",
      fetchImpl,
      loader,
      onProgress: progress,
      validateManifest: (value) => value,
    });

    expect(instance.chunks.map(({ id, root }) => [id, root.name])).toEqual([
      ["western-core", "first"],
      ["yard-detail", "second"],
    ]);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      {
        chunkId: "western-core",
        completedChunks: 1,
        totalChunks: 2,
        loadedBytes: 2,
        totalBytes: 5,
        ratio: 0.4,
      },
      {
        chunkId: "yard-detail",
        completedChunks: 2,
        totalChunks: 2,
        loadedBytes: 5,
        totalBytes: 5,
        ratio: 1,
      },
    ]);
  });

  it.each([
    [
      "manifest-fetch",
      async () => ({
        fetchImpl: vi.fn(async () => ({ ok: false, status: 503, url: "https://game.test/manifest.json" })),
      }),
    ],
    [
      "manifest-invalid",
      async () => ({
        fetchImpl: vi.fn(async (url) => jsonResponse({ id: "wrong" }, String(url))),
      }),
    ],
    [
      "chunk-load",
      async () => {
        const manifest = await manifestFixture(4);
        return makeFetch(manifest, [
          (url) => bufferResponse(new Uint8Array(), url, { ok: false, status: 404 }),
        ]);
      },
    ],
    [
      "chunk-invalid",
      async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const manifest = await manifestFixture(bytes.byteLength);
        return {
          ...makeFetch(manifest, [(url) => bufferResponse(bytes, url)]),
          loader: { parseAsync: vi.fn(async () => { throw new Error("bad GLB"); }) },
        };
      },
    ],
  ])("classifies %s as a retryable environment error", async (code, arrange) => {
    const harness = await arrange();
    const loading = loadEnvironment({
      scene: new THREE.Scene(),
      manifestUrl: "https://game.test/manifest.json",
      fetchImpl: harness.fetchImpl,
      loader: harness.loader ?? { parseAsync: vi.fn() },
    });

    await expect(loading).rejects.toMatchObject({
      name: "EnvironmentLoadError",
      code,
      retryable: true,
    });
  });

  it("cleans an earlier parsed chunk when a later chunk fails without attaching partial roots", async () => {
    const manifest = await manifestFixture(2);
    manifest.chunks.push({
      ...structuredClone(manifest.chunks[0]),
      id: "broken-core",
      url: "/assets/environment/elderboom-v1/chunks/broken-core.glb",
    });
    const bytes = new Uint8Array([1, 1]);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const successfulPartialRoot = new THREE.Group();
    successfulPartialRoot.add(new THREE.Mesh(geometry, material));
    const loader = { parseAsync: vi.fn(async () => ({ scene: successfulPartialRoot })) };
    const { fetchImpl } = makeFetch(manifest, [
      (url) => bufferResponse(bytes, url),
      (url) => bufferResponse(new Uint8Array(), url, { ok: false, status: 500 }),
    ]);
    const scene = new THREE.Scene();

    const loading = loadEnvironment({
      scene,
      manifestUrl: "https://game.test/manifest.json",
      fetchImpl,
      loader,
      validateManifest: (value) => value,
    });

    await expect(loading).rejects.toMatchObject({
      name: "EnvironmentLoadError",
      code: "chunk-load",
      retryable: true,
      chunkId: "broken-core",
    });
    expect(scene.children).not.toContain(successfulPartialRoot);
    expect(successfulPartialRoot.parent).toBeNull();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("aborts parse ownership and disposes a chunk that resolves after cancellation", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const manifest = await manifestFixture(bytes.byteLength);
    const root = renderRoot("late-root").root;
    const disposers = [];
    root.traverse((object) => {
      if (object.geometry) disposers.push(vi.spyOn(object.geometry, "dispose"));
      if (object.material) disposers.push(vi.spyOn(object.material, "dispose"));
    });
    let resolveParse;
    let markParseStarted;
    const parseStarted = new Promise((resolve) => { markParseStarted = resolve; });
    const parseResult = new Promise((resolve) => { resolveParse = resolve; });
    const loader = {
      parseAsync: vi.fn(() => {
        markParseStarted();
        return parseResult;
      }),
    };
    const { fetchImpl } = makeFetch(manifest, [
      (url) => bufferResponse(bytes, url),
    ]);
    const scene = new THREE.Scene();
    const controller = new AbortController();

    const loading = loadEnvironment({
      scene,
      manifestUrl: "https://game.test/manifest.json",
      fetchImpl,
      loader,
      signal: controller.signal,
    });
    await parseStarted;
    controller.abort();

    await expect(loading).rejects.toMatchObject({
      name: "EnvironmentLoadError",
      code: "chunk-load",
      retryable: true,
    });
    resolveParse({ scene: root });
    await parseResult;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.children).not.toContain(root);
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("deduplicates geometry, materials, and every owned PBR texture during idempotent disposal", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const manifest = await manifestFixture(bytes.byteLength);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const sharedTexture = new THREE.Texture();
    const textures = PBR_TEXTURE_SLOTS.map((slot, index) => {
      const texture = index < 2 ? sharedTexture : new THREE.Texture();
      material[slot] = texture;
      return texture;
    });
    const textureDisposers = [...new Set(textures)].map((texture) => vi.spyOn(texture, "dispose"));
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(geometry, [material, material]),
      new THREE.Mesh(geometry, material),
    );
    const loader = { parseAsync: vi.fn(async () => ({ scene: root })) };
    const { fetchImpl } = makeFetch(manifest, [
      (url) => bufferResponse(bytes, url),
    ]);
    const scene = new THREE.Scene();

    const instance = await loadEnvironment({
      scene,
      manifestUrl: "https://game.test/manifest.json",
      fetchImpl,
      loader,
    });
    instance.dispose();
    instance.dispose();

    expect(scene.children).not.toContain(instance.root);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDisposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("exposes the documented error type", () => {
    const error = new EnvironmentLoadError("chunk-load", "failed", { chunkId: "western-core" });
    expect(error).toMatchObject({
      name: "EnvironmentLoadError",
      code: "chunk-load",
      retryable: true,
      chunkId: "western-core",
    });
  });
});
