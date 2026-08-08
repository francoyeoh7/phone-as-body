import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { HorrorDirector } from "../src/desktop/HorrorDirector.js";
import { InventoryState } from "../src/desktop/InventoryState.js";

function createHarness({
  washbasin,
  inventory,
  manifest = null,
  ceilingLights = null,
  environmentLights = null,
} = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, -8);
  const ui = {
    setObjective: vi.fn(),
    setPrompt: vi.fn(),
    setSubtitle: vi.fn(),
  };
  const audio = { cue: vi.fn() };
  const experience = {
    camera,
    objects: {
      fuse: { enabled: true, root: new THREE.Group() },
      panel: {
        lamp: {
          material: new THREE.MeshStandardMaterial({ color: 0x9f3329, emissive: 0x8d2a20 }),
        },
      },
      silhouette: new THREE.Group(),
      flashlight: { visible: true },
      ceilingLights: ceilingLights ?? Array.from({ length: 6 }, () => new THREE.PointLight()),
      stormLight: new THREE.DirectionalLight(),
      washbasin,
      ...((manifest || environmentLights) ? {
        environment: { manifest, lights: environmentLights },
      } : {}),
    },
  };
  const director = new HorrorDirector({ experience, ui, audio, inventory });
  return { director, experience, ui, audio };
}

describe("horror director", () => {
  it("keeps the panel locked until the fuse is collected", () => {
    const { director, audio, ui } = createHarness();
    expect(director.handleInteraction("panel")).toBe(false);
    expect(director.story.current()).toBe("find-fuse");
    expect(audio.cue).toHaveBeenCalledWith("locked");
    expect(ui.setSubtitle).toHaveBeenCalled();
  });

  it("drives power restoration to the exit door without elevator mutations", () => {
    const { director, experience, ui } = createHarness();

    expect(director.handleInteraction("fuse")).toBe(true);
    expect(experience.objects.fuse.root.visible).toBe(false);
    expect(director.handleInteraction("panel")).toBe(true);
    expect(director.story.current()).toBe("reach-door");
    expect(ui.setSubtitle).toHaveBeenLastCalledWith("出口门的应急锁已通电。", true);

    expect(director.handleInteraction("elevator")).toBe(false);
  });

  it("stops an active pursuit and is safe before pursuit starts", () => {
    const { director, experience } = createHarness();

    expect(() => director.stopPursuit()).not.toThrow();
    expect(director.pursuitActive).toBe(false);
    expect(director.pursuitAt).toBe(Infinity);
    expect(experience.objects.silhouette.visible).toBe(false);

    director.pursuitAt = 0;
    director.update(0.016, 1);
    expect(director.pursuitActive).toBe(true);
    expect(experience.objects.silhouette.visible).toBe(true);
    director.stopPursuit();

    expect(director.pursuitActive).toBe(false);
    expect(director.pursuitAt).toBe(Infinity);
    expect(experience.objects.silhouette.visible).toBe(false);
  });

  it("routes repeated washbasin interactions without changing the story objective", () => {
    const washbasin = {
      label: "打开水龙头",
      toggle: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
    };
    const { director, audio, ui } = createHarness({ washbasin });

    expect(director.handleInteraction("washbasin")).toBe(true);
    expect(director.handleInteraction("washbasin")).toBe(true);

    expect(washbasin.toggle).toHaveBeenCalledTimes(2);
    expect(director.story.current()).toBe("find-fuse");
    expect(audio.cue).toHaveBeenNthCalledWith(1, "water-on");
    expect(audio.cue).toHaveBeenNthCalledWith(2, "water-off");
    expect(ui.setPrompt).toHaveBeenLastCalledWith("打开水龙头");
  });

  it("acquires the fuse and requires it to be equipped for tracked-hand panel use", () => {
    const inventory = new InventoryState([{ id: "spare-fuse", enabled: true }]);
    const { director } = createHarness({ inventory });

    expect(director.handleInteraction("fuse", { source: "hand" })).toBe(true);
    expect(inventory.snapshot().items).toHaveLength(1);
    expect(director.handleInteraction("panel", { source: "hand" })).toBe(false);
    expect(inventory.equip("spare-fuse")).toBe(true);
    expect(director.handleInteraction("panel", { source: "hand" })).toBe(true);
    expect(inventory.snapshot()).toMatchObject({ items: [], equippedId: null });
    expect(director.story.serialize().hasFuse).toBe(true);
  });

  it("lets touch fallback consume an acquired but unequipped fuse", () => {
    const inventory = new InventoryState([{ id: "spare-fuse", enabled: true }]);
    const { director } = createHarness({ inventory });
    director.handleInteraction("fuse", { source: "touch" });

    expect(director.handleInteraction("panel", { source: "touch" })).toBe(true);
    expect(inventory.snapshot().items).toHaveLength(0);
  });

  it("uses manifest story anchors and semantic power lights in an arbitrary world basis", () => {
    const manifest = {
      story: {
        firstReveal: [8.2, 0, 5.4],
        pursuitSpawn: [-6.8, 0, 9.2],
        pursuitTargetOffset: [1.8, 0, -0.9],
      },
      lights: [
        { id: "power-yard", role: "power-sequence" },
        { id: "power-house", role: "power-sequence" },
        { id: "decorative-third", role: "practical" },
      ],
    };
    const powerYard = new THREE.PointLight();
    powerYard.intensity = 0.8;
    const powerHouse = new THREE.PointLight();
    powerHouse.intensity = 0.9;
    const decorativeThird = new THREE.PointLight();
    decorativeThird.name = "decorative-third";
    decorativeThird.intensity = 0.7;
    const { director, experience } = createHarness({
      manifest,
      ceilingLights: [decorativeThird],
      environmentLights: {
        byRole: { "power-sequence": [powerYard, powerHouse] },
      },
    });

    expect(director.collectFuse()).toBe(true);
    expect(experience.objects.silhouette.position.toArray()).toEqual(manifest.story.firstReveal);
    expect(powerYard.intensity).toBe(0);
    expect(powerHouse.intensity).toBe(0);
    expect(decorativeThird.intensity).toBe(0.7);

    expect(director.restorePower()).toBe(true);
    director.update(0, 4.2);
    expect(experience.objects.silhouette.position.toArray()).toEqual(manifest.story.pursuitSpawn);

    experience.camera.position.set(3, 1.6, 4);
    const before = experience.objects.silhouette.position.clone();
    const expectedDirection = new THREE.Vector3(
      experience.camera.position.x,
      0,
      experience.camera.position.z,
    )
      .add(new THREE.Vector3(...manifest.story.pursuitTargetOffset))
      .sub(before)
      .normalize();
    director.updatePursuit(1);
    const movement = experience.objects.silhouette.position.clone().sub(before).normalize();
    expect(movement.angleTo(expectedDirection)).toBeLessThan(1e-8);
  });
});
