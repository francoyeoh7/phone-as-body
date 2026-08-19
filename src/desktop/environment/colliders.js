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

function semanticKey(object) {
  const materialNames = (Array.isArray(object.material) ? object.material : [object.material])
    .map((entry) => entry?.name ?? "")
    .join(" ");
  return [object.name, object.geometry?.name, materialNames].filter(Boolean).join(" ").toLowerCase();
}

function generatedColliderDefinitions(environmentRoot) {
  if (!environmentRoot?.traverse) return [];
  environmentRoot.updateMatrixWorld?.(true);
  const definitions = [];
  const occupied = new Set();
  const treeCenters = [];
  const processBounds = (object, key, bounds, source) => {
    if (definitions.length >= 48) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite)) return;
    if (size.y < 0.35 || Math.max(size.x, size.z) < 0.12) return;

    const isTree = /blackalder|tree|trunk/i.test(key);
    if (isTree) {
      if (treeCenters.some((entry) => {
        const dx = entry.x - center.x;
        const dz = entry.z - center.z;
        return dx * dx + dz * dz < 1.44;
      })) return;
      treeCenters.push(center.clone());
      const radius = Math.min(0.7, Math.max(0.2, Math.min(size.x, size.z) * 0.075));
      const halfHeight = Math.min(2.15, Math.max(0.45, size.y * 0.24));
      const y = Math.max(bounds.min.y + halfHeight + radius, radius);
      definitions.push({
        id: `auto-tree-${definitions.length}`,
        shape: "capsule",
        position: [center.x, y, center.z],
        rotation: [0, 0, 0, 1],
        radius,
        halfHeight,
        source,
      });
      return;
    }

    const horizontalLong = Math.max(size.x, size.z);
    const horizontalShort = Math.min(size.x, size.z);
    // Some exported `instance-*` nodes contain a whole building or fence
    // cluster baked into one mesh. Their world AABB would seal the village.
    if (horizontalLong > 8 && !(horizontalLong <= 12 && horizontalShort <= 0.65)) return;
    const halfExtents = [
      Math.max(0.08, Math.min(size.x * 0.5, 8)),
      Math.max(0.2, Math.min(size.y * 0.5, 2.6)),
      Math.max(0.08, Math.min(size.z * 0.5, 8)),
    ];
    if (halfExtents[0] < 0.12 && halfExtents[2] < 0.12) return;
    const keyPosition = `${Math.round(center.x * 3)}:${Math.round(center.z * 3)}:${Math.round(size.x * 3)}:${Math.round(size.z * 3)}`;
    if (occupied.has(`wall:${keyPosition}`)) return;
    occupied.add(`wall:${keyPosition}`);
    definitions.push({
      id: `auto-structure-${definitions.length}`,
      shape: "box",
      position: [center.x, Math.max(center.y, halfExtents[1]), center.z],
      rotation: [0, 0, 0, 1],
      halfExtents,
      source,
    });
  };

  environmentRoot.traverse((object) => {
    if (!object.isMesh) return;
    const key = semanticKey(object);
    const isGround = /landscape|ground|terrain|grass|flower|foliage|leaf|plant|water/i.test(key);
    if (isGround) return;
    const isTree = /blackalder|tree|trunk/i.test(key);
    const isWall = /wall|fence|door/i.test(key);
    if (!isTree && !isWall) return;

    if (object.isInstancedMesh && Number.isInteger(object.count)) {
      object.geometry.computeBoundingBox?.();
      const localBounds = object.geometry.boundingBox;
      if (!localBounds) return;
      const instanceMatrix = new THREE.Matrix4();
      const worldMatrix = new THREE.Matrix4();
      for (let index = 0; index < object.count && definitions.length < 48; index += 1) {
        object.getMatrixAt(index, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        processBounds(
          object,
          key,
          localBounds.clone().applyMatrix4(worldMatrix),
          `${object.name}[${index}]`,
        );
      }
      return;
    }
    processBounds(object, key, new THREE.Box3().setFromObject(object), object.name);
  });
  return definitions;
}

export function createEnvironmentColliders({ RAPIER, world, manifest, environmentRoot = null, debug = false }) {
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
    const definitions = [
      ...(manifest.colliders ?? []),
      ...generatedColliderDefinitions(environmentRoot),
    ];
    for (const definition of definitions) {
      const bodyDescription = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...definition.position)
        .setRotation(rapierRotation(definition.rotation));
      const body = world.createRigidBody(bodyDescription);
      rigidBodies.push(body);

      const collider = world.createCollider(createColliderDescription(RAPIER, definition), body);
      collider.userData = {
        ...(collider.userData ?? {}),
        environmentColliderId: definition.id,
        environmentColliderSource: definition.source ?? "manifest",
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
