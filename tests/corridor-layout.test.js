import { describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { createCorridorLayout } from "../src/desktop/CorridorLayout.js";

describe("L corridor layout", () => {
  it("forms the exact wider connected ninety-degree route", () => {
    const layout = createCorridorLayout();

    expect(layout.width).toBe(6.4);
    expect(layout.height).toBe(3.6);
    expect(layout.main.bounds).toEqual({ minX: -3.2, maxX: 3.2, minZ: -32.8, maxZ: 3.2 });
    expect(layout.wing.bounds).toEqual({ minX: 3.2, maxX: 23.2, minZ: -32.8, maxZ: -26.4 });
    expect(layout.turnAngle).toBe(90);
    expect(layout.turn).toEqual(expect.objectContaining({ x: 3.2, z: -26.4 }));
    expect(layout.door.position).toEqual([23, 0, -29.6]);
    expect(layout.door.rotationY).toBe(-Math.PI / 2);
    expect(layout.door.inwardNormal).toEqual([-1, 0, 0]);
  });

  it("leaves the inside corner open and closes the outside perimeter", () => {
    const layout = createCorridorLayout();
    const wallIds = layout.walls.map((wall) => wall.id);

    expect(wallIds).not.toContain("blocked-turn-opening");
    expect(wallIds).toEqual(expect.arrayContaining([
      "main-left",
      "main-right-before-turn",
      "wing-north",
      "wing-south",
      "wing-end",
    ]));
    expect(layout.colliders.some((collider) => collider.id === "blocked-turn-opening")).toBe(false);
    expect(layout.colliders.some((collider) => collider.id === "main-right-after-turn")).toBe(false);
    expect(layout.isWalkable(0, 1.2)).toBe(true);
    expect(layout.isWalkable(6, -29.6)).toBe(true);
    expect(layout.isWalkable(10, -20)).toBe(false);
  });

  it("keeps named prop and cinematic anchors on the intended legs", () => {
    const { anchors } = createCorridorLayout();

    expect(anchors.foundPhone.position).toEqual([-1.2, 0.07, -11.4]);
    expect(anchors.washbasin.position).toEqual([1.75, 1.1, -5.2]);
    expect(anchors.fuse.position).toEqual([-1.78, 1.25, -8.6]);
    expect(anchors.panel.position).toEqual([2.35, 1.36, -15.6]);
    expect(anchors.shadowWindow.position[2]).toBeCloseTo(-14.4, 8);
    expect(anchors.shadowWindow.taskPoint[2]).toBeCloseTo(-13.92, 8);
    expect(anchors.exitDoor.triggerPosition).toEqual([20.82, 1.05, -29.6]);
    expect(anchors.exitDoor.inwardNormal).toEqual([-1, 0, 0]);
  });

  it("lets the player capsule sweep from the main leg through the open turn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await RAPIER.init();
    } finally {
      warn.mockRestore();
    }
    const layout = createCorridorLayout();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      for (const entry of layout.colliders.filter((collider) => collider.type !== "obstacle")) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...entry.position));
        world.createCollider(RAPIER.ColliderDesc.cuboid(...entry.halfExtents), body);
      }
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.05, -27.3));
      const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(0.52, 0.32), body);
      const controller = world.createCharacterController(0.01);
      controller.enableAutostep(0.3, 0.16, true);
      controller.enableSnapToGround(0.2);
      world.step();

      let position = { x: 0, y: 1.05, z: -27.3 };
      for (let step = 0; step < 70; step += 1) {
        body.setTranslation(position, true);
        controller.computeColliderMovement(capsule, { x: 0.1, y: 0, z: 0 });
        const movement = controller.computedMovement();
        position = {
          x: position.x + movement.x,
          y: position.y + movement.y,
          z: position.z + movement.z,
        };
        body.setNextKinematicTranslation(position);
        world.step();
      }

      expect(position.x).toBeGreaterThan(6.5);
      expect(position.z).toBeCloseTo(-27.3, 2);
      expect(layout.isWalkable(position.x, position.z, 0.32)).toBe(true);
    } finally {
      world.free();
    }
  });
});
