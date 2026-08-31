import * as THREE from "three";
import {
  FLOOR_HEIGHT, WALL_HEIGHT, WALLS, SLABS, STAIRS, PILLARS, TREASURES, GUARDS,
  GUARD_FOV_COS, GUARD_SIGHT_RANGE,
} from "./castle-layout.js";

function makeCanvasTexture(draw, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function stoneTexture(base = "#8d8578", mortar = "#5f584e") {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, size, size);
    const rows = 6;
    const brickH = size / rows;
    for (let row = 0; row < rows; row += 1) {
      const offset = row % 2 === 0 ? 0 : size / 8;
      for (let col = -1; col < 4; col += 1) {
        const x = col * (size / 4) + offset;
        const shade = 0.85 + Math.random() * 0.3;
        ctx.fillStyle = shadeColor(base, shade);
        ctx.fillRect(x + 2, row * brickH + 2, size / 4 - 4, brickH - 4);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(x + 2, row * brickH + 2, size / 4 - 4, 3);
      }
    }
  });
}

function shadeColor(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

function woodTexture() {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 24; i += 1) {
      ctx.strokeStyle = `rgba(40,24,12,${0.15 + Math.random() * 0.2})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = (i / 24) * size + Math.random() * 4;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + Math.random() * 6 - 3, size * 0.7, y + Math.random() * 6 - 3, size, y);
      ctx.stroke();
    }
  });
}

export class CastleSceneBuilder {
  constructor(scene) {
    this.scene = scene;
    this.torchFlames = [];
    this.treasureMeshes = new Map();
    this.guardMeshes = new Map();
  }

  build() {
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.042);

    this.scene.add(new THREE.AmbientLight(0x2a3040, 0.5));
    const moon = new THREE.DirectionalLight(0x8fa8d8, 0.3);
    moon.position.set(-20, 30, -14);
    this.scene.add(moon);

    const stone = stoneTexture();
    const stoneDark = stoneTexture("#6f6a5f", "#4a463e");
    const wood = woodTexture();

    const wallMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.92 });
    const floorMat = new THREE.MeshStandardMaterial({ map: stoneDark, roughness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.8 });

    this.buildFloors(floorMat);
    this.buildWalls(wallMat);
    this.buildStairs(woodMat);
    this.buildPillars(wallMat);
    this.buildTorches();
    this.buildTreasures();
    this.buildGuards();
    this.buildProps(woodMat, wallMat);
  }

  buildFloors(material) {
    for (const slab of SLABS) {
      const w = slab.x1 - slab.x0;
      const d = slab.z1 - slab.z0;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), material);
      floor.position.set((slab.x0 + slab.x1) / 2, slab.y - 0.15, (slab.z0 + slab.z1) / 2);
      floor.receiveShadow = true;
      this.scene.add(floor);
    }
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(2 * 12.6, 0.4, 2 * 9.6),
      new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 }),
    );
    roof.position.set(0, FLOOR_HEIGHT * 3 + 0.2, 0);
    this.scene.add(roof);
  }

  buildWalls(material) {
    for (const wall of WALLS) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.hw * 2, WALL_HEIGHT, wall.hd * 2),
        material,
      );
      mesh.position.set(wall.x, wall.y + WALL_HEIGHT / 2, wall.z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  buildStairs(material) {
    for (const stair of STAIRS) {
      const steps = 14;
      const run = stair.z1 - stair.z0;
      const rise = stair.toY - stair.fromY;
      for (let i = 0; i < steps; i += 1) {
        const t = i / steps;
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(Math.abs(stair.x1 - stair.x0), 0.18, Math.abs(run) / steps + 0.06),
          material,
        );
        step.position.set(
          (stair.x0 + stair.x1) / 2,
          stair.fromY + rise * t - 0.09,
          stair.z0 + run * t + run / steps / 2,
        );
        this.scene.add(step);
      }
    }
  }

  buildPillars(material) {
    for (const pillar of PILLARS) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(pillar.r, pillar.r * 1.15, FLOOR_HEIGHT, 10),
        material,
      );
      mesh.position.set(pillar.x, pillar.y + FLOOR_HEIGHT / 2, pillar.z);
      this.scene.add(mesh);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(pillar.r * 2.6, 0.3, pillar.r * 2.6), material);
      cap.position.set(pillar.x, pillar.y + FLOOR_HEIGHT - 0.15, pillar.z);
      this.scene.add(cap);
    }
  }

  buildTorches() {
    const positions = [];
    for (const floor of [0, 1, 2]) {
      const y = floor * FLOOR_HEIGHT + 2.2;
      positions.push([-11.4, y, 0], [11.4, y, 0], [0, y, -8.4]);
    }
    for (const [x, y, z] of positions) {
      const light = new THREE.PointLight(0xff8c3a, 14, 13, 1.8);
      light.position.set(x, y, z);
      this.scene.add(light);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.32, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb347 }),
      );
      flame.position.set(x, y, z);
      this.scene.add(flame);
      this.torchFlames.push({ flame, light, seed: Math.random() * 100 });

      const bracket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.06, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }),
      );
      bracket.position.set(x, y - 0.3, z);
      this.scene.add(bracket);
    }
  }

  buildTreasures() {
    for (const treasure of TREASURES) {
      const group = new THREE.Group();
      const isBig = treasure.value >= 3;
      const color = isBig ? 0xffd34d : 0x7de8ff;
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(isBig ? 0.3 : 0.2),
        new THREE.MeshStandardMaterial({
          color,
          emissive: isBig ? 0x8a6a10 : 0x1a6a80,
          emissiveIntensity: 1.2,
          roughness: 0.12,
          metalness: 0.5,
        }),
      );
      gem.position.y = 0.72;
      group.add(gem);
      const glow = new THREE.PointLight(color, isBig ? 5 : 3, 4.5, 2);
      glow.position.y = 0.8;
      group.add(glow);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.42, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.45;
      group.add(halo);
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.34, 0.42, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.9 }),
      );
      pedestal.position.y = 0.21;
      group.add(pedestal);
      group.position.set(treasure.x, treasure.y, treasure.z);
      this.scene.add(group);
      this.treasureMeshes.set(treasure.id, { group, gem, halo });
    }
  }

  buildGuards() {
    for (const guard of GUARDS) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 0.7, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x4a2430, roughness: 0.65 }),
      );
      body.position.y = 0.85;
      group.add(body);

      const belt = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.06, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.6, roughness: 0.4 }),
      );
      belt.rotation.x = Math.PI / 2;
      belt.position.y = 0.78;
      group.add(belt);

      const helm = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x9a9484, metalness: 0.7, roughness: 0.3 }),
      );
      helm.position.y = 1.64;
      group.add(helm);

      const plume = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.34, 8),
        new THREE.MeshStandardMaterial({ color: 0xc03040, roughness: 0.7 }),
      );
      plume.position.y = 1.95;
      group.add(plume);

      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.05, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xff4030 }),
      );
      eye.position.set(0, 1.62, 0.25);
      group.add(eye);

      const lanternStick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }),
      );
      lanternStick.position.set(0.5, 1.1, 0.15);
      lanternStick.rotation.z = -0.4;
      group.add(lanternStick);

      const lantern = new THREE.PointLight(0xff5030, 6, 6, 2);
      lantern.position.set(0.62, 0.85, 0.25);
      group.add(lantern);
      const lanternBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.18, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xff7050 }),
      );
      lanternBox.position.set(0.62, 0.85, 0.25);
      group.add(lanternBox);

      // Vision cone on the floor: what the guard can see, dodge this.
      const fov = 2 * Math.acos(GUARD_FOV_COS);
      const cone = new THREE.Mesh(
        new THREE.CircleGeometry(GUARD_SIGHT_RANGE, 28, Math.PI / 2 - fov / 2, fov),
        new THREE.MeshBasicMaterial({
          color: 0xffc040, transparent: true, opacity: 0.13,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      cone.rotation.x = -Math.PI / 2;
      cone.position.y = 0.06;
      group.add(cone);

      const [x, z] = guard.waypoints[0];
      group.position.set(x, guard.floorY, z);
      this.scene.add(group);
      this.guardMeshes.set(guard.id, { group, cone, eye });
    }
  }

  buildProps(woodMat, stoneMat) {
    // Crates and barrels scattered for cover and texture.
    const crates = [
      [-10, 0, -3], [-10.6, 0, -2], [9.8, 0, 1], [2, 0, 7.2],
      [-9, FLOOR_HEIGHT, 2], [9.5, FLOOR_HEIGHT, -3], [-2, FLOOR_HEIGHT * 2, -5],
    ];
    for (const [x, y, z] of crates) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), woodMat);
      crate.position.set(x, y + 0.4, z);
      crate.rotation.y = Math.random() * 0.6;
      this.scene.add(crate);
    }
    // Long table in the great hall.
    const table = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 1.2), woodMat);
    table.position.set(0, 0.78, -6);
    this.scene.add(table);
    for (const dx of [-1.8, 1.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.78, 1.0), woodMat);
      leg.position.set(dx, 0.39, -6);
      this.scene.add(leg);
    }
    // Banners on the outer walls.
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.85, side: THREE.DoubleSide });
    for (const x of [-6, 6]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.4), bannerMat);
      banner.position.set(x, 2.1, -8.55);
      this.scene.add(banner);
    }
    // Carpet from entrance to hall.
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 10),
      new THREE.MeshStandardMaterial({ color: 0x6e2430, roughness: 1 }),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.01, 3);
    this.scene.add(carpet);
    // Vault door on floor 2 south side of the treasure room.
    const vaultDoor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.15), stoneMat);
    vaultDoor.position.set(0, FLOOR_HEIGHT * 2 + 1.3, 3.05);
    this.scene.add(vaultDoor);
  }

  update(time) {
    for (const { flame, light, seed } of this.torchFlames) {
      const flicker = 0.85 + Math.sin(time * 11 + seed) * 0.08 + Math.sin(time * 23 + seed * 2) * 0.05;
      light.intensity = 14 * flicker;
      flame.scale.set(1, flicker, 1);
    }
    for (const { gem } of this.treasureMeshes.values()) {
      if (!gem.visible) continue;
      gem.rotation.y = time * 1.4;
      gem.position.y = 0.55 + Math.sin(time * 2.2) * 0.06;
    }
  }

  setTreasureCollected(id) {
    const entry = this.treasureMeshes.get(id);
    if (entry) {
      entry.group.visible = false;
    }
  }

  resetTreasures() {
    for (const entry of this.treasureMeshes.values()) entry.group.visible = true;
  }

  updateGuard(id, x, y, z, heading, alert) {
    const entry = this.guardMeshes.get(id);
    if (!entry) return;
    entry.group.position.set(x, y, z);
    entry.group.rotation.y = heading;
    if (entry.eye) entry.eye.material.color.setHex(alert > 0.5 ? 0xff2010 : 0xff7050);
    if (entry.cone) {
      const chasing = alert > 0.5;
      entry.cone.material.color.setHex(chasing ? 0xff3020 : 0xffc040);
      entry.cone.material.opacity = chasing ? 0.22 : 0.13;
    }
  }
}
