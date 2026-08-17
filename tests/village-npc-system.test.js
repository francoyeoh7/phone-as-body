import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { VillageNpcActor } from "../src/desktop/npc/VillageNpcActor.js";
import { VillageNpcSystem } from "../src/desktop/npc/VillageNpcSystem.js";
import { NPC_ASSETS } from "../src/desktop/npc/npc-assets.js";
import { createNpcRoster } from "../src/desktop/npc/npc-roster.js";

const asset = {
  id: "mara",
  url: "/assets/npcs/models/mara.glb",
  position: [2, 0, -3],
  rotation: [0, 0, 0],
  targetHeight: 1.72,
  animation: ["Idle"],
};

describe("VillageNpcActor", () => {
  it("keeps Fab source-axis transforms upright instead of rotating them sideways twice", () => {
    expect(NPC_ASSETS.map((entry) => entry.rotation)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("renders a role-specific fallback immediately and keeps stable anchors", () => {
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset,
      loader: { loadAsync: vi.fn() },
    });
    expect(actor.root.position.toArray()).toEqual([2, 0, -3]);
    expect(actor.fallback.visible).toBe(true);
    expect(actor.mouth.position.y).toBeGreaterThan(1.4);
    expect(actor.root.userData.npcId).toBe("mara");
  });

  it("keeps the fallback when GLB loading fails", async () => {
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset,
      loader: { loadAsync: vi.fn().mockRejectedValue(new Error("offline")) },
    });
    await expect(actor.load()).resolves.toBe(false);
    expect(actor.fallback.visible).toBe(true);
    expect(actor.loadError.message).toBe("offline");
  });

  it("normalizes a loaded model height and hides the fallback", async () => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), new THREE.MeshBasicMaterial()));
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset,
      loader: { loadAsync: vi.fn().mockResolvedValue({ scene: model, animations: [] }) },
    });
    await expect(actor.load()).resolves.toBe(true);
    const bounds = new THREE.Box3().setFromObject(actor.modelRoot);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(1.72, 2);
    expect(actor.fallback.visible).toBe(false);
  });

  it("grounds a loaded model in actor-local space when its ancestors are translated", async () => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
    const elevatedAsset = { ...asset, position: [2, 4, -3] };
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset: elevatedAsset,
      loader: { loadAsync: vi.fn().mockResolvedValue({ scene: model, animations: [] }) },
    });
    const parent = new THREE.Group();
    parent.position.y = 10;
    parent.add(actor.root);

    await expect(actor.load()).resolves.toBe(true);

    const bounds = new THREE.Box3().setFromObject(actor.modelRoot);
    expect(bounds.min.y).toBeCloseTo(14, 5);
  });

  it("keeps the coherent fallback when normalization would leave a many-metres-long model", async () => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 4), new THREE.MeshBasicMaterial()));
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset,
      loader: { loadAsync: vi.fn().mockResolvedValue({ scene: model, animations: [] }) },
    });

    await expect(actor.load()).resolves.toBe(false);
    expect(actor.fallback.visible).toBe(true);
    expect(actor.modelRoot).toBeNull();
    expect(actor.loadError?.message).toMatch(/dimensions/i);
  });

  it("keeps a readable fallback when an authored asset is flagged visually unsafe", async () => {
    const loader = { loadAsync: vi.fn() };
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset: { ...asset, forceFallback: true },
      loader,
    });
    await expect(actor.load()).resolves.toBe(false);
    expect(loader.loadAsync).not.toHaveBeenCalled();
    expect(actor.fallback.visible).toBe(true);
    expect(actor.modelRoot).toBeNull();
  });

  it("rejects a depth-dominant pose that reads as a collapsed NPC", async () => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1.7), new THREE.MeshBasicMaterial()));
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset: { ...asset, maxDepthRatio: 0.78 },
      loader: { loadAsync: vi.fn().mockResolvedValue({ scene: model, animations: [] }) },
    });

    await expect(actor.load()).resolves.toBe(false);
    expect(actor.fallback.visible).toBe(true);
    expect(actor.loadError?.message).toMatch(/dimensions/i);
  });

  it("turns toward the player and applies available expression morphs", () => {
    const actor = new VillageNpcActor({
      definition: createNpcRoster().get("mara"),
      asset,
      loader: { loadAsync: vi.fn() },
    });
    const face = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    face.morphTargetDictionary = { happy: 0, angry: 1 };
    face.morphTargetInfluences = [0, 0];
    actor.root.add(face);
    actor.perform({ emotion: "warm", gesture: "turn" }, new THREE.Vector3(8, 1.6, -3));
    actor.update(0.2, 1, new THREE.Vector3(8, 1.6, -3));
    expect(actor.root.rotation.y).toBeGreaterThan(0);
    expect(face.morphTargetInfluences[0]).toBeGreaterThan(0);
  });
});

describe("VillageNpcSystem", () => {
  it("creates all three actors synchronously and loads them without blocking", async () => {
    const scene = new THREE.Scene();
    const loader = { loadAsync: vi.fn().mockRejectedValue(new Error("test fallback")) };
    const system = new VillageNpcSystem({ scene, loader });
    expect(system.actors.size).toBe(3);
    expect(scene.getObjectByName("village-npcs")).toBe(system.root);
    await expect(system.load()).resolves.toEqual({ loaded: 0, fallback: 3 });
    expect(system.snapshots()).toHaveLength(3);
  });

  it("marks one actor noticed and returns independent world snapshots", () => {
    const scene = new THREE.Scene();
    const system = new VillageNpcSystem({ scene, loader: { loadAsync: vi.fn() } });
    expect(system.notice("bram", new THREE.Vector3(0, 1.6, 0))).toBe(true);
    expect(system.actors.get("bram").noticed).toBe(true);
    expect(system.actors.get("mara").noticed).toBe(false);
    expect(system.snapshots().find((npc) => npc.id === "bram").aliases).toContain("Bram");
  });

  it("removes and disposes every actor", () => {
    const scene = new THREE.Scene();
    const system = new VillageNpcSystem({ scene, loader: { loadAsync: vi.fn() } });
    system.destroy();
    expect(system.actors.size).toBe(0);
    expect(system.root.parent).toBeNull();
  });
});
