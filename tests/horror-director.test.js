import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { HorrorDirector } from "../src/desktop/HorrorDirector.js";

function createHarness() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, -8);
  const elevatorDoors = new THREE.Group();
  const leftDoor = new THREE.Object3D();
  const rightDoor = new THREE.Object3D();
  leftDoor.position.x = -0.58;
  rightDoor.position.x = 0.58;
  elevatorDoors.add(leftDoor, rightDoor);
  const ui = {
    setObjective: vi.fn(),
    setPrompt: vi.fn(),
    setSubtitle: vi.fn(),
  };
  const phone = { send: vi.fn() };
  const audio = { cue: vi.fn() };
  const onComplete = vi.fn();
  const experience = {
    camera,
    world: { removeCollider: vi.fn() },
    objects: {
      fuse: { enabled: true, root: new THREE.Group() },
      panel: {
        lamp: {
          material: new THREE.MeshStandardMaterial({ color: 0x9f3329, emissive: 0x8d2a20 }),
        },
      },
      elevator: { enabled: true, root: new THREE.Group() },
      elevatorCollider: { handle: 42 },
      elevatorDoors,
      silhouette: new THREE.Group(),
      flashlight: { visible: true },
      ceilingLights: Array.from({ length: 6 }, () => new THREE.PointLight()),
      stormLight: new THREE.DirectionalLight(),
    },
  };
  experience.objects.elevator.root.visible = false;
  const director = new HorrorDirector({ experience, ui, phone, audio, onComplete });
  return { director, experience, ui, phone, audio, onComplete };
}

describe("horror director", () => {
  it("keeps the panel locked until the fuse is collected", () => {
    const { director, audio, ui } = createHarness();
    expect(director.handleInteraction("panel")).toBe(false);
    expect(director.story.current()).toBe("find-fuse");
    expect(audio.cue).toHaveBeenCalledWith("locked");
    expect(ui.setSubtitle).toHaveBeenCalled();
  });

  it("drives the phone message, power restoration, and escape ending", () => {
    const { director, experience, phone, onComplete } = createHarness();

    expect(director.handleInteraction("fuse")).toBe(true);
    expect(experience.objects.fuse.root.visible).toBe(false);
    director.update(0.016, 1.2);
    expect(phone.send).toHaveBeenCalledWith({ type: "private-message", text: "别回头" });

    expect(director.handleInteraction("panel")).toBe(true);
    expect(experience.objects.elevator.root.visible).toBe(true);
    expect(experience.world.removeCollider).toHaveBeenCalledOnce();
    expect(experience.objects.elevatorCollider).toBeNull();
    expect(director.story.current()).toBe("reach-elevator");

    expect(director.handleInteraction("elevator")).toBe(true);
    director.update(0.016, 3.7);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(director.story.current()).toBe("escaped");
  });
});
