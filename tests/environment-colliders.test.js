import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { createEnvironmentColliders } from "../src/desktop/environment/colliders.js";

function rotatedManifest() {
  return {
    rootTransform: {
      position: [100, 200, 300],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    colliders: [
      {
        id: "rotated-box",
        shape: "box",
        position: [2, 1, -3],
        rotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)],
        halfExtents: [2, 0.5, 0.25],
      },
      {
        id: "sideways-capsule",
        shape: "capsule",
        position: [-4, 2, 6],
        rotation: [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)],
        radius: 0.3,
        halfHeight: 0.8,
      },
    ],
    occluders: [
      { id: "box-occluder", colliderId: "rotated-box" },
    ],
  };
}

function worldCounts(world) {
  let colliders = 0;
  let bodies = 0;
  world.forEachCollider(() => { colliders += 1; });
  world.forEachRigidBody(() => { bodies += 1; });
  return { colliders, bodies };
}

beforeAll(async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await RAPIER.init();
  } finally {
    warn.mockRestore();
  }
});

describe("environment collision proxies", () => {
  it("creates rotated box and capsule shapes directly in post-transform game space", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest() });
      const [box, capsule] = instance.colliders;

      expect(box.translation()).toMatchObject({ x: 2, y: 1, z: -3 });
      expect(box.rotation().y).toBeCloseTo(Math.sin(Math.PI / 8), 7);
      expect(box.rotation().w).toBeCloseTo(Math.cos(Math.PI / 8), 7);
      expect(box.halfExtents()).toMatchObject({ x: 2, y: 0.5, z: 0.25 });

      expect(capsule.translation()).toMatchObject({ x: -4, y: 2, z: 6 });
      expect(capsule.rotation().x).toBeCloseTo(Math.sin(Math.PI / 4), 7);
      expect(capsule.radius()).toBeCloseTo(0.3, 7);
      expect(capsule.halfHeight()).toBeCloseTo(0.8, 7);
      expect(new Set(instance.colliders.map(({ handle }) => handle)).size).toBe(2);
      expect(instance.colliders.every((entry) => entry.shapeType() !== RAPIER.ShapeType.TriMesh)).toBe(true);
    } finally {
      world.free();
    }
  });

  it("builds raycastable but non-rendering Three box occluders only for curated proxies", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest() });

      expect(instance.occluderRoots).toHaveLength(1);
      const [occluder] = instance.occluderRoots;
      expect(occluder).toBeInstanceOf(THREE.Mesh);
      expect(occluder.name).toBe("environment-occluder:box-occluder");
      expect(occluder.userData).toMatchObject({
        environmentOccluder: true,
        environmentColliderId: "rotated-box",
      });
      expect(occluder.visible).toBe(true);
      expect(occluder.material.visible).toBe(false);
      expect(occluder.geometry.parameters).toMatchObject({ width: 4, height: 1, depth: 0.5 });

      occluder.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(2, 1, 2),
        new THREE.Vector3(0, 0, -1),
      );
      expect(raycaster.intersectObject(occluder)).toHaveLength(2);
    } finally {
      world.free();
    }
  });

  it("removes owned bodies and Three resources exactly once", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest() });
      const parent = new THREE.Group();
      parent.add(...instance.occluderRoots);
      const geometryDispose = vi.spyOn(instance.occluderRoots[0].geometry, "dispose");
      const materialDispose = vi.spyOn(instance.occluderRoots[0].material, "dispose");

      expect(worldCounts(world)).toEqual({ colliders: 2, bodies: 2 });
      instance.dispose();
      instance.dispose();

      expect(worldCounts(world)).toEqual({ colliders: 0, bodies: 0 });
      expect(parent.children).toHaveLength(0);
      expect(geometryDispose).toHaveBeenCalledTimes(1);
      expect(materialDispose).toHaveBeenCalledTimes(1);
    } finally {
      world.free();
    }
  });
});
