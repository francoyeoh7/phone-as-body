import * as THREE from "three";

function addMesh(parent, geometry, material, name, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCracks(root) {
  const crackSurface = new THREE.LineBasicMaterial({ color: 0xb9d7c8, transparent: true, opacity: 0.72 });
  const paths = [
    [[0.08, 0.28], [0.02, 0.16], [0.08, 0.04], [-0.02, -0.1]],
    [[0.02, 0.16], [-0.11, 0.1], [-0.15, -0.02]],
    [[0.08, 0.04], [0.15, -0.05], [0.1, -0.18]],
    [[-0.02, -0.1], [-0.12, -0.18], [-0.08, -0.28]],
    [[-0.02, -0.1], [0.05, -0.2], [0.13, -0.25]],
  ];
  for (const path of paths) {
    const geometry = new THREE.BufferGeometry().setFromPoints(path.map(([x, y]) => new THREE.Vector3(x, y, 0.043)));
    const crack = new THREE.Line(geometry, crackSurface);
    crack.name = "screen-crack";
    root.add(crack);
  }
}

function createPhoneModel({ bodySurface, screenSurface, hardwareSurface }) {
  const model = new THREE.Group();
  model.name = "phone-model";

  const body = addMesh(model, new THREE.BoxGeometry(0.38, 0.72, 0.055, 2, 2, 1), bodySurface, "phone-body", [0, 0, 0]);
  addMesh(model, new THREE.BoxGeometry(0.33, 0.62, 0.012), screenSurface, "phone-screen", [0, 0, 0.034]);
  addMesh(model, new THREE.BoxGeometry(0.13, 0.17, 0.035), bodySurface, "phone-camera-bump", [-0.1, 0.23, -0.045]);
  for (const [x, y] of [[-0.13, 0.27], [-0.07, 0.27]]) {
    const lens = addMesh(model, new THREE.CylinderGeometry(0.025, 0.025, 0.02, 14), hardwareSurface, "phone-camera-lens", [x, y, -0.073]);
    lens.rotation.x = Math.PI / 2;
  }
  for (const [y, height] of [[0.17, 0.12], [-0.03, 0.09]]) {
    addMesh(model, new THREE.BoxGeometry(0.018, height, 0.025), hardwareSurface, "phone-side-button", [0.198, y, 0]);
  }
  addMesh(model, new THREE.BoxGeometry(0.018, 0.15, 0.025), hardwareSurface, "phone-side-button", [-0.198, 0.1, 0]);
  addCracks(model);
  return { model, body };
}

export function createFoundPhoneProp({ scene, camera, position = [-1.2, 0.07, -11.4] }) {
  const bodySurface = new THREE.MeshStandardMaterial({ color: 0x111614, roughness: 0.34, metalness: 0.62 });
  const screenSurface = new THREE.MeshStandardMaterial({
    color: 0x304b43,
    emissive: 0x4d8b72,
    emissiveIntensity: 1.4,
    roughness: 0.22,
  });
  const hardwareSurface = new THREE.MeshStandardMaterial({ color: 0x242b28, roughness: 0.2, metalness: 0.84 });

  const root = new THREE.Group();
  root.name = "found-phone-floor";
  root.position.set(...position);
  root.rotation.set(-Math.PI / 2, 0, -0.34);
  root.userData.interactableId = "found-phone";
  const { model, body } = createPhoneModel({ bodySurface, screenSurface, hardwareSurface });
  root.add(model);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.28, 28),
    new THREE.MeshBasicMaterial({ color: 0xd3b15e, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  );
  halo.name = "found-phone-halo";
  halo.position.z = 0.055;
  halo.visible = false;
  root.add(halo);
  scene.add(root);

  const heldRig = root.clone(true);
  heldRig.name = "found-phone-held";
  heldRig.userData.interactableId = null;
  heldRig.position.set(0.36, -0.28, -0.78);
  heldRig.rotation.set(-0.18, -0.34, 0.08);
  heldRig.scale.setScalar(1.45);
  heldRig.visible = false;
  camera.add(heldRig);

  const floorPosition = root.position.clone();
  const floorRotation = root.rotation.clone();
  let held = false;
  let dropping = false;
  let dropElapsed = 0;
  const dropSeconds = 0.36;

  return {
    id: "found-phone",
    label: "拿起手机",
    root,
    mesh: body,
    halo,
    heldRig,
    enabled: true,
    setHeld(active) {
      const nextHeld = Boolean(active);
      if (nextHeld) {
        held = true;
        dropping = false;
        dropElapsed = 0;
        root.visible = false;
        heldRig.visible = true;
        return;
      }
      heldRig.visible = false;
      root.visible = true;
      if (held) {
        dropping = true;
        dropElapsed = 0;
        root.position.copy(floorPosition).add(new THREE.Vector3(0, 0.34, 0));
        root.rotation.copy(floorRotation);
        root.rotation.z += 0.24;
      }
      held = false;
    },
    update(delta = 0) {
      if (!dropping || held || dropElapsed >= dropSeconds) return;
      dropElapsed = Math.min(dropSeconds, dropElapsed + Math.max(0, delta));
      const progress = dropElapsed / dropSeconds;
      root.position.lerpVectors(
        floorPosition.clone().add(new THREE.Vector3(0, 0.34, 0)),
        floorPosition,
        progress * progress,
      );
      root.rotation.copy(floorRotation);
      root.rotation.z += 0.24 * (1 - progress);
      if (dropElapsed >= dropSeconds) dropping = false;
    },
  };
}
