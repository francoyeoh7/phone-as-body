import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createExitDoor } from "../src/desktop/ExitDoor.js";
import { createFoundPhoneProp } from "../src/desktop/FoundPhoneProp.js";
import * as sceneModule from "../src/desktop/create-scene.js";

function createPhysicsHarness() {
  const bodyDescriptor = {
    translation: null,
    setTranslation(x, y, z) {
      this.translation = [x, y, z];
      return this;
    },
  };
  const colliderDescriptor = { halfExtents: null };
  const RAPIER = {
    RigidBodyDesc: { fixed: vi.fn(() => bodyDescriptor) },
    ColliderDesc: {
      cuboid: vi.fn((x, y, z) => {
        colliderDescriptor.halfExtents = [x, y, z];
        return colliderDescriptor;
      }),
    },
  };
  const body = { type: "fixed" };
  const collider = { type: "exit-door" };
  const world = {
    createRigidBody: vi.fn(() => body),
    createCollider: vi.fn(() => collider),
  };
  return { RAPIER, world, body, collider, bodyDescriptor, colliderDescriptor };
}

describe("exit door prop", () => {
  it("exposes reinforced door animation roots and a permanent endpoint collider", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const physics = createPhysicsHarness();

    const exitDoor = createExitDoor({ scene, camera, world: physics.world, RAPIER: physics.RAPIER });

    expect(exitDoor.root.name).toBe("exit-door");
    expect(exitDoor.root.position.toArray()).toEqual([0, 0, -28.88]);
    expect(exitDoor.triggerPosition.toArray()).toEqual([0, 1.05, -26.7]);
    expect(exitDoor.leafPivot.parent).toBe(exitDoor.root);
    expect(exitDoor.handlePivot.parent).toBe(exitDoor.leafPivot);
    expect(exitDoor.lockBolt.parent).toBe(exitDoor.leafPivot);
    expect(exitDoor.braceRig.visible).toBe(false);
    expect(exitDoor.braceRig.parent).toBe(camera);
    expect(scene.getObjectByName("exit-door")).toBe(exitDoor.root);

    const hinges = exitDoor.root.getObjectsByProperty("name", "door-hinge");
    expect(hinges).toHaveLength(3);
    expect(hinges.every((hinge) => hinge.rotation.z === 0)).toBe(true);
    expect(exitDoor.root.getObjectByName("observation-slot")).toBeTruthy();
    expect(exitDoor.root.getObjectByName("lock-cylinder")).toBeTruthy();
    expect(exitDoor.root.getObjectByName("strike-plate")).toBeTruthy();
    expect(exitDoor.gapShadow.name).toBe("door-gap-shadow");

    expect(physics.bodyDescriptor.translation).toEqual([0, 1.44, -28.7]);
    expect(physics.colliderDescriptor.halfExtents).toEqual([1.2, 1.44, 0.14]);
    expect(physics.world.createCollider).toHaveBeenCalledWith(physics.colliderDescriptor, physics.body);
    expect(exitDoor.collider).toBe(physics.collider);
  });
});

describe("found phone prop", () => {
  it("provides distinct damaged floor and held rigs with repeatable visibility state", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    const foundPhone = createFoundPhoneProp({ scene, camera });

    expect(foundPhone.id).toBe("found-phone");
    expect(foundPhone.label).toBe("拿起手机");
    expect(foundPhone.root.userData.interactableId).toBe("found-phone");
    expect(foundPhone.root.position.toArray()).toEqual([-1.2, 0.07, -11.4]);
    expect(foundPhone.root.parent).toBe(scene);
    expect(foundPhone.heldRig.parent).toBe(camera);
    expect(foundPhone.heldRig).not.toBe(foundPhone.root);
    expect(foundPhone.heldRig.visible).toBe(false);
    expect(foundPhone.halo.visible).toBe(false);
    expect(foundPhone.root.getObjectByName("phone-camera-bump")).toBeTruthy();
    expect(foundPhone.root.getObjectsByProperty("name", "phone-side-button")).toHaveLength(3);
    expect(foundPhone.root.getObjectsByProperty("name", "screen-crack").length).toBeGreaterThanOrEqual(4);
    expect(foundPhone.root.getObjectByName("phone-screen").material.emissiveIntensity).toBeGreaterThan(0);

    foundPhone.setHeld(true);
    expect(foundPhone.root.visible).toBe(false);
    expect(foundPhone.heldRig.visible).toBe(true);

    foundPhone.setHeld(false);
    expect(foundPhone.root.visible).toBe(true);
    expect(foundPhone.heldRig.visible).toBe(false);
  });
});

describe("scene resource state", () => {
  it("hides the basin water surface while the faucet is off", () => {
    expect(sceneModule.createWashbasin).toBeTypeOf("function");
    if (typeof sceneModule.createWashbasin !== "function") return;
    const scene = new THREE.Scene();
    const basin = sceneModule.createWashbasin(
      scene,
      [0, 1, 0],
      new THREE.MeshStandardMaterial({ color: 0x555555 }),
    );

    expect(basin.waterSurface.visible).toBe(false);
    basin.toggle();
    expect(basin.waterSurface.visible).toBe(true);
    basin.toggle();
    expect(basin.waterSurface.visible).toBe(false);
  });

  it("releases the Rapier world through the scene disposal helper", () => {
    expect(sceneModule.disposePhysicsWorld).toBeTypeOf("function");
    if (typeof sceneModule.disposePhysicsWorld !== "function") return;
    const world = { free: vi.fn() };

    sceneModule.disposePhysicsWorld(world);

    expect(world.free).toHaveBeenCalledOnce();
  });
});
