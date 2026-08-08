import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { createEnvironmentColliders } from "../src/desktop/environment/colliders.js";
import { validateEnvironmentManifest } from "../src/desktop/environment/manifest.js";

const manifestUrl = new URL("../public/assets/environment/elderboom-v1/manifest.json", import.meta.url);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const PLAYER_Y = 1.05;

async function trackedManifest() {
  return validateEnvironmentManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function requestedStep(from, to, maximum = 0.1) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  const scale = Math.min(1, maximum / distance);
  return { x: dx * scale, y: 0, z: dz * scale };
}

function assertNoPenetration(world, playerCollider, position) {
  const hit = world.intersectionWithShape(
    position,
    IDENTITY,
    new RAPIER.Capsule(0.52, 0.32),
    undefined,
    undefined,
    playerCollider,
  );
  expect(hit).toBeNull();
}

function sweepSegment({ world, body, playerCollider, controller, position }, target) {
  let current = position;
  const maximumSteps = Math.ceil(horizontalDistance(current, target) / 0.1) + 4;

  for (let index = 0; index < maximumSteps && horizontalDistance(current, target) > 0.025; index += 1) {
    const requested = requestedStep(current, target);
    controller.computeColliderMovement(playerCollider, requested);
    const movement = controller.computedMovement();
    expect(Math.hypot(movement.x, movement.z)).toBeGreaterThanOrEqual(Math.hypot(requested.x, requested.z) * 0.98);

    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: PLAYER_Y,
      z: current.z + movement.z,
    });
    world.step();
    current = body.translation();
    assertNoPenetration(world, playerCollider, current);
  }

  expect(horizontalDistance(current, target)).toBeLessThanOrEqual(0.025);
  return current;
}

function rightAngleTurns(points) {
  let count = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = {
      x: points[index].x - points[index - 1].x,
      z: points[index].z - points[index - 1].z,
    };
    const after = {
      x: points[index + 1].x - points[index].x,
      z: points[index + 1].z - points[index].z,
    };
    const denominator = Math.hypot(before.x, before.z) * Math.hypot(after.x, after.z);
    if (denominator > 0 && Math.abs((before.x * after.x + before.z * after.z) / denominator) < 1e-8) count += 1;
  }
  return count;
}

beforeAll(async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await RAPIER.init();
  } finally {
    warn.mockRestore();
  }
});

describe("ElderBoom village route", () => {
  it("sweeps the real player capsule through every task in story order and returns to the exit", async () => {
    const manifest = await trackedManifest();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const environment = createEnvironmentColliders({ RAPIER, world, manifest });
      const [spawnX, spawnY, spawnZ] = manifest.spawn.position;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawnX, spawnY, spawnZ),
      );
      const playerCollider = world.createCollider(RAPIER.ColliderDesc.capsule(0.52, 0.32), body);
      const controller = world.createCharacterController(0.01);
      controller.enableAutostep(0.3, 0.16, true);
      controller.enableSnapToGround(0.2);
      world.step();

      const route = [
        { id: "spawn", x: spawnX, y: PLAYER_Y, z: spawnZ },
        { id: "align-washbasin", x: 6.5, y: PLAYER_Y, z: -7.6 },
        { id: "washbasin", x: 5.7, y: PLAYER_Y, z: -7.6 },
        { id: "return-lane", x: 5.7, y: PLAYER_Y, z: -0.3 },
        { id: "found-phone", x: 7.7, y: PLAYER_Y, z: -0.3 },
        { id: "window-lane", x: 4.4, y: PLAYER_Y, z: -0.3 },
        { id: "shadow-window", x: 4.4, y: PLAYER_Y, z: 2.8 },
        { id: "fuse", x: 2, y: PLAYER_Y, z: 2 },
        { id: "secondary-door-outside", x: 2.2, y: PLAYER_Y, z: 3 },
        { id: "secondary-door-inside", x: 2.2, y: PLAYER_Y, z: 5.4 },
        { id: "panel", x: 0.2, y: PLAYER_Y, z: 13.9 },
        { id: "secondary-door-return", x: 2.2, y: PLAYER_Y, z: 5.4 },
        { id: "village-return", x: 2.2, y: PLAYER_Y, z: 3 },
        { id: "primary-approach", x: 6.5, y: PLAYER_Y, z: -2 },
        { id: "exit-door", x: 11.52, y: PLAYER_Y, z: -8.4 },
      ];

      const visitedTasks = route
        .map(({ id }) => id)
        .filter((id) => ["washbasin", "found-phone", "shadow-window", "fuse", "panel", "exit-door"].includes(id));
      expect(visitedTasks).toEqual(["washbasin", "found-phone", "shadow-window", "fuse", "panel", "exit-door"]);
      expect(rightAngleTurns(route)).toBeGreaterThanOrEqual(2);

      let position = body.translation();
      for (const waypoint of route.slice(1)) {
        position = sweepSegment({ world, body, playerCollider, controller, position }, waypoint);
      }
      expect(horizontalDistance(position, route.at(-1))).toBeLessThanOrEqual(0.025);

      environment.dispose();
      world.removeRigidBody(body);
    } finally {
      world.free();
    }
  });

  it("keeps each task approach within use range and a 0.9 meter clear radius", async () => {
    const manifest = await trackedManifest();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const environment = createEnvironmentColliders({ RAPIER, world, manifest });
      world.step();
      const approaches = {
        "washbasin": [5.7, PLAYER_Y, -7.6],
        "found-phone": [7.7, PLAYER_Y, -0.3],
        "shadow-window": [4.4, PLAYER_Y, 2.8],
        "fuse": [2, PLAYER_Y, 2],
        "panel": [0.2, PLAYER_Y, 13.9],
        "exit-door": manifest.tasks["exit-door"].triggerPosition,
      };

      for (const [taskId, position] of Object.entries(approaches)) {
        const task = manifest.tasks[taskId];
        const target = taskId === "exit-door" ? task.triggerPosition : task.position;
        const useDistance = Math.hypot(position[0] - target[0], position[2] - target[2]);
        if (taskId !== "exit-door") expect(useDistance).toBeLessThanOrEqual(task.maxUseDistance);

        const blocker = world.intersectionWithShape(
          { x: position[0], y: position[1], z: position[2] },
          IDENTITY,
          new RAPIER.Ball(0.9),
        );
        expect(blocker, `${taskId} approach clearance`).toBeNull();
      }

      environment.dispose();
    } finally {
      world.free();
    }
  });
});
