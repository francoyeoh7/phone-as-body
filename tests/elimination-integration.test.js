import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

// Full wiring check: a bot registered by the EliminationDirector must be
// targetable and answer an E press. This catches registration/routing breaks
// that unit tests on either side miss.

if (!globalThis.document) {
  globalThis.document = { addEventListener: vi.fn(), removeEventListener: vi.fn(), pointerLockElement: null, exitPointerLock: vi.fn() };
}
if (!globalThis.window) globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

import { PlayerController } from "../src/desktop/PlayerController.js";
import { EliminationDirector } from "../src/desktop/game/EliminationDirector.js";

describe("elimination interaction integration", () => {
  it("targets a registered bot and routes E to onBotInteract", async () => {
    const scene = new THREE.Scene();
    const interactables = [];
    const onBotInteract = vi.fn();

    // A fake bot standing right in front of the camera.
    const botRoot = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshBasicMaterial());
    body.position.y = 0.9;
    botRoot.add(body);
    botRoot.userData.interactableId = "bot-1";
    botRoot.position.set(0, 0, -1.6);
    scene.add(botRoot);

    const bots = {
      bots: [{
        id: "bot-1",
        label: "猎手",
        root: botRoot,
        interaction: { anchor: botRoot, contactRadius: 0.4, maxUseDistance: 2.4, approachDirection: null, contactNormal: new THREE.Vector3(0, 1, 0) },
      }],
      load: vi.fn(async () => {}),
      update: vi.fn(),
      dispose: vi.fn(),
    };

    const experience = {
      scene,
      camera: new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 140),
      renderer: { domElement: { addEventListener: vi.fn(), requestPointerLock: vi.fn() } },
      interactables,
      spawn: { position: [0, 1.05, 0], yaw: 0 },
      RAPIER: null,
      world: null,
      objects: {},
    };

    const director = new EliminationDirector({
      experience,
      ui: { setObjective: vi.fn(), setPrompt: vi.fn(), setSubtitle: vi.fn(), setGameStatus: vi.fn() },
      audio: null,
      inventory: null,
      botFactory: () => bots,
      onBotInteract,
      rng: () => 0.5,
    });
    await director.load();

    // The bot must be registered as an interactable on the shared array.
    const botEntry = interactables.find((entry) => entry.id === "bot-1");
    expect(botEntry).toBeDefined();
    expect(botEntry.enabled).toBe(true);
    expect(botEntry.root).toBe(botRoot);

    // Player targeting picks it up and E routes to the callback.
    const player = new PlayerController({
      RAPIER: {
        RigidBodyDesc: { kinematicPositionBased: () => ({ setTranslation: vi.fn(() => ({})) }) },
        ColliderDesc: { capsule: vi.fn(() => ({})) },
      },
      world: {
        createRigidBody: vi.fn(() => ({ translation: vi.fn(() => ({ x: 0, y: 1.05, z: 0 })), setNextKinematicTranslation: vi.fn() })),
        createCollider: vi.fn(() => ({})),
        createCharacterController: vi.fn(() => ({
          enableAutostep: vi.fn(), enableSnapToGround: vi.fn(), setApplyImpulsesToDynamicBodies: vi.fn(),
          computeColliderMovement: vi.fn(), computedMovement: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        })),
        removeRigidBody: vi.fn(), removeCollider: vi.fn(), removeCharacterController: vi.fn(),
      },
      camera: experience.camera,
      renderer: experience.renderer,
      interactables,
      staticOccluderRoots: [],
      spawn: experience.spawn,
      onInteract: (id, details) => director.handleInteraction(id, details),
    });

    player.update(1 / 60);
    expect(player.selected?.id).toBe("bot-1");
    player.interact("keyboard");
    expect(onBotInteract).toHaveBeenCalledTimes(1);
    expect(onBotInteract.mock.calls[0][0].id).toBe("bot-1");
  });
});
