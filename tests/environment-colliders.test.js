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

  it("derives structure and trunk proxies from the imported village meshes", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const environmentRoot = new THREE.Group();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2.4, 0.35),
      new THREE.MeshBasicMaterial(),
    );
    wall.name = "instance-001-mesh-65";
    wall.geometry.name = "S_Medieval_Modular_Wall_ueoqbdhdw_lod3_Var1";
    wall.position.set(3, 1.2, -2);
    const tree = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.5, 6, 8),
      new THREE.MeshBasicMaterial(),
    );
    tree.name = "SM_BlackAlder_Forest_05_PP";
    tree.position.set(-3, 3, 1);
    const treeCanopy = new THREE.Mesh(
      new THREE.SphereGeometry(2, 8, 6),
      new THREE.MeshBasicMaterial(),
    );
    treeCanopy.name = "SM_BlackAlder_Forest_05_PP_TwoSided";
    treeCanopy.position.set(-3, 5.5, 1);
    environmentRoot.add(wall, tree, treeCanopy);
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest(), environmentRoot });
      expect(instance.colliders).toHaveLength(4);
      expect(instance.colliders.filter((entry) => entry.userData?.environmentColliderSource !== "manifest")).toHaveLength(2);
      expect(instance.colliders.some((entry) => entry.userData?.environmentColliderId.startsWith("auto-tree-"))).toBe(true);
      expect(instance.colliders.some((entry) => entry.userData?.environmentColliderId.startsWith("auto-structure-"))).toBe(true);
    } finally {
      world.free();
    }
  });

  it("does not turn a merged building mesh into a village-sized invisible wall", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const environmentRoot = new THREE.Group();
    const merged = new THREE.Mesh(
      new THREE.BoxGeometry(24, 3, 19),
      new THREE.MeshBasicMaterial(),
    );
    merged.name = "instance-000-mesh-64";
    merged.geometry.name = "S_Medieval_Modular_Wall_cluster";
    environmentRoot.add(merged);
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest(), environmentRoot });
      expect(instance.colliders).toHaveLength(2);
      expect(instance.colliders.every((entry) => entry.userData?.environmentColliderSource === "manifest")).toBe(true);
    } finally {
      world.free();
    }
  });

  it("creates one small structure proxy for each exported wall instance", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const geometry = new THREE.BoxGeometry(3, 2, 0.2);
    geometry.name = "S_Medieval_Modular_Wall";
    const walls = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2);
    walls.name = "instance-wall";
    walls.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-4, 1, 0));
    walls.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 1, 0));
    const environmentRoot = new THREE.Group();
    environmentRoot.add(walls);
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest(), environmentRoot });
      const generated = instance.colliders.filter((entry) => entry.userData?.environmentColliderSource !== "manifest");
      expect(generated).toHaveLength(2);
      expect(generated.map((entry) => entry.translation().x)).toEqual([-4, 4]);
      expect(generated.every((entry) => entry.halfExtents().z < 0.2)).toBe(true);
    } finally {
      world.free();
    }
  });

  it("caps generated collider proxies at 48 while retaining curated manifest colliders", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const geometry = new THREE.BoxGeometry(3, 2, 0.2);
    geometry.name = "S_Medieval_Modular_Wall";
    const walls = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 80);
    walls.name = "instance-wall-budget";
    for (let index = 0; index < 80; index += 1) {
      walls.setMatrixAt(index, new THREE.Matrix4().makeTranslation(index * 4, 1, 0));
    }
    const environmentRoot = new THREE.Group();
    environmentRoot.add(walls);
    try {
      const instance = createEnvironmentColliders({ RAPIER, world, manifest: rotatedManifest(), environmentRoot });
      const generated = instance.colliders.filter((entry) => entry.userData?.environmentColliderSource !== "manifest");
      const curated = instance.colliders.filter((entry) => entry.userData?.environmentColliderSource === "manifest");
      expect(generated).toHaveLength(48);
      expect(curated).toHaveLength(rotatedManifest().colliders.length);
      expect(instance.colliders).toHaveLength(48 + rotatedManifest().colliders.length);
    } finally {
      world.free();
    }
  });
});
