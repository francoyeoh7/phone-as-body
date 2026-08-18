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
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1.25);
    const resize = fakeWindow.addEventListener.mock.calls.find(([type]) => type === "resize")[1];
    resize();
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.25);
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
