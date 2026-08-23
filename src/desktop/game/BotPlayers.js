import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

// Bubba-cloned stand-in players. They wander the village, stop to "loot" at
// random pauses, and earn coins on a deterministic schedule so the round
// rankings stay meaningful in solo/keyboard test sessions.

const BOT_WANDER_SPEED = 1.35;
const BOT_TURN_RATE = 6;

export class BotPlayers {
  constructor({ scene, loader = new GLTFLoader(), characterUrl = "/assets/characters/bubba.glb", bounds = null, rng = Math.random, RAPIER = null, world = null }) {
    this.scene = scene;
    this.loader = loader;
    this.characterUrl = characterUrl;
    this.rng = rng;
    this.RAPIER = RAPIER;
    this.world = world;
    this.bounds = bounds ?? { min: [-14, 0, -14], max: [14, 0, 14] };
    this.bots = [];
    this.template = null;
    this.templateClips = null;
    this.loaded = false;
  }

  async load(count = 4, spawnCenter = [6.5, 0, -2]) {
    const gltf = await this.loader.loadAsync(this.characterUrl);
    this.template = gltf.scene;
    this.templateClips = gltf.animations;
    this.template.traverse((object) => {
      if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
    });

    for (let index = 0; index < count; index += 1) {
      const clone = SkeletonUtils.clone(this.template);
      clone.traverse((object) => {
        if (object.isMesh) {
          object.frustumCulled = false;
          // SkeletonUtils.clone shares materials — each bot needs its own so a
          // highlight/interaction on one never tints the others.
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const cloned = materials.map((material) => material?.clone?.() ?? material);
          object.material = Array.isArray(object.material) ? cloned : cloned[0];
        }
      });

      // Bots carry their own flashlight that points where they face.
      const torch = new THREE.SpotLight(0xffe0b0, 10, 18, Math.PI / 6.5, 0.55, 1.5);
      torch.position.set(0, 1.35, 0.18);
      const torchTarget = new THREE.Object3D();
      torchTarget.position.set(0, 1.1, 4);
      torch.target = torchTarget;
      clone.add(torch, torchTarget);
      const angle = (index / count) * Math.PI * 2 + 0.7;
      const radius = 5 + index * 2.2;
      const x = spawnCenter[0] + Math.cos(angle) * radius;
      const z = spawnCenter[2] + Math.sin(angle) * radius;
      clone.position.set(x, 0, z);
      this.scene.add(clone);
      const mixer = new THREE.AnimationMixer(clone);
      const actions = {};
      for (const clip of this.templateClips) actions[clip.name] = mixer.clipAction(clip);

      // Each bot gets the same kinematic character controller as the player so
      // walls and fences actually block them.
      let body = null;
      let collider = null;
      let controller = null;
      if (this.RAPIER && this.world) {
        body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 1.05, z));
        collider = this.world.createCollider(this.RAPIER.ColliderDesc.capsule(0.52, 0.32), body);
        // Bots collide with the environment (group 1) but not with the player
        // (group 2) or each other — no more capsule-on-capsule jitter.
        collider.setCollisionGroups((0x4 << 16) | 0x1);
        controller = this.world.createCharacterController(0.02);
        controller.enableAutostep(0.3, 0.16, true);
        controller.enableSnapToGround(0.3);
      }

      const bot = {
        // ids align with the elimination state players: "bot-1".."bot-4".
        id: `bot-${index + 1}`,
        label: ["猎手", "旅人", "工匠", "守夜人"][index] ?? `玩家 ${index + 1}`,
        enabled: true,
        root: clone,
        body,
        collider,
        controller,
        mixer,
        actions,
        current: null,
        target: this.randomPoint(),
        pauseUntil: this.rng() * 2,
        speed: 0,
        eliminated: false,
        interaction: null,
      };
      // Raycast resolves a hit by walking up to a userData.interactableId —
      // stations and crates stamp their roots, bots must too. The assisted
      // fallback aims at the interaction anchor, so it sits at chest height:
      // an anchor at the feet is geometrically unreachable from eye height.
      clone.userData.interactableId = bot.id;
      const chestAnchor = new THREE.Object3D();
      chestAnchor.name = "interaction-anchor";
      chestAnchor.position.set(0, 1.35, 0);
      clone.add(chestAnchor);
      bot.interaction = {
        anchor: chestAnchor,
        contactRadius: 0.4,
        maxUseDistance: 2.4,
        approachDirection: null,
        contactNormal: new THREE.Vector3(0, 1, 0),
      };
      this.play(bot, "idle");
      this.bots.push(bot);
    }
    this.loaded = true;
  }

  randomPoint() {
    const [minX, , minZ] = this.bounds.min;
    const [maxX, , maxZ] = this.bounds.max;
    return new THREE.Vector3(
      minX + this.rng() * (maxX - minX),
      0,
      minZ + this.rng() * (maxZ - minZ),
    );
  }

  play(bot, name) {
    if (bot.current === name || !bot.actions[name]) return;
    const previous = bot.current ? bot.actions[bot.current] : null;
    const next = bot.actions[name];
    next.reset().play();
    if (previous) previous.crossFadeTo(next, 0.25, false);
    bot.current = name;
  }

  eliminate(botId) {
    const bot = this.bots.find((entry) => entry.id === botId);
    if (!bot || bot.eliminated) return;
    bot.eliminated = true;
    bot.root.visible = false;
  }

  setBotVisible(botId, visible) {
    const bot = this.bots.find((entry) => entry.id === botId);
    if (bot && !bot.eliminated) bot.root.visible = visible;
  }

  update(delta, elapsed, eliminatedIds = new Set()) {
    if (!this.loaded) return;
    for (const bot of this.bots) {
      if (eliminatedIds.has(bot.id) && !bot.eliminated) this.eliminate(bot.id);
      if (bot.eliminated) continue;
      bot.mixer.update(delta);

      if (elapsed < bot.pauseUntil) {
        // Hard stop while pausing: any residual speed reads as ice-skating.
        bot.speed = 0;
        if (bot.current !== "idle") this.play(bot, "idle");
        continue;
      }

      const position = bot.root.position;
      const toTarget = bot.target.clone().sub(position);
      toTarget.y = 0;
      const distance = toTarget.length();
      if (distance < 0.35) {
        bot.target = this.randomPoint();
        bot.pauseUntil = elapsed + 1.5 + this.rng() * 3.5;
        bot.speed = 0;
        this.play(bot, "idle");
        continue;
      }

      toTarget.normalize();
      const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
      let yawDelta = desiredYaw - bot.root.rotation.y;
      yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
      bot.root.rotation.y += yawDelta * Math.min(1, BOT_TURN_RATE * delta);
      bot.speed = Math.min(BOT_WANDER_SPEED, bot.speed + BOT_WANDER_SPEED * 2 * delta);

      if (bot.controller && bot.collider) {
        // Physics-driven movement: walls, fences, and props block the bot.
        // No vertical drift: there is no ground collider, so bots stay level
        // like the player (the village terrain is near-flat).
        bot.controller.computeColliderMovement(bot.collider, {
          x: toTarget.x * bot.speed * delta,
          y: 0,
          z: toTarget.z * bot.speed * delta,
        });
        const movement = bot.controller.computedMovement();
        const t = bot.body.translation();
        bot.body.setNextKinematicTranslation({ x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z });
        const next = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
        bot.root.position.set(next.x, next.y - 1.05, next.z);
        // Stuck against something? Retarget instead of pushing forever.
        const moved = Math.hypot(movement.x, movement.z);
        if (moved < bot.speed * delta * 0.2) {
          bot.target = this.randomPoint();
          bot.speed = 0;
        }
      } else {
        position.x += toTarget.x * bot.speed * delta;
        position.z += toTarget.z * bot.speed * delta;
      }
      if (bot.speed > 0.15) this.play(bot, "walk");
    }
  }

  dispose() {
    for (const bot of this.bots) {
      bot.mixer.stopAllAction();
      this.scene.remove(bot.root);
      if (this.world && bot.body) {
        this.world.removeCharacterController(bot.controller);
        this.world.removeCollider(bot.collider, true);
        this.world.removeRigidBody(bot.body);
      }
    }
    this.bots = [];
    this.loaded = false;
  }
}
