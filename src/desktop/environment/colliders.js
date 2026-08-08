import * as THREE from "three";

function rapierRotation(rotation) {
  return {
    x: rotation[0],
    y: rotation[1],
    z: rotation[2],
    w: rotation[3],
  };
}

function createColliderDescription(RAPIER, definition) {
  if (definition.shape === "box") {
    return RAPIER.ColliderDesc.cuboid(...definition.halfExtents);
  }
  if (definition.shape === "capsule") {
    return RAPIER.ColliderDesc.capsule(definition.halfHeight, definition.radius);
  }
  throw new TypeError(`Unsupported environment collider shape: ${definition.shape}`);
}

function createOccluderRoot(definition, occluder, debug) {
  const geometry = new THREE.BoxGeometry(
    definition.halfExtents[0] * 2,
    definition.halfExtents[1] * 2,
    definition.halfExtents[2] * 2,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0x36d399,
    side: THREE.DoubleSide,
    wireframe: true,
    transparent: true,
    opacity: debug ? 0.3 : 0,
    depthWrite: false,
  });
  material.visible = debug;

  const root = new THREE.Mesh(geometry, material);
  root.name = `environment-occluder:${occluder.id}`;
  root.position.set(...definition.position);
  root.quaternion.set(...definition.rotation);
  root.frustumCulled = false;
  root.userData.environmentOccluder = true;
  root.userData.environmentColliderId = definition.id;
  return root;
}

export function createEnvironmentColliders({ RAPIER, world, manifest, debug = false }) {
  const colliders = [];
  const rigidBodies = [];
  const occluderRoots = [];
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;

    for (const root of occluderRoots) {
      root.removeFromParent();
      root.geometry.dispose();
      const materials = Array.isArray(root.material) ? root.material : [root.material];
      for (const material of materials) material.dispose();
    }
    for (const body of rigidBodies) world.removeRigidBody(body);
  };

  try {
    for (const definition of manifest.colliders) {
      const bodyDescription = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...definition.position)
        .setRotation(rapierRotation(definition.rotation));
      const body = world.createRigidBody(bodyDescription);
      rigidBodies.push(body);

      const collider = world.createCollider(createColliderDescription(RAPIER, definition), body);
      collider.userData = {
        ...(collider.userData ?? {}),
        environmentColliderId: definition.id,
      };
      colliders.push(collider);
    }

    const colliderById = new Map(manifest.colliders.map((definition) => [definition.id, definition]));
    for (const occluder of manifest.occluders) {
      const definition = colliderById.get(occluder.colliderId);
      if (!definition || definition.shape !== "box") {
        throw new TypeError(`Environment occluder ${occluder.id} must reference a box collider`);
      }
      occluderRoots.push(createOccluderRoot(definition, occluder, debug));
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    colliders,
    rigidBodies,
    occluderRoots,
    dispose,
  };
}
