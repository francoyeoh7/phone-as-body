import * as THREE from "three";

const DEFAULT_POSITION = Object.freeze([0, 0, -28.88]);
const DEFAULT_ROTATION_Y = 0;
const TRIGGER_LOCAL_OFFSET = Object.freeze([0, 1.05, 2.18]);
const COLLIDER_LOCAL_OFFSET = Object.freeze([0, 1.44, 0.18]);

function asVector3(value, fallback) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) return new THREE.Vector3(value[0], value[1], value[2]);
  return new THREE.Vector3(...fallback);
}

function cleanVector(vector) {
  for (const axis of ["x", "y", "z"]) {
    const value = Math.abs(vector[axis]) < 1e-12 ? 0 : Number(vector[axis].toFixed(12));
    vector[axis] = value;
  }
  return vector;
}

function addShadowed(parent, geometry, material, name, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createExitDoor({
  scene,
  camera,
  world,
  RAPIER,
  materials = {},
  position = DEFAULT_POSITION,
  rotationY = DEFAULT_ROTATION_Y,
  triggerPosition = null,
  inwardNormal = null,
  colliderPosition = null,
  colliderHalfExtents = [1.2, 1.44, 0.14],
} = {}) {
  const doorSurface = materials.door ?? new THREE.MeshStandardMaterial({
    color: 0x303632,
    roughness: 0.5,
    metalness: 0.68,
  });
  const hardwareSurface = materials.hardware ?? new THREE.MeshStandardMaterial({
    color: 0x777d76,
    roughness: 0.24,
    metalness: 0.92,
  });
  const darkHardwareSurface = new THREE.MeshStandardMaterial({ color: 0x171b19, roughness: 0.42, metalness: 0.76 });
  const gapSurface = new THREE.MeshBasicMaterial({ color: 0x010202 });
  const sleeveSurface = new THREE.MeshStandardMaterial({ color: 0x1c2422, roughness: 0.86 });
  const skinSurface = new THREE.MeshStandardMaterial({ color: 0xa87861, roughness: 0.72 });

  const root = new THREE.Group();
  root.name = "exit-door";
  const rootPosition = asVector3(position, DEFAULT_POSITION);
  root.position.copy(rootPosition);
  root.rotation.y = Number.isFinite(rotationY) ? rotationY : DEFAULT_ROTATION_Y;

  const gapShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.42, 2.96), gapSurface);
  gapShadow.name = "door-gap-shadow";
  gapShadow.position.set(0, 1.48, 0.025);
  root.add(gapShadow);

  const frame = new THREE.Group();
  frame.name = "reinforced-door-frame";
  for (const side of [-1, 1]) {
    addShadowed(frame, new THREE.BoxGeometry(0.24, 3.2, 0.24), hardwareSurface, "frame-upright", [side * 1.29, 1.58, 0.12]);
    addShadowed(frame, new THREE.BoxGeometry(0.07, 2.94, 0.08), darkHardwareSurface, "frame-reveal", [side * 1.17, 1.48, 0.235]);
  }
  addShadowed(frame, new THREE.BoxGeometry(2.82, 0.22, 0.24), hardwareSurface, "frame-header", [0, 3.09, 0.12]);
  addShadowed(frame, new THREE.BoxGeometry(2.5, 0.08, 0.2), darkHardwareSurface, "door-threshold", [0, 0.04, 0.1]);
  root.add(frame);

  const leafPivot = new THREE.Group();
  leafPivot.name = "exit-door-leaf-pivot";
  leafPivot.position.set(0, 1.48, 0.14);
  const leaf = addShadowed(leafPivot, new THREE.BoxGeometry(2.34, 2.88, 0.18), doorSurface, "exit-door-leaf", [0, 0, 0]);
  addShadowed(leaf, new THREE.BoxGeometry(2.12, 2.64, 0.025), doorSurface, "reinforced-leaf-face", [0, 0, 0.102]);
  addShadowed(leaf, new THREE.BoxGeometry(0.07, 2.5, 0.035), hardwareSurface, "leaf-spine", [-0.88, 0, 0.125]);

  const slotBacking = addShadowed(leafPivot, new THREE.BoxGeometry(0.62, 0.2, 0.035), darkHardwareSurface, "observation-slot", [0, 0.55, 0.115]);
  const slotGlass = addShadowed(
    slotBacking,
    new THREE.BoxGeometry(0.47, 0.085, 0.016),
    new THREE.MeshStandardMaterial({ color: 0x30423d, emissive: 0x101c19, emissiveIntensity: 0.24, roughness: 0.18 }),
    "observation-glass",
    [0, 0, 0.026],
  );
  slotGlass.castShadow = false;

  const handlePivot = new THREE.Group();
  handlePivot.name = "exit-door-handle-pivot";
  handlePivot.position.set(0.74, -0.08, 0.17);
  const handleRose = addShadowed(handlePivot, new THREE.CylinderGeometry(0.105, 0.105, 0.035, 18), hardwareSurface, "handle-rose", [0, 0, 0]);
  handleRose.rotation.x = Math.PI / 2;
  const handle = addShadowed(handlePivot, new THREE.CapsuleGeometry(0.045, 0.32, 4, 10), hardwareSurface, "door-handle", [-0.17, 0, 0.035]);
  handle.rotation.z = Math.PI / 2;
  leafPivot.add(handlePivot);

  const lockCylinder = addShadowed(leafPivot, new THREE.CylinderGeometry(0.075, 0.075, 0.055, 18), hardwareSurface, "lock-cylinder", [0.74, -0.38, 0.17]);
  lockCylinder.rotation.x = Math.PI / 2;
  addShadowed(lockCylinder, new THREE.BoxGeometry(0.018, 0.045, 0.078), darkHardwareSurface, "lock-keyway", [0, 0.035, 0]);

  const lockBolt = addShadowed(leafPivot, new THREE.BoxGeometry(0.14, 0.1, 0.12), hardwareSurface, "lock-bolt", [1.13, -0.08, 0]);
  const strikePlate = addShadowed(root, new THREE.BoxGeometry(0.07, 0.42, 0.13), hardwareSurface, "strike-plate", [1.18, 1.4, 0.24]);
  addShadowed(strikePlate, new THREE.BoxGeometry(0.075, 0.16, 0.04), darkHardwareSurface, "strike-opening", [0, 0, 0.07]);

  for (const y of [-0.93, 0, 0.93]) {
    addShadowed(leafPivot, new THREE.CylinderGeometry(0.045, 0.045, 0.24, 12), hardwareSurface, "door-hinge", [-1.19, y, 0.06]);
    addShadowed(leafPivot, new THREE.BoxGeometry(0.14, 0.25, 0.025), hardwareSurface, "hinge-leaf", [-1.1, y, 0.045]);
  }
  root.add(leafPivot);
  scene.add(root);

  const braceRig = new THREE.Group();
  braceRig.name = "brace-rig";
  braceRig.position.set(0, -0.36, -0.68);
  for (const side of [-1, 1]) {
    const sleeve = addShadowed(braceRig, new THREE.CapsuleGeometry(0.105, 0.55, 5, 10), sleeveSurface, "brace-sleeve", [side * 0.24, -0.13, 0]);
    sleeve.rotation.x = Math.PI / 2.7;
    sleeve.rotation.z = side * -0.08;
    const hand = addShadowed(braceRig, new THREE.SphereGeometry(0.13, 16, 10), skinSurface, "brace-hand", [side * 0.24, 0.13, -0.38]);
    hand.scale.set(0.75, 1.2, 0.45);
  }
  braceRig.visible = false;
  camera.add(braceRig);

  const doorQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), root.rotation.y);
  const derivedInwardNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(doorQuaternion).normalize();
  const normal = asVector3(inwardNormal, derivedInwardNormal.toArray());
  if (normal.lengthSq() < 1e-12 || !Number.isFinite(normal.lengthSq())) normal.copy(derivedInwardNormal);
  normal.normalize();
  cleanVector(normal);
  const trigger = triggerPosition
    ? cleanVector(asVector3(triggerPosition, TRIGGER_LOCAL_OFFSET))
    : cleanVector(new THREE.Vector3(...TRIGGER_LOCAL_OFFSET).applyQuaternion(doorQuaternion).add(root.position));
  const colliderCenter = colliderPosition
    ? cleanVector(asVector3(colliderPosition, COLLIDER_LOCAL_OFFSET))
    : cleanVector(new THREE.Vector3(...COLLIDER_LOCAL_OFFSET).applyQuaternion(doorQuaternion).add(root.position));
  const colliderQuaternion = {
    x: doorQuaternion.x,
    y: doorQuaternion.y,
    z: doorQuaternion.z,
    w: doorQuaternion.w,
  };
  const bodyDescription = RAPIER.RigidBodyDesc.fixed().setTranslation(...colliderCenter);
  if (typeof bodyDescription.setRotation === "function") bodyDescription.setRotation(colliderQuaternion);
  const body = world.createRigidBody(bodyDescription);
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(...colliderHalfExtents), body);

  return {
    root,
    leafPivot,
    handlePivot,
    lockBolt,
    gapShadow,
    braceRig,
    position: root.position.clone(),
    rotationY: root.rotation.y,
    inwardNormal: normal,
    triggerPosition: trigger,
    colliderBody: body,
    colliderPosition: colliderCenter.clone(),
    colliderQuaternion,
    colliderRotation: doorQuaternion.clone(),
    collider,
  };
}
