import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PlayerController } from "../src/desktop/PlayerController.js";

if (!globalThis.document) {
  globalThis.document = { addEventListener: vi.fn(), removeEventListener: vi.fn(), pointerLockElement: null };
}
if (!globalThis.window) globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

function makeWorld() {
  return {
    createRigidBody: vi.fn(() => ({ translation: vi.fn(() => ({ x: 0, y: 1.05, z: 0 })), setNextKinematicTranslation: vi.fn() })),
    createCollider: vi.fn(() => ({})),
    createCharacterController: vi.fn(() => ({
      enableAutostep: vi.fn(),
      enableSnapToGround: vi.fn(),
      setApplyImpulsesToDynamicBodies: vi.fn(),
      computeColliderMovement: vi.fn(),
      computedMovement: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    })),
    removeRigidBody: vi.fn(),
    removeCollider: vi.fn(),
    removeCharacterController: vi.fn(),
  };
}

function makePlayer(interactables, onInteract) {
  const renderer = { domElement: { addEventListener: vi.fn(), requestPointerLock: vi.fn() } };
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 140);
  return new PlayerController({
    RAPIER: { RigidBodyDesc: { kinematicPositionBased: () => ({ setTranslation: vi.fn(() => ({})) }) }, ColliderDesc: { capsule: vi.fn(() => ({})) } },
    world: makeWorld(),
    camera,
    renderer,
    interactables,
    staticOccluderRoots: [],
    spawn: { position: [0, 1.05, 0], yaw: 0 },
    onInteract,
  });
}

describe("E interaction end to end", () => {
  it("fires onInteract for a targeted bot entry", () => {
    const onInteract = vi.fn();
    const botRoot = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshBasicMaterial());
    body.position.y = 0.9;
    botRoot.add(body);
    botRoot.userData.interactableId = "bot-1";
    const scene = new THREE.Scene();
    scene.add(botRoot);
    botRoot.position.set(0, 0, -1.5); // directly ahead of the camera (camera looks -Z)

    const player = makePlayer([{
      id: "bot-1",
      label: "猎手",
      enabled: true,
      root: botRoot,
      interaction: { anchor: botRoot, contactRadius: 0.4, maxUseDistance: 2.4 },
    }], onInteract);

    player.update(1 / 60);
    expect(player.selected?.id).toBe("bot-1");
    player.interact("keyboard");
    expect(onInteract).toHaveBeenCalledWith("bot-1", expect.objectContaining({ source: "keyboard" }));
  });
});
