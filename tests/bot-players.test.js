import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { BotPlayers } from "../src/desktop/game/BotPlayers.js";

function makeLoader() {
  const template = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshBasicMaterial());
  template.add(body);
  return { loadAsync: vi.fn(async () => ({ scene: template, animations: [] })) };
}

function makeBots(count = 2) {
  const bots = new BotPlayers({
    scene: new THREE.Scene(),
    loader: makeLoader(),
    rng: () => 0.5,
    RAPIER: null,
    world: null,
  });
  return bots.load(count, [0, 0, 0]).then(() => bots);
}

describe("BotPlayers interactability", () => {
  it("stamps each bot root with its interactable id so raycast hits resolve", async () => {
    const bots = await makeBots(2);
    expect(bots.bots[0].root.userData.interactableId).toBe("bot-1");
    expect(bots.bots[1].root.userData.interactableId).toBe("bot-2");
  });

  it("anchors bot interaction at chest height so assisted targeting can reach", async () => {
    const bots = await makeBots(1);
    const bot = bots.bots[0];
    const anchorWorld = new THREE.Vector3();
    bot.interaction.anchor.getWorldPosition(anchorWorld);
    expect(anchorWorld.y).toBeGreaterThan(1.0);
    expect(anchorWorld.y).toBeLessThan(1.8);
    expect(bot.root.children).toContain(bot.interaction.anchor);
  });
});
