import * as THREE from "three";
import {
  createEliminationState,
  awardCoins,
  alivePlayers,
  settleRound,
  advanceRound,
  rollLoot,
  giveMaterial,
  giveItem,
  takeItem,
  ELIMINATION_RULES,
} from "./elimination-state.js";
import { BotPlayers } from "./BotPlayers.js";
import { RECIPES, MATERIAL_LABELS, craft as craftItem } from "./crafting.js";
import { createBulletinBoard, postAutoTask, claimTask, completeTask, postListing, buyListing } from "./bulletin-board.js";
import { pickpocketCoins, pickpocketItem } from "./pickpocket.js";

const CRATE_COUNT = 14;
const CRATE_OPEN_SECONDS = 1.6;
const CRATE_REACH = 2.6;
const BOT_COIN_INTERVAL = [6, 11];
const BOT_COIN_AMOUNT = [12, 30];
const ROUND_END_BANNER_SECONDS = 7;

function makeCrateMesh() {
  const group = new THREE.Group();
  group.name = "loot-crate";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.42, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x6b4f2e, roughness: 0.9, metalness: 0.05 }),
  );
  body.position.y = 0.21;
  body.castShadow = true;
  body.receiveShadow = true;
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.1, 0.46),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.85, metalness: 0.05 }),
  );
  lid.position.y = 0.47;
  lid.castShadow = true;
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.44, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3c3226, roughness: 0.7, metalness: 0.3 }),
  );
  band.position.y = 0.24;
  group.add(body, lid, band);
  group.userData.lid = lid;
  return group;
}

export class EliminationDirector {
  constructor({ experience, ui, audio, inventory, botFactory = null, rng = Math.random, onBotInteract = null, onCraftStation = null, onBulletinBoard = null }) {
    this.experience = experience;
    this.ui = ui;
    this.audio = audio;
    this.inventory = inventory;
    this.rng = rng;
    this.onBotInteract = onBotInteract;
    this.onCraftStation = onCraftStation;
    this.onBulletinBoard = onBulletinBoard;
    this.destroyed = false;
    this.state = createEliminationState({
      playerNames: ["你", "猎手", "旅人", "工匠", "守夜人"],
      seed: (Date.now() ^ 0x9e3779b9) >>> 0,
    });
    this.roundEndsAt = this.state.rules.roundSeconds;
    this.bannerUntil = 0;
    this.crates = [];
    this.parts = 0;
    this.openingCrate = null;
    this.bots = botFactory ? botFactory() : new BotPlayers({
      scene: experience.scene,
      rng: this.rng,
      bounds: { min: [-14, 0, -14], max: [14, 0, 14] },
      RAPIER: experience.RAPIER,
      world: experience.world,
    });
    this.botCoinTimers = new Map();
    this.disposers = [];
    this.board = createBulletinBoard({ seed: (Date.now() ^ 0x1b873593) >>> 0 });
  }

  async load() {
    // The story NPCs are voice-driven (phone); in keyboard elimination mode they
    // only block the view, so they stay hidden. The four bot players replace them.
    const storyNpcs = this.experience.objects?.npcs;
    if (storyNpcs?.root) storyNpcs.root.visible = false;
    this.spawnCrates();
    this.spawnSubmitStation();
    this.spawnMaterialPickups();
    this.spawnStations();
    // Bots carry starting stock so pickpocketing has something to find.
    for (const player of this.state.players) {
      if (player.isLocal) continue;
      giveItem(this.state, player.id, `watch-${player.id}`, "旧怀表");
      giveItem(this.state, player.id, `pouch-${player.id}`, "钱袋");
      giveMaterial(this.state, player.id, "stone", 1);
      giveMaterial(this.state, player.id, "wood", 1);
      giveMaterial(this.state, player.id, "part", 1);
    }
    const spawn = this.experience.spawn?.position ?? [6.5, 0, -2];
    await this.bots.load(4, [spawn[0], 0, spawn[2]]);
    for (const bot of this.bots.bots ?? []) {
      this.experience.interactables?.push?.({
        id: bot.id,
        label: bot.label,
        enabled: true,
        root: bot.root,
        interaction: bot.interaction,
      });
    }
    this.ui?.setObjective?.("搜集金币。三轮末位淘汰，别垫底。");
    this.updateHud();
    // Auto-post two starter errands so the board is never empty.
    postAutoTask(this.board);
    postAutoTask(this.board);
  }

  spawnSubmitStation() {
    const panel = this.experience.objects?.environment?.manifest?.tasks?.panel;
    const position = panel?.position ?? [10, 0.9, -8.4];
    const station = new THREE.Group();
    station.name = "submit-station";
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.1, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6, metalness: 0.4 }),
    );
    post.position.y = 0.55;
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.08, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xc9a55b, roughness: 0.4, metalness: 0.6, emissive: 0x2a1f08 }),
    );
    tray.position.y = 1.12;
    station.add(post, tray);
    station.position.set(position[0] + 1.2, 0, position[2] + 0.6);
    station.traverse((object) => { if (object.isMesh) object.castShadow = true; });
    this.experience.scene.add(station);
    this.submitStation = station;
    this.experience.interactables?.push?.({
      id: "submit-station",
      label: "提交零件",
      enabled: true,
      root: station,
      interaction: {
        anchor: station,
        contactRadius: 0.35,
        maxUseDistance: 2.4,
        approachDirection: null,
        contactNormal: new THREE.Vector3(0, 1, 0),
      },
    });
  }

  // Ground material pickups: small distinct meshes scattered in the village.
  spawnMaterialPickups() {
    const definitions = [
      { material: "stone", label: "石头", color: 0x8a8f8a, shape: "rock", count: 6 },
      { material: "wood", label: "木棍", color: 0x7a5c34, shape: "stick", count: 6 },
      { material: "herb", label: "药草", color: 0x4a7a3a, shape: "plant", count: 5 },
      { material: "bottle", label: "玻璃瓶", color: 0x9fc8d8, shape: "bottle", count: 4 },
      { material: "part", label: "零件", color: 0xb08d3c, shape: "gear", count: 4 },
    ];
    const bounds = { min: [-13, 0, -13], max: [13, 0, 13] };
    for (const def of definitions) {
      for (let index = 0; index < def.count; index += 1) {
        const mesh = this.makePickupMesh(def);
        const x = bounds.min[0] + this.rng() * (bounds.max[0] - bounds.min[0]);
        const z = bounds.min[2] + this.rng() * (bounds.max[2] - bounds.min[2]);
        mesh.position.set(x, 0, z);
        this.experience.scene.add(mesh);
        const id = `pickup-${def.material}-${index}`;
        mesh.userData.interactableId = id;
        this.experience.interactables?.push?.({
          id,
          label: `捡起${def.label}`,
          enabled: true,
          root: mesh,
          interaction: {
            anchor: mesh,
            contactRadius: 0.25,
            maxUseDistance: 2.2,
            approachDirection: null,
            contactNormal: new THREE.Vector3(0, 1, 0),
          },
          materialId: def.material,
        });
      }
    }
  }

  makePickupMesh(def) {
    const group = new THREE.Group();
    group.name = `pickup-${def.material}`;
    let mesh;
    if (def.shape === "stick") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.9 }));
      mesh.rotation.z = Math.PI / 2.3;
      mesh.position.y = 0.06;
    } else if (def.shape === "bottle") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 8), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 }));
      mesh.position.y = 0.11;
    } else if (def.shape === "plant") {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), new THREE.MeshStandardMaterial({ color: def.color, roughness: 1 }));
      mesh.position.y = 0.15;
    } else if (def.shape === "gear") {
      mesh = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.04, 6, 10), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4, metalness: 0.7 }));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.05;
    } else {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ color: def.color, roughness: 1 }));
      mesh.position.y = 0.09;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  // Crafting station + bulletin board as physical anchors in the village.
  spawnStations() {
    const craft = this.makeStationMesh("合成台", 0x4a5568);
    craft.position.set(-6.5, 0, -6.5);
    this.experience.scene.add(craft);
    this.registerStation(craft, "craft-station", "合成台");

    const board = this.makeBoardMesh();
    board.position.set(8.5, 0, 3.5);
    this.experience.scene.add(board);
    this.registerStation(board, "bulletin-board", "公告栏");
  }

  makeStationMesh(label, color) {
    const group = new THREE.Group();
    group.name = `station-${label}`;
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.08, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x6b4f2e, roughness: 0.85 }),
    );
    table.position.y = 0.85;
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.85, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a3227, roughness: 0.95 }),
    );
    legs.position.y = 0.42;
    const tool = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.5 }),
    );
    tool.position.y = 0.98;
    group.add(table, legs, tool);
    group.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    return group;
  }

  makeBoardMesh() {
    const group = new THREE.Group();
    group.name = "station-公告栏";
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 2.0, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95 }),
    );
    post.position.y = 1.0;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.0, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x2c2418, roughness: 0.9, emissive: 0x17130a, emissiveIntensity: 0.6 }),
    );
    panel.position.set(0, 1.5, 0.05);
    group.add(post, panel);
    group.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    return group;
  }

  registerStation(root, id, label) {
    root.userData.interactableId = id;
    this.experience.interactables?.push?.({
      id,
      label,
      enabled: true,
      root,
      interaction: {
        anchor: root,
        contactRadius: 0.4,
        maxUseDistance: 2.5,
        approachDirection: null,
        contactNormal: new THREE.Vector3(0, 1, 0),
      },
    });
  }

  spawnCrates() {
    const { scene } = this.experience;
    const bounds = { min: [-14, 0, -14], max: [14, 0, 14] };
    const used = [];
    for (let index = 0; index < CRATE_COUNT; index += 1) {
      let point = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const x = bounds.min[0] + this.rng() * (bounds.max[0] - bounds.min[0]);
        const z = bounds.min[2] + this.rng() * (bounds.max[2] - bounds.min[2]);
        if (used.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > 2.4 ** 2)) {
          point = { x, z };
          break;
        }
      }
      if (!point) continue;
      const crate = makeCrateMesh();
      crate.position.set(point.x, 0, point.z);
      crate.rotation.y = this.rng() * Math.PI * 2;
      scene.add(crate);
      const entry = {
        id: `crate-${index}`,
        label: "开启箱子",
        enabled: true,
        root: crate,
        opened: false,
        openedAt: 0,
        interaction: {
          anchor: crate,
          contactRadius: 0.3,
          maxUseDistance: CRATE_REACH,
          approachDirection: null,
          contactNormal: new THREE.Vector3(0, 1, 0),
        },
      };
      crate.userData.interactableId = entry.id;
      this.crates.push(entry);
      this.experience.interactables?.push?.(entry);
    }
  }

  handleInteraction(id, details = {}) {
    if (this.destroyed || this.state.phase !== "playing") return false;
    if (id === "submit-station") return this.submitParts();
    if (id === "craft-station") {
      this.onCraftStation?.();
      return true;
    }
    if (id === "bulletin-board") {
      this.onBulletinBoard?.();
      return true;
    }
    if (/^pickup-/.test(id)) return this.collectPickup(id);
    if (/^bot-\d+$/.test(id)) {
      const bot = this.state.players.find((player) => player.id === id);
      if (!bot?.alive) return false;
      if (typeof this.onBotInteract === "function") {
        this.onBotInteract(bot, details);
        return true;
      }
      this.ui?.setSubtitle?.(`${bot.name} 盯着你。`, true);
      return true;
    }
    const crate = this.crates.find((entry) => entry.id === id);
    if (!crate || crate.opened || this.openingCrate) return false;
    this.openingCrate = { id, startedAt: this.elapsed ?? 0 };
    this.ui?.setPrompt?.("开启中…");
    return true;
  }

  collectPickup(id) {
    const entry = this.experience.interactables?.find?.((item) => item.id === id);
    if (!entry?.materialId || !entry.enabled) return false;
    entry.enabled = false;
    entry.root.visible = false;
    giveMaterial(this.state, "local", entry.materialId, 1);
    this.audio?.cue?.("pickup");
    this.ui?.setSubtitle?.(`捡到【${MATERIAL_LABELS[entry.materialId] ?? entry.materialId}】`, true);
    this.updateHud();
    return true;
  }

  getLocalCoins() {
    return this.state.players.find((player) => player.isLocal)?.coins ?? 0;
  }

  getLocalItems() {
    return this.state.players.find((player) => player.isLocal)?.items ?? [];
  }

  receiveLocalItem(itemId, label) {
    return giveItem(this.state, "local", itemId, label ?? itemId);
  }

  spendLocalCoins(amount) {
    const local = this.state.players.find((player) => player.isLocal);
    if (!local || local.coins < amount) return false;
    local.coins -= Math.round(amount);
    this.updateHud();
    return true;
  }

  earnLocalCoins(amount) {
    awardCoins(this.state, "local", amount);
    this.updateHud();
  }

  openCrate(crate) {
    crate.opened = true;
    crate.enabled = false;
    const loot = rollLoot(this.state);
    const lid = crate.root.userData.lid;
    if (lid) {
      lid.rotation.x = -0.9;
      lid.position.z = -0.2;
      lid.position.y = 0.52;
    }
    crate.root.traverse((object) => {
      if (object.isMesh) {
        object.material = object.material.clone();
        object.material.color.multiplyScalar(0.55);
      }
    });
    this.audio?.cue?.("pickup");
    if (loot.id === "part") {
      this.parts += 1;
      this.ui?.setSubtitle?.(`摸到【${loot.label}】——去提交点换大钱`, true);
    } else {
      awardCoins(this.state, "local", loot.coins);
      this.ui?.setSubtitle?.(`摸到【${loot.label}】+${loot.coins} 金币`, true);
    }
    this.updateHud();
  }

  submitParts() {
    if (this.parts <= 0) return false;
    const payout = this.parts * 120;
    this.parts = 0;
    awardCoins(this.state, "local", payout);
    this.audio?.cue?.("pickup");
    this.ui?.setSubtitle?.(`提交零件，+${payout} 金币`, true);
    this.updateHud();
    return true;
  }

  // --- pickpocket (crouched behind a bot) ---
  pickpocket(botId, kind) {
    const result = kind === "coins"
      ? pickpocketCoins(this.state, "local", botId)
      : pickpocketItem(this.state, "local", botId);
    if (!result.ok) {
      this.ui?.setSubtitle?.(result.reason === "empty" ? "对方身上没有这个。" : "偷不到。", true);
      return false;
    }
    this.audio?.cue?.("pickup");
    if (result.kind === "coins") this.ui?.setSubtitle?.(`偷到 ${result.amount} 金币`, true);
    else this.ui?.setSubtitle?.(`偷到【${result.item.label}】`, true);
    this.updateHud();
    return true;
  }

  // --- crafting station ---
  getLocalMaterials() {
    return this.state.players.find((player) => player.isLocal)?.materials ?? {};
  }

  craft(recipeId) {
    const result = craftItem(this.state, "local", recipeId);
    if (!result.ok) return false;
    this.audio?.cue?.("objective");
    this.ui?.setSubtitle?.(`合成了【${result.item.label}】`, true);
    this.updateHud();
    return true;
  }

  // --- bulletin board ---
  claimBoardTask(taskId) {
    const result = claimTask(this.board, taskId, "local");
    if (result.ok) {
      this.ui?.setSubtitle?.(`接下任务：${result.task.description}`, true);
      this.audio?.cue?.("ui-tick");
    } else {
      this.ui?.setSubtitle?.("这个任务被人抢先了。", true);
    }
    return result.ok;
  }

  completeBoardTask(taskId) {
    const result = completeTask(this.board, taskId, "local");
    if (result.ok) {
      awardCoins(this.state, "local", result.reward);
      this.ui?.setSubtitle?.(`交任务，+${result.reward} 金币`, true);
      this.audio?.cue?.("objective");
      this.updateHud();
    }
    return result.ok;
  }

  buyBoardListing(listingId) {
    const listing = this.board.listings.find((entry) => entry.id === listingId);
    if (!listing) return false;
    if (!this.spendLocalCoins(listing.price)) {
      this.ui?.setSubtitle?.("金币不够。", true);
      return false;
    }
    const result = buyListing(this.board, listingId, "local");
    if (result.ok) {
      // Seller gets the coins if they're a bot; item goes to me.
      awardCoins(this.state, listing.sellerId, listing.price);
      giveItem(this.state, "local", listing.itemId, listing.label);
      this.ui?.setSubtitle?.(`买到【${listing.label}】，-${listing.price} 金币`, true);
      this.audio?.cue?.("pickup");
      this.updateHud();
    }
    return result.ok;
  }

  sellBoardItem(itemId, price) {
    const local = this.state.players.find((player) => player.isLocal);
    const item = local?.items.find((entry) => entry.id === itemId);
    if (!item) return false;
    // Item leaves my backpack until sold; a bot may buy it later.
    takeItem(this.state, "local", itemId);
    postListing(this.board, { sellerId: "local", itemId, label: item.label, price });
    this.ui?.setSubtitle?.(`挂售【${item.label}】，定价 ${price} 金币`, true);
    return true;
  }

  updateHud() {
    const local = this.state.players.find((player) => player.isLocal);
    this.ui?.setGameStatus?.({
      coins: local?.coins ?? 0,
      parts: this.parts,
      round: this.state.round,
      rounds: this.state.rules.rounds,
      alive: alivePlayers(this.state).length,
      phase: this.state.phase,
    });
  }

  update(delta, elapsed) {
    if (this.destroyed) return;
    this.elapsed = elapsed;

    // Crate channel: the open started by E completes after CRATE_OPEN_SECONDS.
    if (this.openingCrate) {
      const crate = this.crates.find((entry) => entry.id === this.openingCrate.id);
      const camera = this.experience.camera;
      const distance = crate ? crate.root.position.distanceTo(camera.position) : Infinity;
      if (!crate || crate.opened || distance > CRATE_REACH + 0.6) {
        this.openingCrate = null;
        this.ui?.setPrompt?.(null);
      } else if (elapsed - this.openingCrate.startedAt >= CRATE_OPEN_SECONDS) {
        this.openCrate(crate);
        this.openingCrate = null;
        this.ui?.setPrompt?.(null);
      } else {
        const progress = (elapsed - this.openingCrate.startedAt) / CRATE_OPEN_SECONDS;
        this.ui?.setPrompt?.(`开启中 ${Math.round(progress * 100)}%`);
      }
    }

    // Bots loot on their own schedule so the ranking keeps moving.
    if (this.state.phase === "playing") {
      for (const player of this.state.players) {
        if (player.isLocal || !player.alive) continue;
        const nextAt = this.botCoinTimers.get(player.id) ?? elapsed + this.rollBotInterval();
        if (elapsed >= nextAt) {
          const amount = BOT_COIN_AMOUNT[0] + Math.floor(this.rng() * (BOT_COIN_AMOUNT[1] - BOT_COIN_AMOUNT[0]));
          awardCoins(this.state, player.id, amount);
          this.botCoinTimers.set(player.id, elapsed + this.rollBotInterval());
        } else {
          this.botCoinTimers.set(player.id, nextAt);
        }
      }
    }

    this.bots.update(delta, elapsed, new Set(this.state.players.filter((p) => !p.alive).map((p) => p.id)));

    if (this.state.phase === "playing" && elapsed >= this.roundEndsAt) {
      const summary = settleRound(this.state);
      if (summary) {
        const lines = summary.rankings.map((p, i) => `${i + 1}. ${p.name} — ${p.coins} 金币`);
        const eliminatedLine = summary.eliminated ? `淘汰：${summary.eliminated.name}` : "";
        this.bannerUntil = elapsed + ROUND_END_BANNER_SECONDS;
        this.audio?.cue?.(summary.localWon ? "objective" : "door-fail");
        if (summary.finished) {
          this.ui?.setSubtitle?.(`终局。${summary.localWon ? "你活下来了，获胜！" : "你被淘汰了。"}\n${lines.join("\n")}`, true);
          this.ui?.setObjective?.(summary.localWon ? "胜利" : "已淘汰");
        } else {
          this.ui?.setSubtitle?.(`第 ${summary.round} 轮结算\n${lines.join("\n")}\n${eliminatedLine}`, true);
          this.ui?.setObjective?.(`第 ${summary.round + 1} 轮开始——别垫底。`);
        }
        this.updateHud();
      }
    }

    if (this.state.phase === "round-end" && elapsed >= this.bannerUntil) {
      advanceRound(this.state);
      this.roundEndsAt = elapsed + this.state.rules.roundSeconds;
      this.ui?.setSubtitle?.(null, false);
      this.updateHud();
    }

    // HUD timer refresh
    this.ui?.setGameStatus?.({
      coins: this.state.players.find((p) => p.isLocal)?.coins ?? 0,
      parts: this.parts,
      round: this.state.round,
      rounds: this.state.rules.rounds,
      alive: alivePlayers(this.state).length,
      phase: this.state.phase,
      secondsLeft: this.state.phase === "playing" ? Math.max(0, Math.ceil(this.roundEndsAt - elapsed)) : 0,
    });
  }

  rollBotInterval() {
    return BOT_COIN_INTERVAL[0] + this.rng() * (BOT_COIN_INTERVAL[1] - BOT_COIN_INTERVAL[0]);
  }

  destroy() {
    this.destroyed = true;
    this.bots.dispose();
    for (const crate of this.crates) crate.root.removeFromParent();
    this.crates = [];
    this.submitStation?.removeFromParent();
  }
}

export { ELIMINATION_RULES };
