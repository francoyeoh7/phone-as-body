import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function makeTexture(base, accent, seed = 7) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < 340; index += 1) {
    const alpha = 0.035 + random() * 0.12;
    context.fillStyle = accent.replace("ALPHA", alpha.toFixed(3));
    const x = random() * 256;
    const y = random() * 256;
    const size = 1 + random() * 12;
    context.fillRect(x, y, size, size * (0.4 + random() * 1.4));
  }
  for (let index = 0; index < 14; index += 1) {
    context.strokeStyle = accent.replace("ALPHA", "0.13");
    context.lineWidth = 1 + random() * 2;
    context.beginPath();
    context.moveTo(random() * 256, random() * 256);
    context.lineTo(random() * 256, random() * 256);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function material(texture, roughness = 0.88, color = 0xffffff) {
  return new THREE.MeshStandardMaterial({ map: texture, color, roughness, metalness: 0.04 });
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
  const wallTexture = makeTexture("#363b37", "rgba(220, 222, 203, ALPHA)", 12);
  wallTexture.repeat.set(2.2, 7);
  const floorTexture = makeTexture("#1c211f", "rgba(193, 187, 155, ALPHA)", 32);
  floorTexture.repeat.set(12, 55);
  const ceilingTexture = makeTexture("#242a27", "rgba(219, 223, 206, ALPHA)", 4);
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

  box(scene, new THREE.BoxGeometry(5.2, 0.3, 32), floorMaterial, [0, -0.15, -13]);
  box(scene, new THREE.BoxGeometry(5.2, 0.3, 32), ceilingMaterial, [0, 3.55, -13]);
  box(scene, new THREE.BoxGeometry(0.3, 3.6, 32), wallMaterial, [-2.65, 1.7, -13]);
  box(scene, new THREE.BoxGeometry(0.3, 3.6, 32), wallMaterial, [2.65, 1.7, -13]);
  box(scene, new THREE.BoxGeometry(5.2, 3.6, 0.3), wallMaterial, [0, 1.7, 3.1]);
  box(scene, new THREE.BoxGeometry(5.2, 3.6, 0.3), wallMaterial, [0, 1.7, -29.1]);
  addFixedCollider(world, 0, -0.15, -13, 2.6, 0.15, 16.2);
  addFixedCollider(world, 0, 3.55, -13, 2.6, 0.15, 16.2);
  addFixedCollider(world, -2.65, 1.7, -13, 0.15, 1.8, 16.2);
  addFixedCollider(world, 2.65, 1.7, -13, 0.15, 1.8, 16.2);
  addFixedCollider(world, 0, 1.7, 3.1, 2.6, 1.8, 0.15);
  addFixedCollider(world, 0, 1.7, -29.1, 2.6, 1.8, 0.15);

  for (const z of [-1.4, -6.6, -11.8, -17.1, -22.4, -27.3]) {
    addDoor(scene, -2.47, z, 1, doorMaterial, trimMaterial);
    addDoor(scene, 2.47, z - 2.2, -1, doorMaterial, trimMaterial);
  }

  const windowGlass = new THREE.MeshStandardMaterial({ color: 0x172827, emissive: 0x0c2525, emissiveIntensity: 0.7, roughness: 0.28, metalness: 0.18 });
  for (const z of [-4.2, -14.4, -24.6]) {
    box(scene, new THREE.BoxGeometry(0.07, 1.25, 1.75), windowGlass, [-2.45, 1.9, z]);
    for (const offset of [-0.78, 0.78]) box(scene, new THREE.BoxGeometry(0.09, 1.35, 0.06), trimMaterial, [-2.38, 1.9, z + offset]);
  }

  const ceilingLights = [];
  for (const z of [-1, -6, -11, -16, -21, -26]) {
    box(
      scene,
      new THREE.BoxGeometry(0.7, 0.08, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x9b9f91, emissive: 0x7e8a73, emissiveIntensity: 1.1, roughness: 0.42 }),
      [0, 3.37, z],
    );
    const light = new THREE.PointLight(0x9aa990, 0.68, 7, 2.1);
    light.position.set(0, 3.05, z);
    scene.add(light);
    ceilingLights.push(light);
  }

  const emergencyLights = [];
  for (const z of [-3.2, -13.2, -23.2]) {
    const light = new THREE.PointLight(0xb24c36, 0.78, 9, 2);
    light.position.set(0, 2.6, z);
    scene.add(light);
    emergencyLights.push(light);
  }

  const stormLight = new THREE.DirectionalLight(0x9bbcc2, 0);
  stormLight.position.set(-5, 4, -10);
  scene.add(stormLight);
  const hemi = new THREE.HemisphereLight(0x687a70, 0x101313, 0.46);
  scene.add(hemi);

  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.position.set(0, -0.08, -9);
  camera.add(flashlightTarget);
  const flashlightGroup = new THREE.Group();
  flashlightGroup.name = "flashlight";
  const flashlight = new THREE.SpotLight(0xfff1cf, 7.2, 26, 0.46, 0.52, 1.18);
  flashlight.position.set(0.06, -0.03, 0.02);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(512, 512);
  flashlight.target = flashlightTarget;
  const flashlightSpill = new THREE.SpotLight(0xffdca2, 1.8, 13, 0.92, 0.9, 1.05);
  flashlightSpill.position.set(0.02, -0.02, 0.02);
  flashlightSpill.target = flashlightTarget;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, 8, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffe7b4,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0.02, -0.03, -4);
  flashlightGroup.add(flashlight, flashlightSpill, beam);
  camera.add(flashlightGroup);
  scene.add(camera);

  const dustPositions = new Float32Array(220 * 3);
  const random = seededRandom(108);
  for (let index = 0; index < 220; index += 1) {
    dustPositions[index * 3] = (random() - 0.5) * 4.4;
    dustPositions[index * 3 + 1] = 0.2 + random() * 2.9;
    dustPositions[index * 3 + 2] = 2.4 - random() * 30;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xb0b6a8, size: 0.012, transparent: true, opacity: 0.25 }));
  scene.add(dust);

  const fuse = addInteractable(scene, "fuse", "拾取备用保险丝", [-1.78, 1.25, -8.6], new THREE.BoxGeometry(0.16, 0.42, 0.16), new THREE.MeshStandardMaterial({ color: 0xe7d5a3, emissive: 0xa9813d, emissiveIntensity: 0.55, roughness: 0.44 }));
  fuse.root.rotation.z = -0.22;
  box(scene, new THREE.BoxGeometry(0.52, 0.32, 0.14), paperMaterial, [-1.85, 1.07, -8.6], [0, 0.2, 0]);

  const panelRoot = new THREE.Group();
  panelRoot.position.set(2.35, 1.36, -15.6);
  panelRoot.rotation.y = Math.PI / 2;
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

  const elevatorDoors = new THREE.Group();
  elevatorDoors.position.set(0, 1.25, -27.65);
  const doorLeft = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.5, 0.12), darkMetalMaterial);
  doorLeft.position.x = -0.58;
  const doorRight = doorLeft.clone();
  doorRight.position.x = 0.58;
  elevatorDoors.add(doorLeft, doorRight);
  scene.add(elevatorDoors);
  const elevatorCollider = addFixedCollider(world, 0, 1.25, -27.55, 1.25, 1.25, 0.12);
  const elevator = addInteractable(scene, "elevator", "进入电梯", [0, 1.05, -26.7], new THREE.BoxGeometry(2.1, 2.3, 0.2), new THREE.MeshStandardMaterial({ color: 0x202522, roughness: 0.44, metalness: 0.8, transparent: true, opacity: 0.16 }));
  elevator.root.visible = false;

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

  const interactables = [fuse, panel, elevator];
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
    objects: { flashlight: flashlightGroup, flashlightCore: flashlight, flashlightSpill, flashlightBeam: beam, ceilingLights, emergencyLights, stormLight, hemi, dust, silhouette, elevatorDoors, elevatorCollider, elevator, panel, fuse },
    update(delta, elapsed) {
      dust.rotation.y += delta * 0.006;
      const pulse = 0.56 + Math.sin(elapsed * 7.4) * 0.045;
      for (const light of emergencyLights) light.intensity = pulse;
    },
    dispose() {
      window.removeEventListener("resize", resize);
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
    },
  };
}
