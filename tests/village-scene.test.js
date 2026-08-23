import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScene } from "../src/desktop/create-scene.js";
import { EnvironmentLoadError } from "../src/desktop/environment/EnvironmentLoader.js";
import { validateEnvironmentManifest } from "../src/desktop/environment/manifest.js";

const manifestUrl = new URL("../public/assets/environment/elderboom-v1/manifest.json", import.meta.url);

async function trackedManifest() {
  return validateEnvironmentManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
}

function canvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
  };
}

function installBrowserHarness() {
  const listeners = new Map();
  const fakeWindow = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    }),
  };
  const fakeDocument = {
    createElement: vi.fn(() => ({ width: 0, height: 0, getContext: vi.fn(() => canvasContext()) })),
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  return { fakeWindow };
}

function rendererHarness() {
  const renderer = {
    domElement: { dataset: {} },
    shadowMap: {},
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    dispose: vi.fn(),
  };
  return { renderer, rendererFactory: vi.fn(() => renderer) };
}

function softwareRendererHarness() {
  const { renderer, rendererFactory } = rendererHarness();
  const debugInfo = { UNMASKED_RENDERER_WEBGL: 0x9246 };
  const context = {
    RENDERER: 0x1f01,
    getExtension: vi.fn(() => debugInfo),
    getParameter: vi.fn((parameter) => parameter === debugInfo.UNMASKED_RENDERER_WEBGL
      ? "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11)"
      : "Microsoft Basic Render Driver"),
  };
  renderer.getContext = vi.fn(() => context);
  renderer.compileAsync = vi.fn(async () => {});
  return { renderer, rendererFactory };
}

function mainstreamRendererHarness() {
  const { renderer, rendererFactory } = rendererHarness();
  const debugInfo = { UNMASKED_RENDERER_WEBGL: 0x9246 };
  const context = {
    RENDERER: 0x1f01,
    getExtension: vi.fn(() => debugInfo),
    getParameter: vi.fn((parameter) => parameter === debugInfo.UNMASKED_RENDERER_WEBGL
      ? "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0)"
      : "GeForce GTX 1060"),
  };
  renderer.getContext = vi.fn(() => context);
  renderer.compileAsync = vi.fn(async () => {});
  return { renderer, rendererFactory };
}

function ownedHost() {
  return {
    current: null,
    replaceChildren: vi.fn(function replaceChildren(...children) {
      if (this.current) this.current.parentNode = null;
      this.current = children[0] ?? null;
      if (this.current) this.current.parentNode = this;
    }),
  };
}

function physicsHarness() {
  const worlds = [];
  class World {
    constructor(gravity) {
      this.gravity = gravity;
      this.free = vi.fn();
      this.createRigidBody = vi.fn(() => ({}));
      this.createCollider = vi.fn(() => ({}));
      worlds.push(this);
    }
  }
  const fixed = () => ({
    setTranslation() { return this; },
    setRotation() { return this; },
  });
  return {
    worlds,
    RAPIER: {
      init: vi.fn(async () => {}),
      World,
      RigidBodyDesc: { fixed },
      ColliderDesc: { cuboid: vi.fn(() => ({})) },
    },
  };
}

function semanticLights(manifest) {
  const all = [];
  const byId = {};
  const byRole = {};
  for (const definition of manifest.lights) {
    let light;
    if (definition.type === "hemisphere") {
      light = new THREE.HemisphereLight(definition.skyColor, definition.groundColor, definition.intensity);
    } else if (definition.type === "directional") {
      light = new THREE.DirectionalLight(definition.color, definition.intensity);
      light.castShadow = Boolean(definition.castShadow);
    } else {
      light = new THREE.PointLight(definition.color, definition.intensity, definition.distance, definition.decay);
    }
    light.name = definition.id;
    all.push(light);
    byId[definition.id] = light;
    (byRole[definition.role] ??= []).push(light);
  }
  return { all, byId, byRole };
}

function environmentHarness(manifest) {
  const root = new THREE.Group();
  root.name = "environment-elderboom-v1";
  const lights = semanticLights(manifest);
  const environment = {
    manifest,
    root,
    chunks: [{ id: "western-core", root: new THREE.Group() }],
    occluderRoots: [],
    anchors: Object.freeze({
      spawn: manifest.spawn,
      tasks: manifest.tasks,
      story: manifest.story,
      shadow: manifest.shadow,
    }),
    lights,
    dispose: vi.fn(() => root.removeFromParent()),
  };
  const loadEnvironment = vi.fn(async ({ scene }) => {
    scene.add(root, ...lights.all);
    return environment;
  });
  return { environment, loadEnvironment };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("real village scene assembly", () => {
  it("assembles the imported environment, gameplay props, and non-blocking village NPCs", async () => {
    const { fakeWindow } = installBrowserHarness();
    const manifest = await trackedManifest();
    const { renderer, rendererFactory } = rendererHarness();
    const physics = physicsHarness();
    const { environment, loadEnvironment } = environmentHarness(manifest);
    const occluder = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    const colliders = { colliders: [], rigidBodies: [], occluderRoots: [occluder], dispose: vi.fn() };
    const createEnvironmentColliders = vi.fn(() => colliders);
    const npcSystem = {
      roster: new Map(),
      load: vi.fn(() => new Promise(() => {})),
      update: vi.fn(),
      destroy: vi.fn(),
    };
    const createNpcSystem = vi.fn(() => npcSystem);
    const host = { replaceChildren: vi.fn() };

    const experience = await createScene(host, {
      RAPIER: physics.RAPIER,
      rendererFactory,
      loadEnvironment,
      createEnvironmentColliders,
      createNpcSystem,
    });

    expect(loadEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      scene: experience.scene,
      manifestUrl: "/assets/environment/elderboom-v1/manifest.json",
    }));
    expect(createEnvironmentColliders).toHaveBeenCalledWith(expect.objectContaining({
      RAPIER: physics.RAPIER,
      world: experience.world,
      manifest,
    }));
    expect(experience.objects.environment).toBe(environment);
    expect(createNpcSystem).toHaveBeenCalledWith({ scene: experience.scene });
    expect(npcSystem.load).toHaveBeenCalledOnce();
    expect(experience.objects.npcs).toBe(npcSystem);
    expect(experience.scene.children).toContain(environment.root);
    expect(experience.staticOccluderRoots).toEqual([occluder]);
    expect(experience.objects.corridor.anchors).toBe(environment.anchors);
    expect(experience.interactables.map(({ id }) => id)).toEqual([
      "fuse",
      "found-phone",
      "washbasin",
      "knock-door",
      "presentation-paper",
    ]);
    expect(experience.objects.fuse.root.position.toArray()).toEqual(manifest.tasks.fuse.position);
    expect(experience.objects.foundPhone.root.position.toArray()).toEqual(manifest.tasks["found-phone"].position);
    expect(experience.objects.washbasin.root.position.toArray()).toEqual(manifest.tasks.washbasin.position);
    expect(experience.objects.knockDoor.root.position.toArray()).toEqual(manifest.tasks["exit-door"].position);
    expect(experience.objects.knockDoor.interaction.contactNormal.toArray()).toEqual([0, 0, 1]);
    expect(experience.objects.fuse.interaction.contactNormal.toArray()).toEqual([0, 1, 0]);
    expect(experience.objects.fuse.interaction.maxUseDistance).toBe(2.35);
    expect(experience.objects).not.toHaveProperty("panel");
    expect(experience.objects).not.toHaveProperty("exitDoor");
    expect(experience.objects).not.toHaveProperty("shadowQuest");
    expect(experience.objects).not.toHaveProperty("silhouette");
    expect(experience.scene.getObjectByName("exit-door")).toBeUndefined();
    expect(experience.scene.children.some((root) => root.userData?.corridorSegment)).toBe(false);
    expect(experience.objects.ceilingLights).toBe(environment.lights.byRole["power-sequence"]);
    expect(experience.objects.emergencyLights).toBe(environment.lights.byRole.emergency);
    expect(experience.objects.stormLight).toBe(environment.lights.byRole.storm[0]);
    expect(experience.objects.hemi).toBe(environment.lights.byId["night-hemi"]);
    expect(experience.spawn).toBe(manifest.spawn);
    expect(experience.camera.far).toBe(140);
    expect(experience.camera.position.toArray()).toEqual([6.5, 1.6, -2]);
    expect(experience.camera.rotation.y).toBeCloseTo(0, 8);
    expect(host.replaceChildren).toHaveBeenCalledWith(renderer.domElement);
    expect(experience.renderProfile).toEqual(expect.objectContaining({ kind: "unknown", pixelRatioCap: 0.9 }));
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(0.9);
    const resize = fakeWindow.addEventListener.mock.calls.find(([type]) => type === "resize")[1];
    resize();
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(0.9);
    const flashlightCookieDispose = vi.spyOn(experience.objects.flashlightCore.map, "dispose");

    experience.update(0.25, 2);
    expect(npcSystem.update).toHaveBeenCalledWith(0.25, 2, experience.camera.position);

    experience.dispose();
    experience.dispose();
    expect(environment.dispose).toHaveBeenCalledOnce();
    expect(colliders.dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(physics.worlds[0].free).toHaveBeenCalledOnce();
    expect(flashlightCookieDispose).toHaveBeenCalledOnce();
    expect(npcSystem.destroy).toHaveBeenCalledOnce();
  });

  it("forwards the requested quality level and swaps environments live", async () => {
    installBrowserHarness();
    const manifest = await trackedManifest();
    const { renderer, rendererFactory } = rendererHarness();
    const physics = physicsHarness();
    const first = environmentHarness(manifest);
    const second = environmentHarness(manifest);
    const colliders = { colliders: [], rigidBodies: [], occluderRoots: [], dispose: vi.fn() };
    const npcSystem = { load: vi.fn(() => new Promise(() => {})), update: vi.fn(), destroy: vi.fn() };
    const loadEnvironment = vi.fn(async ({ scene, quality }) => {
      const harness = quality === "high" ? second : first;
      scene.add(harness.environment.root, ...harness.environment.lights.all);
      return harness.environment;
    });

    const experience = await createScene({ replaceChildren: vi.fn() }, {
      RAPIER: physics.RAPIER,
      rendererFactory,
      loadEnvironment,
      createEnvironmentColliders: vi.fn(() => colliders),
      createNpcSystem: () => npcSystem,
      environmentQuality: "balanced",
    });

    expect(loadEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ quality: "balanced" }));
    expect(experience.environmentQuality).toBe("balanced");
    expect(experience.objects.environment).toBe(first.environment);

    await expect(experience.setEnvironmentQuality("extreme")).rejects.toThrow(/quality/i);

    const swapped = await experience.setEnvironmentQuality("high");
    expect(loadEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ quality: "high" }));
    expect(swapped).toBe(second.environment);
    expect(experience.environmentQuality).toBe("high");
    expect(experience.objects.environment).toBe(second.environment);
    expect(experience.objects.ceilingLights).toBe(second.environment.lights.byRole["power-sequence"]);
    expect(experience.objects.emergencyLights).toBe(second.environment.lights.byRole.emergency);
    expect(experience.objects.corridor.anchors).toBe(second.environment.anchors);
    expect(first.environment.dispose).toHaveBeenCalledOnce();
    expect(experience.scene.children).toContain(second.environment.root);
    expect(experience.scene.children).not.toContain(first.environment.root);

    await experience.setEnvironmentQuality("high");
    expect(loadEnvironment).toHaveBeenCalledTimes(2);

    experience.dispose();
    expect(second.environment.dispose).toHaveBeenCalledOnce();
  });

  it("automatically enters a low-cost profile for software WebGL without blocking scene startup", async () => {
    installBrowserHarness();
    const manifest = await trackedManifest();
    const { renderer, rendererFactory } = softwareRendererHarness();
    const physics = physicsHarness();
    const { environment, loadEnvironment } = environmentHarness(manifest);
    const colliders = { colliders: [], rigidBodies: [], occluderRoots: [], dispose: vi.fn() };
    const npcSystem = { load: vi.fn(() => new Promise(() => {})), update: vi.fn(), destroy: vi.fn() };
    const experience = await createScene({ replaceChildren: vi.fn() }, {
      RAPIER: physics.RAPIER,
      rendererFactory,
      loadEnvironment,
      createEnvironmentColliders: vi.fn(() => colliders),
      createNpcSystem: () => npcSystem,
    });

    expect(experience.renderProfile).toEqual(expect.objectContaining({ kind: "software", pixelRatioCap: 0.75 }));
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(0.75);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.compileAsync).not.toHaveBeenCalled();
    experience.dispose();
  });

  it("enters a mainstream profile that tightens fog, drops moon shadows, and distance-culls far geometry", async () => {
    installBrowserHarness();
    const manifest = await trackedManifest();
    const { renderer, rendererFactory } = mainstreamRendererHarness();
    const physics = physicsHarness();
    const { environment, loadEnvironment } = environmentHarness(manifest);
    const environmentRoot = new THREE.Group();
    const nearMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    nearMesh.position.set(6, 0, -2);
    const farMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    farMesh.position.set(6, 0, -95);
    environmentRoot.add(nearMesh, farMesh);
    environment.root.add(environmentRoot);
    const colliders = { colliders: [], rigidBodies: [], occluderRoots: [], dispose: vi.fn() };
    const npcSystem = { load: vi.fn(() => new Promise(() => {})), update: vi.fn(), destroy: vi.fn() };

    const experience = await createScene({ replaceChildren: vi.fn() }, {
      RAPIER: physics.RAPIER,
      rendererFactory,
      loadEnvironment,
      createEnvironmentColliders: vi.fn(() => colliders),
      createNpcSystem: () => npcSystem,
    });

    expect(experience.renderProfile).toEqual(expect.objectContaining({
      kind: "mainstream",
      pixelRatioCap: 0.75,
      environmentCullDistance: 48,
      foliageCullDistance: 28,
    }));
    expect(loadEnvironment).toHaveBeenCalledWith(expect.objectContaining({ quality: "low" }));
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(0.75);
    expect(experience.scene.fog.far).toBeLessThanOrEqual(48);
    expect(experience.camera.far).toBeLessThan(140);
    const moon = experience.objects.environment.lights.byId["moon-key"];
    expect(moon.castShadow).toBe(false);

    expect(farMesh.visible).toBe(false);
    expect(nearMesh.visible).toBe(true);

    experience.update(0.016, 0.02);
    expect(farMesh.visible).toBe(false);
    experience.dispose();
  });

  it("rolls back renderer and Rapier ownership when environment loading fails", async () => {
    installBrowserHarness();
    const { renderer, rendererFactory } = rendererHarness();
    const physics = physicsHarness();
    const failure = new EnvironmentLoadError("chunk-load", "missing", { chunkId: "western-core" });
    const host = { replaceChildren: vi.fn() };

    await expect(createScene(host, {
      RAPIER: physics.RAPIER,
      rendererFactory,
      loadEnvironment: vi.fn(async () => { throw failure; }),
      createEnvironmentColliders: vi.fn(),
    })).rejects.toBe(failure);

    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(physics.worlds[0].free).toHaveBeenCalledOnce();
    expect(host.replaceChildren).toHaveBeenLastCalledWith();
  });

  it("does not clear a newer renderer when a stale scene disposes", async () => {
    installBrowserHarness();
    const manifest = await trackedManifest();
    const firstRenderer = rendererHarness();
    const secondRenderer = rendererHarness();
    const firstEnvironment = environmentHarness(manifest);
    const secondEnvironment = environmentHarness(manifest);
    const firstPhysics = physicsHarness();
    const secondPhysics = physicsHarness();
    const host = ownedHost();

    const first = await createScene(host, {
      RAPIER: firstPhysics.RAPIER,
      rendererFactory: firstRenderer.rendererFactory,
      loadEnvironment: firstEnvironment.loadEnvironment,
      createEnvironmentColliders: vi.fn(() => ({ colliders: [], rigidBodies: [], occluderRoots: [], dispose: vi.fn() })),
    });
    const second = await createScene(host, {
      RAPIER: secondPhysics.RAPIER,
      rendererFactory: secondRenderer.rendererFactory,
      loadEnvironment: secondEnvironment.loadEnvironment,
      createEnvironmentColliders: vi.fn(() => ({ colliders: [], rigidBodies: [], occluderRoots: [], dispose: vi.fn() })),
    });

    first.dispose();
    expect(host.current).toBe(secondRenderer.renderer.domElement);

    second.dispose();
    expect(host.current).toBeNull();
  });
});
