import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createNpcRoster } from "./npc-roster.js";
import { NPC_ASSETS } from "./npc-assets.js";
import { VillageNpcActor } from "./VillageNpcActor.js";

export class VillageNpcSystem {
  constructor({ scene, roster = createNpcRoster(), assets = NPC_ASSETS, loader = new GLTFLoader() } = {}) {
    if (!scene) throw new TypeError("VillageNpcSystem requires a scene");
    this.scene = scene;
    this.roster = roster;
    this.loader = loader;
    this.root = new THREE.Group();
    this.root.name = "village-npcs";
    this.actors = new Map();
    for (const asset of assets) {
      const actor = new VillageNpcActor({ definition: roster.get(asset.id), asset, loader });
      this.actors.set(asset.id, actor);
      this.root.add(actor.root);
    }
    scene.add(this.root);
  }

  async load() {
    const results = await Promise.all([...this.actors.values()].map((actor) => actor.load()));
    return { loaded: results.filter(Boolean).length, fallback: results.filter((loaded) => !loaded).length };
  }

  snapshots() {
    return [...this.actors.values()].map((actor) => actor.snapshot());
  }

  notice(id, playerPosition) {
    if (!this.actors.has(id)) return false;
    for (const [actorId, actor] of this.actors) actor.setNoticed(actorId === id, playerPosition);
    return true;
  }

  perform(id, performance, playerPosition) {
    const actor = this.actors.get(id);
    if (!actor) return false;
    actor.perform(performance, playerPosition);
    return true;
  }

  mouthFor(id) {
    return this.actors.get(id)?.mouth ?? null;
  }

  update(delta, elapsed, playerPosition) {
    for (const actor of this.actors.values()) actor.update(delta, elapsed, playerPosition);
  }

  destroy() {
    for (const actor of this.actors.values()) actor.destroy();
    this.actors.clear();
    this.root.removeFromParent();
  }
}
