import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { createExitDoor } from "./ExitDoor.js";
import { createFoundPhoneProp } from "./FoundPhoneProp.js";
import { createWashbasinState } from "./Washbasin.js";
import { createCorridorLayout } from "./CorridorLayout.js";

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function makeTexture(base, accent, seed = 7) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);
  for (let index = 0; index < 1600; index += 1) {
    const alpha = 0.035 + random() * 0.12;
    context.fillStyle = accent.replace("ALPHA", alpha.toFixed(3));
    const x = random() * 512;
    const y = random() * 512;
    const size = 1 + random() * 10;
    context.fillRect(x, y, size, size * (0.4 + random() * 1.4));
  }
  for (let index = 0; index < 28; index += 1) {
    context.strokeStyle = accent.replace("ALPHA", "0.13");
    context.lineWidth = 0.5 + random() * 1.8;
    context.beginPath();
    context.moveTo(random() * 512, random() * 512);
    context.lineTo(random() * 512, random() * 512);
    context.stroke();
  }
  context.globalAlpha = 0.12;
  context.strokeStyle = accent.replace("ALPHA", "1");
  context.lineWidth = 1;
  for (let x = 12; x < 512; x += 18 + random() * 24) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + (random() - 0.5) * 5, 512);
    context.stroke();
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function material(texture, roughness = 0.88, color = 0xffffff, bumpScale = 0.055) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color,
    roughness,
    metalness: 0.04,
    bumpMap: texture,
    bumpScale,
  });
}

function box(scene, geometry, surface, position, rotation = null) {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addFixedCollider(world, x, y, z, hx, hy, hz) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  return world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
}

function addLayoutMesh(scene, volume, surface) {
  const mesh = box(scene, new THREE.BoxGeometry(...volume.size), surface, volume.position, volume.rotation ?? null);
  mesh.name = volume.id;
  mesh.userData.corridorSegment = volume.segment;
  return mesh;
}

function addLayoutCollider(world, collider) {
  const fixed = addFixedCollider(world, ...collider.position, ...collider.halfExtents);
  if (fixed) fixed.userData = { ...(fixed.userData ?? {}), corridorId: collider.id, corridorSegment: collider.segment };
  return fixed;
}

function makeLabelTexture(label, background = "#bcb7a2", ink = "#21231f") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 128);
  context.fillStyle = ink;
  context.font = "700 24px monospace";
  context.fillText(label, 18, 52);
  context.font = "12px sans-serif";
  context.fillText("MAINTENANCE / 617", 18, 81);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addDoor(scene, wallX, z, side, doorMaterial, trimMaterial) {
  const group = new THREE.Group();
  group.position.set(wallX, 0, z);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 1.04), trimMaterial);
  trim.position.set(side * -0.16, 1.2, 0);
  trim.castShadow = true;
  group.add(trim);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.15, 0.88), doorMaterial);
  panel.position.set(side * -0.24, 1.08, 0);
  panel.castShadow = true;
  group.add(panel);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.15, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x8b815c, metalness: 0.7, roughness: 0.35 }),
  );
  plate.position.set(side * -0.31, 1.46, side * 0.28);
  group.add(plate);
  scene.add(group);
}

function addInteractable(scene, id, label, position, geometry, surface) {
  const root = new THREE.Group();
  root.position.set(...position);
  root.userData.interactableId = id;
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.28;
  halo.visible = false;
  root.add(halo);
  scene.add(root);
  return { id, label, root, mesh, halo, enabled: true };
}

export function createWashbasin(scene, position, darkMetalMaterial) {
  const root = new THREE.Group();
  root.name = "washbasin";
  root.position.set(...position);
  root.userData.interactableId = "washbasin";

  const ceramicMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d6ca, roughness: 0.2, metalness: 0.02 });
  const ceramicEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b8ad, roughness: 0.32, metalness: 0.02 });
  const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4541, roughness: 0.58, metalness: 0.12 });
  const chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xa8b0aa, roughness: 0.18, metalness: 0.92 });
  const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x1c211f, roughness: 0.72, metalness: 0.08 });
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x83d4df,
    emissive: 0x16454a,
    emissiveIntensity: 0.16,
    roughness: 0.08,
    metalness: 0.04,
    transmission: 0.24,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  const waterSurfaceMaterial = waterMaterial.clone();
  waterSurfaceMaterial.opacity = 0.58;
  const rippleMaterial = new THREE.MeshBasicMaterial({
    color: 0xa8f5f4,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const countertop = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.18, 1.12), counterMaterial);
  countertop.position.set(-0.45, 0.12, 0);
  countertop.castShadow = true;
  countertop.receiveShadow = true;
  root.add(countertop);

  const backsplash = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.92, 1.18), ceramicEdgeMaterial);
  backsplash.position.set(0.03, 0.46, 0);
  backsplash.castShadow = true;
  root.add(backsplash);

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.44, 0.24, 32, 1, true), ceramicMaterial);
  bowl.position.set(-0.52, 0.3, 0);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  root.add(bowl);
  const bowlRim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.055, 10, 32), ceramicMaterial);
  bowlRim.rotation.x = Math.PI / 2;
  bowlRim.position.set(-0.52, 0.43, 0);
  root.add(bowlRim);
  const basinWater = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.018, 32), waterSurfaceMaterial);
  basinWater.position.set(-0.52, 0.405, 0);
  root.add(basinWater);
  const drain = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), darkMetalMaterial);
  drain.rotation.x = Math.PI / 2;
  drain.position.set(-0.52, 0.42, 0);
  root.add(drain);

  const faucetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.1, 0.42, 0),
    new THREE.Vector3(-0.1, 0.94, 0),
    new THREE.Vector3(-0.22, 1.08, 0),
    new THREE.Vector3(-0.46, 1.08, 0),
    new THREE.Vector3(-0.52, 0.93, 0),
  ]);
  const faucet = new THREE.Mesh(new THREE.TubeGeometry(faucetCurve, 20, 0.055, 10, false), chromeMaterial);
  faucet.castShadow = true;
  root.add(faucet);
  const faucetBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 18), chromeMaterial);
  faucetBase.position.set(-0.1, 0.44, 0);
  root.add(faucetBase);

  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 16), chromeMaterial);
    handle.position.set(-0.12, 0.46, side * 0.26);
    handle.rotation.x = Math.PI / 2;
    root.add(handle);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({
      color: side < 0 ? 0x9c3935 : 0x4b7288,
      roughness: 0.38,
      metalness: 0.3,
    }));
    cap.position.set(-0.19, 0.52, side * 0.26);
    root.add(cap);
  }

  const supplyPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.64, 10), rubberMaterial);
  supplyPipe.position.set(0.11, 0.22, 0);
  root.add(supplyPipe);
  const wallClamp = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16), chromeMaterial);
  wallClamp.rotation.x = Math.PI / 2;
  wallClamp.position.set(0.09, 0.5, 0);
  root.add(wallClamp);

  const waterGroup = new THREE.Group();
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.055, 0.54, 14), waterMaterial);
  stream.position.set(-0.52, 0.67, 0);
  waterGroup.add(stream);
  const ripples = [0.14, 0.25].map((radius, index) => {
    const ripple = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.009, 8, 28), rippleMaterial.clone());
    ripple.rotation.x = Math.PI / 2;
    ripple.position.set(-0.52, 0.425 + index * 0.004, 0);
    ripple.userData.phase = index * 0.45;
    waterGroup.add(ripple);
    return ripple;
  });
  const droplets = Array.from({ length: 8 }, (_, index) => {
    const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.026 + (index % 3) * 0.006, 10, 8), waterMaterial);
    droplet.userData.phase = index / 8;
    droplet.userData.speed = 0.72 + (index % 4) * 0.09;
    waterGroup.add(droplet);
    return droplet;
  });
  root.add(waterGroup);

  const splashLight = new THREE.PointLight(0x76d9df, 0, 1.8, 2.2);
  splashLight.position.set(-0.52, 0.52, 0);
  root.add(splashLight);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.27, 24),
    new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -1.02;
  halo.visible = false;
  root.add(halo);
  const visualGroup = new THREE.Group();
  visualGroup.position.set(0.5, -0.2, 0);
  for (const child of [...root.children]) {
    if (child !== halo) {
      root.remove(child);
      visualGroup.add(child);
    }
  }
  root.add(visualGroup);
  scene.add(root);

  const washbasin = {
    id: "washbasin",
    label: "打开水龙头",
    root,
    mesh: bowl,
    halo,
    enabled: true,
    running: false,
    waterSurface: basinWater,
    setRunning: null,
    toggle: null,
    update(delta, elapsed) {
      if (!washbasin.running) return;
      stream.scale.y = 0.94 + Math.sin(elapsed * 16) * 0.04;
      stream.position.x = -0.52 + Math.sin(elapsed * 12) * 0.008;
      for (const droplet of droplets) {
        const progress = (droplet.userData.phase + elapsed * droplet.userData.speed) % 1;
        droplet.position.set(
          -0.52 + Math.sin(elapsed * 8 + droplet.userData.phase * 12) * 0.018,
          0.91 - progress * 0.48,
          Math.cos(elapsed * 9 + droplet.userData.phase * 10) * 0.018,
        );
      }
      for (const ripple of ripples) {
        const pulse = 0.94 + (Math.sin(elapsed * 5.4 + ripple.userData.phase) + 1) * 0.12;
        ripple.scale.setScalar(pulse);
        ripple.material.opacity = 0.46 + pulse * 0.14;
      }
      splashLight.intensity = 0.18 + Math.sin(elapsed * 7) * 0.035;
    },
  };
  const updateVisual = (running) => {
    washbasin.running = running;
    washbasin.label = running ? "关闭水龙头" : "打开水龙头";
    waterGroup.visible = running;
    basinWater.visible = running;
    splashLight.intensity = running ? 0.18 : 0;
  };
  const state = createWashbasinState({ onChange: ({ running }) => updateVisual(running) });
  washbasin.setRunning = (running) => state.setRunning(running);
  washbasin.toggle = () => state.toggle();
  updateVisual(false);
  return washbasin;
}

function makeShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.filter = "blur(10px)";
  context.fillStyle = "rgba(0, 0, 0, 0.94)";
  context.beginPath();
  context.arc(128, 82, 40, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.roundRect(76, 118, 104, 282, 44);
  context.fill();
  context.fillRect(55, 160, 44, 232);
  context.fillRect(158, 160, 44, 232);
  context.fillRect(78, 360, 42, 145);
  context.fillRect(138, 360, 42, 145);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFlashlightCookie() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 16, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,0.96)");
  gradient.addColorStop(0.34, "rgba(255,248,224,0.82)");
  gradient.addColorStop(0.72, "rgba(255,228,177,0.27)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.08;
  context.strokeStyle = "#fff4d5";
  for (let index = 0; index < 18; index += 1) {
    context.beginPath();
    context.moveTo(44 + index * 10, 42);
    context.lineTo(70 + index * 7, 214);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const FLASHLIGHT_FOLLOW_SECONDS = 0.045;

export function updateFlashlightRig(rig, camera, delta) {
  camera.getWorldPosition(rig.group.position);
  camera.getWorldQuaternion(rig.targetQuaternion);
  const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : Infinity;
  const blend = elapsed === Infinity ? 1 : 1 - Math.exp(-elapsed / rig.followSeconds);
  rig.group.quaternion.slerp(rig.targetQuaternion, blend);
}

export function createFlashlightRig(camera, target, { cookieFactory = makeFlashlightCookie } = {}) {
  const group = new THREE.Group();
  group.name = "flashlight";

  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.position.copy(target);
  const core = new THREE.SpotLight(0xfff0c9, 42, 52, Math.PI / 7.2, 0.7, 1.55);
  core.position.set(0, -0.05, 0);
  core.target = flashlightTarget;
  core.castShadow = true;
  core.shadow.mapSize.set(512, 512);
  core.shadow.bias = -0.00018;
  core.shadow.normalBias = 0.024;
  core.map = cookieFactory();
  const spill = new THREE.SpotLight(0xffd6a0, 8.4, 30, Math.PI / 2.8, 0.96, 1.45);
  spill.position.set(0, -0.04, 0);
  spill.target = flashlightTarget;

  const outerBeam = new THREE.Mesh(
    new THREE.ConeGeometry(2.55, 15.4, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd7a1,
      transparent: true,
      opacity: 0.026,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    }),
  );
  outerBeam.rotation.x = -Math.PI / 2;
  outerBeam.position.set(0, -0.05, -8.05);
  const innerBeam = new THREE.Mesh(
    new THREE.ConeGeometry(1.08, 11.8, 40, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffedc4,
      transparent: true,
      opacity: 0.024,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    }),
  );
  innerBeam.rotation.x = -Math.PI / 2;
  innerBeam.position.set(0, -0.05, -6.05);
  group.add(core, spill, outerBeam, innerBeam, flashlightTarget);
  const rig = {
    group,
    core,
    spill,
    outerBeam,
    innerBeam,
    target: flashlightTarget,
    followSeconds: FLASHLIGHT_FOLLOW_SECONDS,
    targetQuaternion: new THREE.Quaternion(),
  };
  updateFlashlightRig(rig, camera, Infinity);
  return rig;
}

function createObservationWindow(scene, { trimMaterial, metalMaterial, wallMaterial, layout = null }) {
  const anchor = layout?.anchors?.shadowWindow ?? {
    position: [-2.5, 1.9, -14.4],
    taskPoint: [-2.38, 1.95, -13.92],
    figure: [-6.62, 1.22, -16.4],
  };
  const root = new THREE.Group();
  root.position.set(...anchor.position);
  root.userData.interactableId = "shadow-window";

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 1.52, 2.24),
    new THREE.MeshPhysicalMaterial({
      color: 0x526864,
      transparent: true,
      opacity: 0.2,
      roughness: 0.26,
      metalness: 0.08,
      transmission: 0.16,
      depthWrite: false,
    }),
  );
  glass.position.x = -0.02;
  root.add(glass);

  for (const z of [-1.18, 1.18]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.78, 0.12), trimMaterial);
    upright.position.set(0.02, 0, z);
    root.add(upright);
  }
  for (const y of [-0.83, 0.83]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 2.48), trimMaterial);
    rail.position.set(0.02, y, 0);
    root.add(rail);
  }
  const centerRail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.58, 0.07), metalMaterial);
  centerRail.position.set(0.05, 0, 0);
  root.add(centerRail);

  const taskPoint = new THREE.Group();
  taskPoint.position.set(
    anchor.taskPoint[0] - anchor.position[0],
    anchor.taskPoint[1] - anchor.position[1],
    anchor.taskPoint[2] - anchor.position[2],
  );
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: 0xe7dfb7,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.17, 32), reticleMaterial);
  ring.rotation.y = Math.PI / 2;
  taskPoint.add(ring);
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.46), reticleMaterial);
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.46, 0.018), reticleMaterial);
  taskPoint.add(horizontal, vertical);
  taskPoint.visible = false;
  root.add(taskPoint);
  scene.add(root);

  const oppositeCorridor = new THREE.Group();
  const oppositeWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.35, 6.2), wallMaterial);
  oppositeWall.position.set(-6.9, 1.58, -14.4);
  const oppositeFloor = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.16, 6.2),
    new THREE.MeshStandardMaterial({ color: 0x1b201e, roughness: 0.94 }),
  );
  oppositeFloor.position.set(-5.94, -0.02, -14.4);
  const oppositeCeiling = oppositeFloor.clone();
  oppositeCeiling.position.y = 3.23;
  const farLeft = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.35, 0.18), wallMaterial);
  farLeft.position.set(-5.94, 1.58, -17.42);
  const farRight = farLeft.clone();
  farRight.position.z = -11.38;
  oppositeCorridor.add(oppositeWall, oppositeFloor, oppositeCeiling, farLeft, farRight);

  const operatingRoom = new THREE.Group();
  operatingRoom.position.set(-6.78, 1.18, -12.62);
  const operatingFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 1.5), metalMaterial);
  const operatingDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 2.35, 1.24),
    new THREE.MeshStandardMaterial({ color: 0x66736d, roughness: 0.47, metalness: 0.48 }),
  );
  operatingDoor.position.x = 0.08;
  const doorWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.74, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x9cae9f, emissive: 0x536d5f, emissiveIntensity: 0.5, roughness: 0.18 }),
  );
  doorWindow.position.set(0.05, 0.38, 0);
  operatingDoor.add(doorWindow);
  operatingRoom.add(operatingFrame, operatingDoor);
  oppositeCorridor.add(operatingRoom);

  const shadowFigure = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeShadowTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  }));
  shadowFigure.position.set(...anchor.figure);
  shadowFigure.scale.set(0.95, 2.42, 1);
  shadowFigure.visible = false;
  oppositeCorridor.add(shadowFigure);

  const oppositeLight = new THREE.RectAreaLight(0xa7b2a2, 2.2, 1.4, 0.35);
  oppositeLight.position.set(-6.15, 2.9, -14.5);
  oppositeLight.rotation.set(0, Math.PI / 2, 0);
  oppositeCorridor.add(oppositeLight);
  scene.add(oppositeCorridor);

  const window = {
    id: "shadow-window",
    label: "观察窗",
    root,
    mesh: glass,
    halo: null,
    enabled: false,
    anchor,
  };
  return { window, taskPoint, oppositeCorridor, operatingRoom, operatingDoor, shadowFigure, anchors: anchor };
}

export function disposePhysicsWorld(world) {
  world?.free?.();
}

export async function createScene(host) {
  await RAPIER.init();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090a);
  scene.fog = new THREE.FogExp2(0x080b0b, 0.026);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 70);
  camera.position.set(0, 1.58, 1.2);
  camera.rotation.order = "YXZ";

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.replaceChildren(renderer.domElement);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const wallTexture = makeTexture("#454a45", "rgba(220, 222, 203, ALPHA)", 12);
  wallTexture.repeat.set(2.2, 7);
  const floorTexture = makeTexture("#252a27", "rgba(193, 187, 155, ALPHA)", 32);
  floorTexture.repeat.set(12, 55);
  const ceilingTexture = makeTexture("#2d332f", "rgba(219, 223, 206, ALPHA)", 4);
  ceilingTexture.repeat.set(12, 55);
  const doorTexture = makeTexture("#242322", "rgba(181, 155, 103, ALPHA)", 27);
  doorTexture.repeat.set(1, 2);
  const trimTexture = makeTexture("#111413", "rgba(210, 195, 161, ALPHA)", 44);
  const wallMaterial = material(wallTexture);
  const floorMaterial = material(floorTexture, 0.98);
  const ceilingMaterial = material(ceilingTexture);
  const doorMaterial = material(doorTexture, 0.78);
  const trimMaterial = material(trimTexture, 0.7);
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x555853, roughness: 0.5, metalness: 0.7 });
  const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x242827, roughness: 0.38, metalness: 0.85 });
  const paperMaterial = new THREE.MeshStandardMaterial({ map: makeLabelTexture("FUSE 12A"), roughness: 0.9 });

  const corridor = createCorridorLayout();
  for (const floor of corridor.floors) addLayoutMesh(scene, floor, floorMaterial);
  for (const ceiling of corridor.ceilings) addLayoutMesh(scene, ceiling, ceilingMaterial);
  for (const wall of corridor.walls) {
    if (wall.render !== false) addLayoutMesh(scene, wall, wallMaterial);
  }
  for (const collider of corridor.colliders) addLayoutCollider(world, collider);

  const innerWallX = [corridor.main.bounds.minX + 0.18, corridor.main.bounds.maxX - 0.18];
  for (const z of [-1.4, -6.6, -11.8, -17.1, -22.4]) {
    addDoor(scene, innerWallX[0], z, 1, doorMaterial, trimMaterial);
    addDoor(scene, innerWallX[1], z - 2.2, -1, doorMaterial, trimMaterial);
  }

  const wallSeamMaterial = new THREE.MeshStandardMaterial({ color: 0x272c29, roughness: 0.58, metalness: 0.32 });
  for (const side of [-1, 1]) {
    for (const z of [-3.95, -9.15, -14.4, -19.65, -24.85]) {
      box(scene, new THREE.BoxGeometry(0.035, 2.88, 0.028), wallSeamMaterial, [side * (corridor.width / 2 - 0.18), 1.7, z]);
    }
    box(scene, new THREE.BoxGeometry(0.045, 0.12, 34.8), wallSeamMaterial, [side * (corridor.width / 2 - 0.18), 0.16, -14.8]);
    box(scene, new THREE.BoxGeometry(0.045, 0.08, 34.8), wallSeamMaterial, [side * (corridor.width / 2 - 0.18), 3.2, -14.8]);
  }
  box(scene, new THREE.BoxGeometry(19.4, 0.12, 0.045), wallSeamMaterial, [13.2, 0.16, -29.6]);
  box(scene, new THREE.BoxGeometry(19.4, 0.08, 0.045), wallSeamMaterial, [13.2, 3.2, -29.6]);

  const windowGlass = new THREE.MeshStandardMaterial({ color: 0x172827, emissive: 0x0c2525, emissiveIntensity: 0.7, roughness: 0.28, metalness: 0.18 });
  for (const z of [-4.2, -24.6]) {
    box(scene, new THREE.BoxGeometry(0.07, 1.25, 1.75), windowGlass, [corridor.main.bounds.minX + 0.2, 1.9, z]);
    for (const offset of [-0.78, 0.78]) box(scene, new THREE.BoxGeometry(0.09, 1.35, 0.06), trimMaterial, [corridor.main.bounds.minX + 0.27, 1.9, z + offset]);
  }

  const shadowQuest = createObservationWindow(scene, { trimMaterial, metalMaterial, wallMaterial, layout: corridor });
  const washbasin = createWashbasin(scene, corridor.anchors.washbasin.position, darkMetalMaterial);

  for (const side of [-1, 1]) {
    box(scene, new THREE.BoxGeometry(0.08, 0.09, 34.6), darkMetalMaterial, [side * (corridor.width / 2 - 0.19), 0.92, -14.8]);
    const conduit = box(
      scene,
      new THREE.CylinderGeometry(0.026, 0.026, 34.5, 10),
      darkMetalMaterial,
      [side * (corridor.width / 2 - 0.22), 3.02, -14.8],
      [Math.PI / 2, 0, 0],
    );
    conduit.castShadow = false;
  }
  for (const x of [7.4, 13.2, 19]) {
    box(scene, new THREE.BoxGeometry(0.09, 0.08, 5.3), darkMetalMaterial, [x, 0.92, -29.6]);
  }

  const ceilingLights = [];
  const ceilingFixtureMaterial = new THREE.MeshStandardMaterial({ color: 0x9b9f91, emissive: 0x7e8a73, emissiveIntensity: 1.1, roughness: 0.42 });
  for (const definition of corridor.lights.filter((entry) => entry.kind === "ceiling")) {
    box(scene, new THREE.BoxGeometry(0.7, 0.08, 1.6), ceilingFixtureMaterial, definition.fixturePosition ?? definition.position);
    const light = new THREE.PointLight(definition.color, definition.intensity, definition.distance, definition.decay);
    light.name = definition.id;
    light.position.set(...definition.position);
    scene.add(light);
    ceilingLights.push(light);
  }

  const emergencyLights = [];
  for (const definition of corridor.lights.filter((entry) => entry.kind === "emergency")) {
    const light = new THREE.PointLight(definition.color, definition.intensity, definition.distance, definition.decay);
    light.name = definition.id;
    light.position.set(...definition.position);
    scene.add(light);
    emergencyLights.push(light);
  }

  const stormLight = new THREE.DirectionalLight(0x9bbcc2, 0);
  stormLight.position.set(-5, 4, -10);
  scene.add(stormLight);
  const hemi = new THREE.HemisphereLight(0x687a70, 0x151816, 0.72);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x242a26, 0.16));

  const flashlightRig = createFlashlightRig(camera, new THREE.Vector3(0, -0.05, -9));
  const flashlightGroup = flashlightRig.group;
  const flashlight = flashlightRig.core;
  const flashlightSpill = flashlightRig.spill;
  const beam = flashlightRig.outerBeam;
  scene.add(camera);
  scene.add(flashlightGroup);

  const fuse = addInteractable(scene, "fuse", "拾取备用保险丝", [-1.78, 1.25, -8.6], new THREE.BoxGeometry(0.16, 0.42, 0.16), new THREE.MeshStandardMaterial({ color: 0xe7d5a3, emissive: 0xa9813d, emissiveIntensity: 0.55, roughness: 0.44 }));
  fuse.root.rotation.z = -0.22;
  fuse.root.position.fromArray(corridor.anchors.fuse.position);
  box(scene, new THREE.BoxGeometry(0.52, 0.32, 0.14), paperMaterial, [corridor.anchors.fuse.position[0] - 0.07, 1.07, corridor.anchors.fuse.position[2]], [0, 0.2, 0]);

  const panelRoot = new THREE.Group();
  panelRoot.position.fromArray(corridor.anchors.panel.position);
  panelRoot.rotation.y = corridor.anchors.panel.rotationY;
  panelRoot.userData.interactableId = "panel";
  const panelBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 0.78), darkMetalMaterial);
  panelBody.castShadow = true;
  panelRoot.add(panelBody);
  const panelFace = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.82, 0.56), metalMaterial);
  panelFace.position.x = -0.1;
  panelRoot.add(panelFace);
  const panelLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: 0x9f3329, emissive: 0x8d2a20, emissiveIntensity: 2 }));
  panelLamp.position.set(-0.13, 0.26, -0.18);
  panelRoot.add(panelLamp);
  scene.add(panelRoot);
  const panel = { id: "panel", label: "安装保险丝", root: panelRoot, mesh: panelBody, halo: null, enabled: true, lamp: panelLamp };

  const exitDoor = createExitDoor({
    scene,
    camera,
    world,
    RAPIER,
    position: corridor.door.position,
    rotationY: corridor.door.rotationY,
    inwardNormal: corridor.door.inwardNormal,
    triggerPosition: corridor.door.triggerPosition,
    colliderPosition: corridor.door.collider.position,
    colliderHalfExtents: corridor.door.collider.halfExtents,
    materials: { door: doorMaterial, hardware: metalMaterial },
  });
  const foundPhone = createFoundPhoneProp({ scene, camera, position: corridor.anchors.foundPhone.position });

  const silhouette = new THREE.Group();
  silhouette.position.set(0.3, 0, -2.8);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x020303 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.05, 4, 8), shadowMaterial);
  torso.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), shadowMaterial);
  head.position.y = 2.03;
  const armGeometry = new THREE.CapsuleGeometry(0.07, 0.75, 3, 6);
  const leftArm = new THREE.Mesh(armGeometry, shadowMaterial);
  const rightArm = new THREE.Mesh(armGeometry, shadowMaterial);
  leftArm.position.set(-0.36, 1.2, 0);
  rightArm.position.set(0.36, 1.2, 0);
  leftArm.rotation.z = -0.1;
  rightArm.rotation.z = 0.1;
  silhouette.add(torso, head, leftArm, rightArm);
  silhouette.visible = false;
  scene.add(silhouette);

  const interactables = [fuse, panel, foundPhone, washbasin, shadowQuest.window];
  for (const entry of interactables) {
    entry.interaction ??= {
      anchor: entry.interactionAnchor ?? entry.root,
      contactRadius: 0.22,
      maxUseDistance: 2.35,
      approachDirection: null,
    };
  }
  const staticOccluderRoots = scene.children.filter((root) => (
    root !== camera
    && root !== flashlightGroup
    && root !== silhouette
    && root !== exitDoor.root
    && !interactables.some((entry) => entry.root === root)
  ));
  const corridorWorldAnchors = {
    door: exitDoor.root,
    triggerPosition: exitDoor.triggerPosition,
    foundPhone: foundPhone.root,
    washbasin: washbasin.root,
    fuse: fuse.root,
    panel: panel.root,
    shadowWindow: shadowQuest.window.root,
    shadowTaskPoint: shadowQuest.taskPoint,
  };
  let disposed = false;
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  };
  window.addEventListener("resize", resize);

  return {
    RAPIER,
    scene,
    camera,
    renderer,
    world,
    interactables,
    staticOccluderRoots,
    objects: {
      flashlight: flashlightGroup,
      flashlightCore: flashlight,
      flashlightSpill,
      flashlightBeam: beam,
      ceilingLights,
      emergencyLights,
      stormLight,
      hemi,
      silhouette,
      exitDoor,
      foundPhone,
      panel,
      fuse,
      washbasin,
      shadowQuest,
      corridor: {
        layout: corridor,
        anchors: corridor.anchors,
        worldAnchors: corridorWorldAnchors,
        anchorObjects: corridorWorldAnchors,
      },
    },
    update(delta, elapsed) {
      const pulse = 0.56 + Math.sin(elapsed * 7.4) * 0.045;
      for (const light of emergencyLights) light.intensity = pulse;
      updateFlashlightRig(flashlightRig, camera, delta);
      washbasin.update(delta, elapsed);
      foundPhone.update(delta);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", resize);
      try {
        renderer.dispose();
        scene.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((entry) => {
              entry.map?.dispose();
              entry.dispose();
            });
          }
        });
      } finally {
        disposePhysicsWorld(world);
      }
    },
  };
}
