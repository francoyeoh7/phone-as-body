import { describe, expect, it } from "vitest";
import { PlayerController } from "../src/desktop/PlayerController.js";

function createPlayer() {
  return Object.assign(Object.create(PlayerController.prototype), {
    cameraYaw: 0.8,
    cameraPitch: -0.35,
    lastViewSequence: -1,
    settings: { sensitivity: 1, invertY: false },
  });
}

describe("player phone view deltas", () => {
  it("applies each view delta once in degrees", () => {
    const player = createPlayer();
    const input = { seq: 4, viewDelta: { yaw: 90, pitch: 20 } };

    player.applyPhoneViewDelta(input);
    const firstYaw = player.cameraYaw;
    player.applyPhoneViewDelta(input);

    expect(firstYaw).toBeCloseTo(0.8 + Math.PI / 2, 6);
    expect(player.cameraYaw).toBeCloseTo(firstYaw, 6);
    expect(player.cameraPitch).toBeCloseTo(-0.35 + 20 * Math.PI / 180, 6);
  });

  it("honors sensitivity, inversion, and pitch clamp", () => {
    const player = createPlayer();
    player.settings = { sensitivity: 0.5, invertY: true };
    player.cameraPitch = -1.2;

    player.applyPhoneViewDelta({ seq: 1, viewDelta: { yaw: 40, pitch: 40 } });

    expect(player.cameraYaw).toBeCloseTo(0.8 + 20 * Math.PI / 180, 6);
    expect(player.cameraPitch).toBeCloseTo(-1.25, 6);
  });
});
