import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { HorrorDirector } from "../src/desktop/HorrorDirector.js";

function createHarness({ washbasin } = {}) {
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
      ceilingLights: Array.from({ length: 6 }, () => new THREE.PointLight()),
      stormLight: new THREE.DirectionalLight(),
      washbasin,
    },
  };
  const director = new HorrorDirector({ experience, ui, audio });
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
});
