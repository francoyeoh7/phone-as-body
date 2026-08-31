import { describe, expect, it } from "vitest";
import {
  collideWithWalls, groundHeightAt, hasLineOfSight, guardCanSeePlayer,
  stepGuard, findGrabbable, clipCameraToWalls,
} from "../src/castle/castle-logic.js";
import { WALLS, SLABS, STAIRS, GUARDS, TREASURES, FLOOR_HEIGHT } from "../src/castle/castle-layout.js";

const config = {
  sightRange: 7, sightRangeDark: 3.2, fovCos: 0.34, catchDist: 1.0, chaseSpeed: 2.9,
};
const grabConfig = { grabRange: 2.4, grabConeCos: 0.82 };

describe("castle collision", () => {
  const wall = { x: 0, z: 0, hw: 2, hd: 0.3, y: 0 };

  it("pushes the player out of a wall on the shallow axis", () => {
    const [x, z] = collideWithWalls(0, 0.2, 0.35, [wall], 0);
    expect(x).toBe(0);
    expect(Math.abs(z)).toBeCloseTo(0.65, 5);
  });

  it("leaves a distant player untouched", () => {
    const [x, z] = collideWithWalls(5, 5, 0.35, [wall], 0);
    expect([x, z]).toEqual([5, 5]);
  });

  it("ignores walls on other floors", () => {
    const [x, z] = collideWithWalls(0, 0.2, 0.35, [wall], FLOOR_HEIGHT * 2);
    expect([x, z]).toEqual([0, 0.2]);
  });
});

describe("ground height", () => {
  it("stands on the current floor", () => {
    expect(groundHeightAt(0, 0, FLOOR_HEIGHT, SLABS, STAIRS)).toBe(FLOOR_HEIGHT);
  });

  it("interpolates along a staircase", () => {
    const stair = STAIRS[0];
    const midZ = (stair.z0 + stair.z1) / 2;
    const y = groundHeightAt(9.5, midZ, FLOOR_HEIGHT / 2, SLABS, STAIRS);
    expect(y).toBeGreaterThan(0.4);
    expect(y).toBeLessThan(FLOOR_HEIGHT - 0.4);
  });

  it("never snaps to a higher floor without stairs", () => {
    expect(groundHeightAt(0, 0, 0, SLABS, STAIRS)).toBe(0);
  });
});

describe("line of sight", () => {
  const wall = { x: 0, z: 0, hw: 2, hd: 0.3, y: 0 };

  it("blocks sight through a wall", () => {
    expect(hasLineOfSight(0, -2, 0, 2, [wall], 0)).toBe(false);
  });

  it("passes when no wall intervenes", () => {
    expect(hasLineOfSight(-3, -2, -3, 2, [wall], 0)).toBe(true);
  });
});

describe("guard perception and chase", () => {
  it("sees a lit player inside the vision cone", () => {
    const guard = { x: 0, z: 0, y: 0, heading: 0 };
    const player = { x: 0, z: 4, y: 0, lightOn: true };
    expect(guardCanSeePlayer(guard, player, [], config)).toBe(true);
  });

  it("misses a player outside the vision cone", () => {
    const guard = { x: 0, z: 0, y: 0, heading: Math.PI };
    const player = { x: 0, z: 4, y: 0, lightOn: true };
    expect(guardCanSeePlayer(guard, player, [], config)).toBe(false);
  });

  it("misses a dark player beyond the dark range", () => {
    const guard = { x: 0, z: 0, y: 0, heading: Math.PI };
    const player = { x: 0, z: 5, y: 0, lightOn: false };
    expect(guardCanSeePlayer(guard, player, [], config)).toBe(false);
  });

  it("misses a player on another floor", () => {
    const guard = { x: 0, z: 0, y: 0, heading: 0 };
    const player = { x: 0, z: 1, y: FLOOR_HEIGHT, lightOn: true };
    expect(guardCanSeePlayer(guard, player, [], config)).toBe(false);
  });

  it("chases and reports a catch in range", () => {
    const guard = { x: 0, z: 0, y: 0, heading: 0, waypoints: [[0, 5]], wpIndex: 0, speed: 1.5, state: "patrol", alert: 1 };
    const player = { x: 0, z: 0.5, y: 0, lightOn: true };
    const caught = stepGuard(guard, player, [], STAIRS, SLABS, config, 0.1);
    expect(guard.state).toBe("chase");
    expect(caught).toBe(true);
  });

  it("all authored guards start inside the castle bounds", () => {
    for (const guard of GUARDS) {
      for (const [x, z] of guard.waypoints) {
        expect(Math.abs(x)).toBeLessThan(12);
        expect(Math.abs(z)).toBeLessThan(9);
      }
    }
  });
});

describe("camera clipping", () => {
  const wall = { x: 0, z: 2, hw: 3, hd: 0.3, y: 0 };
  const wallBehind = { x: 0, z: -3, hw: 3, hd: 0.3, y: 0 };

  it("pulls the camera inside when a wall blocks the boom", () => {
    const clipped = clipCameraToWalls({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1.8, z: 5 }, [wall], 3.2);
    expect(clipped.z).toBeLessThan(2);
  });

  it("keeps the desired position when unobstructed", () => {
    const clipped = clipCameraToWalls({ x: 0, y: 1.5, z: 0 }, { x: 8, y: 1.8, z: 5 }, [wallBehind], 3.2);
    expect(clipped.x).toBeCloseTo(8, 5);
    expect(clipped.z).toBeCloseTo(5, 5);
  });

  it("ignores walls on other floors", () => {
    const clipped = clipCameraToWalls(
      { x: 0, y: 1.5 + 3.3 * 2, z: 0 },
      { x: 0, y: 1.8 + 3.3 * 2, z: 5 },
      [wall],
      3.2,
    );
    expect(clipped.z).toBeCloseTo(5, 5);
  });
});

describe("treasure grab", () => {
  it("grabs the treasure straight ahead within reach", () => {
    const player = { x: 0, y: 0, z: 5, yaw: 0, pitch: 0 };
    const treasures = [{ id: "t", x: 0, y: 0, z: 3.4, collected: false }];
    expect(findGrabbable(player, treasures, grabConfig)?.id).toBe("t");
  });

  it("ignores treasures behind the player", () => {
    const player = { x: 0, y: 0, z: 5, yaw: 0, pitch: 0 };
    const treasures = [{ id: "t", x: 0, y: 0, z: 7, collected: false }];
    expect(findGrabbable(player, treasures, grabConfig)).toBeNull();
  });

  it("ignores collected treasures", () => {
    const player = { x: 0, y: 0, z: 5, yaw: 0, pitch: 0 };
    const treasures = [{ id: "t", x: 0, y: 0, z: 3.4, collected: true }];
    expect(findGrabbable(player, treasures, grabConfig)).toBeNull();
  });

  it("all authored treasures sit inside the castle", () => {
    for (const treasure of TREASURES) {
      expect(Math.abs(treasure.x)).toBeLessThan(12);
      expect(Math.abs(treasure.z)).toBeLessThan(9);
    }
  });
});
