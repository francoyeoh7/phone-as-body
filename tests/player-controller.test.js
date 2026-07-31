import { describe, expect, it } from "vitest";
import { PlayerController } from "../src/desktop/PlayerController.js";

function createPlayer() {
  return Object.assign(Object.create(PlayerController.prototype), {
    cameraYaw: 0.8,
    cameraPitch: -0.35,
    viewVelocity: { x: 1.2, y: -0.7 },
    phoneInput: { viewMotion: { x: 1, y: 0, confidence: 1 }, move: { x: 0, y: 0 } },
    phoneConnected: true,
    fallback: false,
    paused: false,
  });
}

describe("player view lifecycle", () => {
  it("recenter clears view velocity without changing the current camera angle", () => {
    const player = createPlayer();

    player.recenter();

    expect(player.viewVelocity).toEqual({ x: 0, y: 0 });
    expect(player.cameraYaw).toBe(0.8);
    expect(player.cameraPitch).toBe(-0.35);
  });

  it("clears view velocity on disconnect, fallback, and pause", () => {
    const player = createPlayer();

    player.setControllerInput(null, false);
    expect(player.viewVelocity).toEqual({ x: 0, y: 0 });

    player.viewVelocity = { x: 1, y: 1 };
    player.setFallback(true);
    expect(player.viewVelocity).toEqual({ x: 0, y: 0 });

    player.viewVelocity = { x: 1, y: 1 };
    player.setPaused(true);
    expect(player.viewVelocity).toEqual({ x: 0, y: 0 });
  });
});
