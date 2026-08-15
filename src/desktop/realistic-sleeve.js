import * as THREE from "three";

const RADIAL_SCALE = 1.12;
const FABRIC_SIZE = 16;
const EPSILON = 1e-8;

function smoothstep(min, max, value) {
  const t = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function createDataTexture(name, pixel) {
  const data = new Uint8Array(FABRIC_SIZE * FABRIC_SIZE * 4);
  for (let y = 0; y < FABRIC_SIZE; y += 1) {
    for (let x = 0; x < FABRIC_SIZE; x += 1) {
      const offset = (y * FABRIC_SIZE + x) * 4;
      const rgba = pixel(x, y);
      data.set(rgba, offset);
    }
  }
  const texture = new THREE.DataTexture(data, FABRIC_SIZE, FABRIC_SIZE, THREE.RGBAFormat);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 12);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createFabricMaterial() {
  const map = createDataTexture("LeftSleeveFabricBaseColor", (x, y) => {
    const warp = x % 4 === 0 ? 10 : 0;
    const weft = y % 4 === 0 ? 7 : 0;
    const variation = (x * 5 + y * 3) % 7;
    return [38 + warp + variation, 47 + weft + variation, 51 + variation, 255];
  });
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = createDataTexture("LeftSleeveFabricNormal", (x, y) => {
    const nx = x % 4 === 0 ? 14 : x % 4 === 2 ? -10 : 0;
    const ny = y % 4 === 0 ? 12 : y % 4 === 2 ? -8 : 0;
    return [128 + nx, 128 + ny, 248, 255];
  });
  const roughnessMap = createDataTexture("LeftSleeveFabricRoughness", (x, y) => {
    const thread = (x + y) % 4 === 0 ? 218 : 238;
    return [thread, thread, thread, 255];
  });
  const material = new THREE.MeshStandardMaterial({
    name: "LeftSleeveFabricMaterial",
    color: 0xffffff,
    map,
    normalMap,
    roughnessMap,
    metalness: 0,
    roughness: 0.86,
  });
  material.normalScale.set(0.38, 0.38);
  return material;
}

function localBonePosition(bone, parent) {
  bone.updateWorldMatrix?.(true, false);
  return parent.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
}

function closestPointOnSegment(point, start, end) {
  const axis = end.clone().sub(start);
  const lengthSq = axis.lengthSq();
  if (lengthSq < EPSILON) return start.clone();
  const amount = THREE.MathUtils.clamp(point.clone().sub(start).dot(axis) / lengthSq, 0, 1);
  return start.clone().addScaledVector(axis, amount);
}

function closestArmAxisPoint(point, upper, elbow, wrist) {
  const upperPoint = closestPointOnSegment(point, upper, elbow);
  const forearmPoint = closestPointOnSegment(point, elbow, wrist);
  return point.distanceToSquared(upperPoint) <= point.distanceToSquared(forearmPoint)
    ? upperPoint
    : forearmPoint;
}

function vertexBoneWeight(skinIndex, skinWeight, vertex, boneIndexes) {
  let weight = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    if (boneIndexes.has(skinIndex.getComponent(vertex, slot))) {
      weight += skinWeight.getComponent(vertex, slot);
    }
  }
  return weight;
}

function dominantBoneIndex(skinIndex, skinWeight, vertex) {
  let dominantSlot = 0;
  for (let slot = 1; slot < 4; slot += 1) {
    if (skinWeight.getComponent(vertex, slot) > skinWeight.getComponent(vertex, dominantSlot)) {
      dominantSlot = slot;
    }
  }
  return skinIndex.getComponent(vertex, dominantSlot);
}

function createInflatedShellGeometry(source, indexes, upper, elbow, wrist) {
  const geometry = source.geometry.clone();
  const sourcePositions = source.geometry.getAttribute("position");
  const positions = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const sourceIndex = source.geometry.index?.array;
  if (!sourcePositions || !positions || !skinIndex || !skinWeight || !sourceIndex) {
    geometry.dispose();
    throw new Error("realistic sleeve requires indexed skinned ArmsMesh geometry");
  }

  const armIndexes = new Set([indexes.upperArm, indexes.forearm]);
  const kept = [];
  const usedVertices = new Set();
  for (let offset = 0; offset < sourceIndex.length; offset += 3) {
    const triangle = [sourceIndex[offset], sourceIndex[offset + 1], sourceIndex[offset + 2]];
    const isArmSurface = triangle.every((vertex) => (
      armIndexes.has(dominantBoneIndex(skinIndex, skinWeight, vertex))
    ));
    if (!isArmSurface) continue;
    kept.push(...triangle);
    triangle.forEach((vertex) => usedVertices.add(vertex));
  }
  if (kept.length === 0) {
    geometry.dispose();
    throw new Error("realistic sleeve could not find upper-arm or forearm triangles");
  }

  for (const vertex of usedVertices) {
    const sourcePoint = new THREE.Vector3().fromBufferAttribute(sourcePositions, vertex);
    const center = closestArmAxisPoint(sourcePoint, upper, elbow, wrist);
    const radial = sourcePoint.clone().sub(center);
    if (radial.lengthSq() < EPSILON) continue;
    const inflated = center.addScaledVector(radial, RADIAL_SCALE);
    positions.setXYZ(vertex, inflated.x, inflated.y, inflated.z);
  }
  positions.needsUpdate = true;
  geometry.setIndex(kept);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "LeftLongSleeveGeometry";
  geometry.userData.radialScale = RADIAL_SCALE;
  geometry.userData.profile = "inflated-source-surface";
  return geometry;
}

function measureCuffRadius(source, indexes, elbow, wrist) {
  const positions = source.geometry.getAttribute("position");
  const skinIndex = source.geometry.getAttribute("skinIndex");
  const skinWeight = source.geometry.getAttribute("skinWeight");
  const forearmIndexes = new Set([indexes.forearm]);
  const axis = wrist.clone().sub(elbow);
  let radius = 0;
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    if (vertexBoneWeight(skinIndex, skinWeight, vertex, forearmIndexes) < 0.05) continue;
    const point = new THREE.Vector3().fromBufferAttribute(positions, vertex);
    const amount = THREE.MathUtils.clamp(point.clone().sub(elbow).dot(axis) / axis.lengthSq(), 0, 1);
    if (amount < 0.65) continue;
    radius = Math.max(radius, point.distanceTo(elbow.clone().addScaledVector(axis, amount)));
  }
  return Math.max(radius * RADIAL_SCALE, 0.04);
}

function skinInfluences(t, indexes) {
  const upperToForearm = smoothstep(0.38, 0.54, t);
  const forearmToHand = smoothstep(0.82, 1, t);
  if (t < 0.54) {
    return {
      indices: [indexes.upperArm, indexes.forearm, 0, 0],
      weights: [1 - upperToForearm, upperToForearm, 0, 0],
    };
  }
  return {
    indices: [indexes.forearm, indexes.hand, 0, 0],
    weights: [1 - forearmToHand, forearmToHand, 0, 0],
  };
}

function createCuffGeometry(curve, indexes, baseRadius) {
  const tubularSegments = 10;
  const radialSegments = 16;
  const startT = 0.88;
  const endT = 1;
  const positions = [];
  const normals = [];
  const uvs = [];
  const skinIndices = [];
  const skinWeights = [];
  const indices = [];
  const reference = new THREE.Vector3(0, 0, 1);

  for (let ring = 0; ring <= tubularSegments; ring += 1) {
    const along = ring / tubularSegments;
    const t = THREE.MathUtils.lerp(startT, endT, along);
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    let normal = reference.clone().cross(tangent);
    if (normal.lengthSq() < EPSILON) normal = new THREE.Vector3(1, 0, 0).cross(tangent);
    normal.normalize();
    const binormal = tangent.clone().cross(normal).normalize();
    const influence = skinInfluences(t, indexes);
    for (let side = 0; side <= radialSegments; side += 1) {
      const around = side / radialSegments;
      const theta = around * Math.PI * 2;
      const wrinkle = 1 + Math.sin(along * Math.PI * 8) * 0.025;
      const radius = baseRadius * wrinkle;
      const radial = normal.clone().multiplyScalar(Math.cos(theta))
        .addScaledVector(binormal, Math.sin(theta));
      const position = center.clone().addScaledVector(radial, radius);
      positions.push(...position.toArray());
      normals.push(...radial.toArray());
      uvs.push(around, along * 2);
      skinIndices.push(...influence.indices);
      skinWeights.push(...influence.weights);
    }
  }

  const stride = radialSegments + 1;
  for (let ring = 0; ring < tubularSegments; ring += 1) {
    for (let side = 0; side < radialSegments; side += 1) {
      const a = ring * stride + side;
      const b = (ring + 1) * stride + side;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = "LeftSleeveCuffGeometry";
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.radialScale = RADIAL_SCALE;
  geometry.userData.profile = "ribbed-cuff";
  return geometry;
}

function bindLayer(name, geometry, material, source) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bindMode = source.bindMode;
  mesh.bind(source.skeleton, source.bindMatrix);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.sleeveLayer = true;
  mesh.userData.radialScale = RADIAL_SCALE;
  return mesh;
}

export function createRealisticSleeve(root, bones, side = "left") {
  const suffix = side === "left" ? "L" : "R";
  const label = side === "left" ? "Left" : "Right";
  let source = root?.getObjectByName?.("ArmsMesh") ?? null;
  if (!source?.isSkinnedMesh) {
    root?.traverse?.((object) => { if (!source && object.isSkinnedMesh) source = object; });
  }
  const parent = source?.parent;
  const upperArm = bones?.[`upper_arm${suffix}`] ?? source?.skeleton?.getBoneByName?.(`upper_arm${suffix}`);
  const forearm = bones?.[`forearm${suffix}`] ?? source?.skeleton?.getBoneByName?.(`forearm${suffix}`);
  const hand = bones?.[`hand${suffix}`] ?? source?.skeleton?.getBoneByName?.(`hand${suffix}`);
  if (!source?.skeleton || !parent || !upperArm || !forearm || !hand) {
    throw new Error("realistic sleeve requires an ArmsMesh upper-arm, forearm, and hand rig");
  }

  parent.updateWorldMatrix?.(true, true);
  const upper = localBonePosition(upperArm, parent);
  const elbow = localBonePosition(forearm, parent);
  const wrist = localBonePosition(hand, parent);
  const curve = new THREE.CatmullRomCurve3([
    upper,
    upper.clone().lerp(elbow, 0.5),
    elbow,
    elbow.clone().lerp(wrist, 0.5),
    wrist,
  ], false, "centripetal");
  const indexes = {
    upperArm: source.skeleton.bones.indexOf(upperArm),
    forearm: source.skeleton.bones.indexOf(forearm),
    hand: source.skeleton.bones.indexOf(hand),
  };
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error("realistic sleeve bones must belong to the ArmsMesh skeleton");
  }

  let shellGeometry;
  let cuffGeometry;
  try {
    shellGeometry = createInflatedShellGeometry(source, indexes, upper, elbow, wrist);
    cuffGeometry = createCuffGeometry(
      curve,
      indexes,
      measureCuffRadius(source, indexes, elbow, wrist),
    );
  } catch (error) {
    shellGeometry?.dispose();
    cuffGeometry?.dispose();
    throw error;
  }

  const fabric = createFabricMaterial();
  const cuffMaterial = fabric.clone();
  cuffMaterial.name = "LeftSleeveCuffMaterial";
  cuffMaterial.color.setHex(0xd7dbd9);
  cuffMaterial.roughness = 0.92;
  cuffMaterial.normalScale.set(0.52, 0.52);
  shellGeometry.name = `${label}LongSleeveGeometry`;
  cuffGeometry.name = `${label}SleeveCuffGeometry`;
  fabric.name = `${label}SleeveFabricMaterial`;
  cuffMaterial.name = `${label}SleeveCuffMaterial`;
  const shell = bindLayer(`${label}SleeveShell`, shellGeometry, fabric, source);
  const cuff = bindLayer(`${label}SleeveCuff`, cuffGeometry, cuffMaterial, source);
  const sleeve = new THREE.Group();
  sleeve.name = `${label}RealisticSleeve`;
  sleeve.userData.sleeveLayer = true;
  sleeve.userData.radialScale = RADIAL_SCALE;
  sleeve.add(shell, cuff);
  parent.add(sleeve);
  return sleeve;
}
