import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateEnvironmentManifest } from "./manifest.js";
import {
  disposeEnvironmentResources,
  ENVIRONMENT_TEXTURE_SLOTS,
} from "./resources.js";

const ERROR_CODES = new Set([
  "manifest-fetch",
  "manifest-invalid",
  "chunk-load",
  "chunk-invalid",
]);
const FALLBACK_ORIGIN = "http://localhost/";
const ENVIRONMENT_ANISOTROPY = 2;
const MOON_SHADOW_EXTENT = 22;

export class EnvironmentLoadError extends Error {
  constructor(code, message, { cause, chunkId, url, status, phase } = {}) {
    if (!ERROR_CODES.has(code)) throw new TypeError(`Unknown environment load error code: ${code}`);
    super(message);
    this.name = "EnvironmentLoadError";
    this.code = code;
    this.retryable = true;
    if (cause !== undefined) this.cause = cause;
    if (chunkId !== undefined) this.chunkId = chunkId;
    if (url !== undefined) this.url = url;
    if (status !== undefined) this.status = status;
    if (phase !== undefined) this.phase = phase;
  }
}

function abortReason(signal) {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === "AbortError";
}

function absoluteUrl(value, base = globalThis.location?.href ?? FALLBACK_ORIGIN) {
  return new URL(value, base).href;
}

async function digestSha256(buffer) {
  if (!globalThis.crypto?.subtle?.digest) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function fetchManifest({ manifestUrl, fetchImpl, signal, validateManifest }) {
  const resolvedUrl = absoluteUrl(manifestUrl);
  let response;
  try {
    throwIfAborted(signal);
    response = await fetchImpl(resolvedUrl, { signal });
    throwIfAborted(signal);
  } catch (cause) {
    throw new EnvironmentLoadError("manifest-fetch", "Unable to fetch the environment manifest", {
      cause,
      url: resolvedUrl,
      phase: isAbort(cause, signal) ? "abort" : "request",
    });
  }
  if (!response?.ok) {
    throw new EnvironmentLoadError(
      "manifest-fetch",
      `Environment manifest request failed with status ${response?.status ?? "unknown"}`,
      { url: resolvedUrl, status: response?.status, phase: "response" },
    );
  }

  let value;
  try {
    value = await response.json();
  } catch (cause) {
    throw new EnvironmentLoadError("manifest-invalid", "Environment manifest is not valid JSON", {
      cause,
      url: resolvedUrl,
      phase: "decode",
    });
  }

  try {
    return {
      manifest: validateManifest(value),
      manifestUrl: absoluteUrl(response.url || resolvedUrl, resolvedUrl),
    };
  } catch (cause) {
    throw new EnvironmentLoadError("manifest-invalid", "Environment manifest failed validation", {
      cause,
      url: resolvedUrl,
      phase: "validate",
    });
  }
}

function parseWithAbort(loader, buffer, resourcePath, signal) {
  throwIfAborted(signal);
  const parsing = Promise.resolve().then(() => loader.parseAsync(buffer, resourcePath));
  if (!signal) return parsing;

  return new Promise((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    parsing.then(
      (gltf) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted) {
          disposeEnvironmentResources(gltf?.scene);
          return;
        }
        resolve(gltf);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

function prepareChunkRoot(root, prefixes, chunkId) {
  if (!root?.isObject3D || typeof root.traverse !== "function") {
    throw new TypeError(`Chunk ${chunkId} did not decode to a Three.js scene root`);
  }
  root.userData.environmentChunkId = chunkId;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.receiveShadow = true;
    const semanticNames = [object.name, object.geometry?.name, object.parent?.name]
      .filter((name) => typeof name === "string" && name.length > 0);
    object.castShadow = prefixes.some((prefix) => (
      semanticNames.some((name) => name.startsWith(prefix))
    ));

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const slot of ENVIRONMENT_TEXTURE_SLOTS) {
        const texture = material?.[slot];
        if (texture?.isTexture) texture.anisotropy = Math.min(texture.anisotropy || 1, ENVIRONMENT_ANISOTROPY);
      }
    }
  });
  return root;
}

function configureDirectionalShadow(light) {
  light.shadow.mapSize.set(1024, 1024);
  const camera = light.shadow.camera;
  camera.left = -MOON_SHADOW_EXTENT;
  camera.right = MOON_SHADOW_EXTENT;
  camera.top = MOON_SHADOW_EXTENT;
  camera.bottom = -MOON_SHADOW_EXTENT;
  camera.near = 0.5;
  camera.far = 90;
  camera.updateProjectionMatrix();
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.035;
  light.shadow.radius = 2;
}

function createLightRegistry(definitions) {
  const root = new THREE.Group();
  root.name = "environment-semantic-lights";
  const all = [];
  const byId = {};
  const byRole = {};

  for (const definition of definitions) {
    let light;
    if (definition.type === "hemisphere") {
      light = new THREE.HemisphereLight(
        definition.skyColor,
        definition.groundColor,
        definition.intensity,
      );
    } else if (definition.type === "directional") {
      light = new THREE.DirectionalLight(definition.color, definition.intensity);
      light.position.fromArray(definition.position);
      light.target.position.fromArray(definition.target);
      light.castShadow = definition.castShadow;
      if (light.castShadow) configureDirectionalShadow(light);
      light.target.name = `${definition.id}-target`;
      root.add(light.target);
    } else {
      light = new THREE.PointLight(
        definition.color,
        definition.intensity,
        definition.distance,
        definition.decay,
      );
      light.position.fromArray(definition.position);
      light.castShadow = definition.castShadow;
    }
    light.name = definition.id;
    light.userData.environmentLightId = definition.id;
    light.userData.environmentLightRole = definition.role;
    root.add(light);
    all.push(light);
    byId[definition.id] = light;
    (byRole[definition.role] ??= []).push(light);
  }

  return { root, all, byId, byRole };
}

function createOccluderRoots(manifest) {
  const colliders = new Map(manifest.colliders.map((entry) => [entry.id, entry]));
  return manifest.occluders.map((definition) => {
    const collider = colliders.get(definition.colliderId);
    const root = new THREE.Object3D();
    root.name = definition.id;
    root.visible = false;
    root.position.fromArray(collider.position);
    root.quaternion.fromArray(collider.rotation);
    root.userData.environmentOccluder = true;
    root.userData.environmentOccluderId = definition.id;
    root.userData.colliderId = definition.colliderId;
    return root;
  });
}

function createAnchors(manifest) {
  return Object.freeze({
    spawn: manifest.spawn,
    tasks: manifest.tasks,
    story: manifest.story,
    shadow: manifest.shadow,
  });
}

function disposeLightRegistry(registry) {
  for (const light of registry?.all ?? []) {
    light.shadow?.map?.dispose?.();
    light.shadow?.mapPass?.dispose?.();
  }
  registry?.root?.removeFromParent();
}

async function loadChunk({ chunk, baseUrl, fetchImpl, loader, signal }) {
  const url = absoluteUrl(chunk.url, baseUrl);
  let response;
  let buffer;
  try {
    throwIfAborted(signal);
    response = await fetchImpl(url, { signal });
    throwIfAborted(signal);
    if (!response?.ok) {
      throw new EnvironmentLoadError("chunk-load", `Unable to load environment chunk ${chunk.id}`, {
        chunkId: chunk.id,
        url,
        status: response?.status,
        phase: "response",
      });
    }
    buffer = await response.arrayBuffer();
    throwIfAborted(signal);
  } catch (cause) {
    if (cause instanceof EnvironmentLoadError) throw cause;
    throw new EnvironmentLoadError("chunk-load", `Unable to load environment chunk ${chunk.id}`, {
      cause,
      chunkId: chunk.id,
      url,
      phase: isAbort(cause, signal) ? "abort" : "request",
    });
  }

  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== chunk.artifact.bytes) {
    throw new EnvironmentLoadError(
      "chunk-invalid",
      `Environment chunk ${chunk.id} has an unexpected byte length`,
      { chunkId: chunk.id, url, phase: "validate" },
    );
  }

  try {
    const digest = await digestSha256(buffer);
    throwIfAborted(signal);
    if (digest && digest !== chunk.artifact.sha256) {
      throw new Error("Environment chunk SHA-256 does not match its manifest");
    }
  } catch (cause) {
    const aborted = isAbort(cause, signal);
    throw new EnvironmentLoadError(aborted ? "chunk-load" : "chunk-invalid", `Environment chunk ${chunk.id} failed integrity validation`, {
      cause,
      chunkId: chunk.id,
      url,
      phase: aborted ? "abort" : "integrity",
    });
  }

  let gltf;
  try {
    gltf = await parseWithAbort(loader, buffer, absoluteUrl(".", url), signal);
    throwIfAborted(signal);
    return {
      id: chunk.id,
      root: prepareChunkRoot(gltf?.scene, chunk.castShadowNamePrefixes, chunk.id),
      gltf,
      url,
      bytes: buffer.byteLength,
    };
  } catch (cause) {
    if (gltf?.scene) disposeEnvironmentResources(gltf.scene);
    const code = isAbort(cause, signal) ? "chunk-load" : "chunk-invalid";
    throw new EnvironmentLoadError(code, `Unable to decode environment chunk ${chunk.id}`, {
      cause,
      chunkId: chunk.id,
      url,
      phase: isAbort(cause, signal) ? "abort" : "decode",
    });
  }
}

export async function loadEnvironment({
  scene,
  manifestUrl,
  fetchImpl = globalThis.fetch,
  loader = new GLTFLoader(),
  signal,
  onProgress,
  validateManifest = validateEnvironmentManifest,
} = {}) {
  if (!scene?.isScene || typeof scene.add !== "function") {
    throw new TypeError("loadEnvironment requires a Three.js Scene");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("loadEnvironment requires a fetch implementation");
  }
  if (!loader || typeof loader.parseAsync !== "function") {
    throw new TypeError("loadEnvironment requires a loader with parseAsync");
  }

  const fetched = await fetchManifest({ manifestUrl, fetchImpl, signal, validateManifest });
  const { manifest } = fetched;
  const parsed = [];
  const totalBytes = manifest.chunks.reduce((sum, chunk) => sum + chunk.artifact.bytes, 0);
  let loadedBytes = 0;
  let root;
  let lights;
  let occluderRoots = [];

  try {
    for (const chunk of manifest.chunks) {
      const loaded = await loadChunk({
        chunk,
        baseUrl: fetched.manifestUrl,
        fetchImpl,
        loader,
        signal,
      });
      parsed.push(loaded);
      loadedBytes += loaded.bytes;
      onProgress?.({
        chunkId: chunk.id,
        completedChunks: parsed.length,
        totalChunks: manifest.chunks.length,
        loadedBytes,
        totalBytes,
        ratio: totalBytes === 0 ? 1 : loadedBytes / totalBytes,
      });
    }

    throwIfAborted(signal);
    root = new THREE.Group();
    root.name = `environment-${manifest.id}`;
    root.position.fromArray(manifest.rootTransform.position);
    root.quaternion.fromArray(manifest.rootTransform.rotation);
    root.scale.fromArray(manifest.rootTransform.scale);
    root.add(...parsed.map((entry) => entry.root));

    lights = createLightRegistry(manifest.lights);
    occluderRoots = createOccluderRoots(manifest);
    scene.add(root, lights.root, ...occluderRoots);
  } catch (error) {
    root?.removeFromParent();
    lights?.root?.removeFromParent();
    for (const occluderRoot of occluderRoots) occluderRoot.removeFromParent();
    disposeEnvironmentResources(parsed.map((entry) => entry.root));
    disposeLightRegistry(lights);
    if (error instanceof EnvironmentLoadError) throw error;
    const chunkId = parsed.at(-1)?.id ?? manifest.chunks[0]?.id;
    throw new EnvironmentLoadError(
      isAbort(error, signal) ? "chunk-load" : "chunk-invalid",
      "Unable to assemble the environment",
      { cause: error, chunkId },
    );
  }

  let disposed = false;
  return {
    manifest,
    root,
    chunks: parsed,
    occluderRoots,
    anchors: createAnchors(manifest),
    lights: {
      all: lights.all,
      byId: lights.byId,
      byRole: lights.byRole,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const occluderRoot of occluderRoots) occluderRoot.removeFromParent();
      disposeLightRegistry(lights);
      disposeEnvironmentResources(parsed.map((entry) => entry.root));
    },
  };
}
