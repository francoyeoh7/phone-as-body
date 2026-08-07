import * as THREE from "three";

const EPSILON = 1e-8;
const ARM_ENTRY_SWEEP = THREE.MathUtils.degToRad(42);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function normalize(value, fallback = new THREE.Vector3(0, 1, 0)) {
  const result = value.clone();
  if (!Number.isFinite(result.lengthSq()) || result.lengthSq() < EPSILON) return fallback.clone();
  return result.normalize();
}

function basisFromRest(bones, side) {
  const wrist = bones.wrist.position.clone();
  const up = normalize(bones["middle-finger-metacarpal"].position.clone().sub(wrist));
  const across = bones["pinky-finger-metacarpal"].position.clone()
    .sub(bones["index-finger-metacarpal"].position);
  let right = across.clone().sub(up.clone().multiplyScalar(across.dot(up)));
  if (side === "left") right.multiplyScalar(-1);
  right = normalize(right, new THREE.Vector3(1, 0, 0));
  const forward = normalize(right.clone().cross(up), new THREE.Vector3(0, 0, 1));
  const correctedUp = normalize(forward.clone().cross(right), up);
  return { right, up: correctedUp, forward };
}

function poseBasis(pose) {
  return {
    right: normalize(new THREE.Vector3(...(pose?.wrist?.right ?? [1, 0, 0])), new THREE.Vector3(1, 0, 0)),
    up: normalize(new THREE.Vector3(...(pose?.wrist?.up ?? [0, 1, 0]))),
    forward: normalize(new THREE.Vector3(...(pose?.wrist?.forward ?? [0, 0, 1])), new THREE.Vector3(0, 0, 1)),
  };
}

function displayPoseBasis(pose) {
  const basis = poseBasis(pose);
  const toThreeCamera = (vector) => new THREE.Vector3(vector.x, -vector.y, -vector.z);
  return {
    right: toThreeCamera(basis.right),
    up: toThreeCamera(basis.up),
    forward: toThreeCamera(basis.forward),
  };
}

function finitePoint(value) {
  const point = value?.position ?? value;
  const vector = Array.isArray(point)
    ? new THREE.Vector3(...point.slice(0, 3))
    : new THREE.Vector3(point?.x, point?.y, point?.z);
  return vector.x === undefined || !vector.toArray().every(Number.isFinite) ? null : vector;
}

function mapPoint(point, wrist, tracked, rest, scale) {
  const delta = point.clone().sub(wrist);
  const x = delta.dot(tracked.right);
  const y = delta.dot(tracked.up);
  const z = delta.dot(tracked.forward);
  return rest.wrist.clone()
    .add(rest.basis.right.clone().multiplyScalar(x * scale))
    .add(rest.basis.up.clone().multiplyScalar(y * scale))
    .add(rest.basis.forward.clone().multiplyScalar(z * scale));
}

export function createFlatWebXRAdapter(bones, side = "right") {
  if (!bones?.wrist) throw new Error("flat hand adapter requires a wrist bone");
  const restPositions = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.position.clone()]));
  const restQuaternions = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.quaternion.clone()]));
  const rest = {
    wrist: restPositions.wrist.clone(),
    basis: basisFromRest(bones, side),
    palmSpan: restPositions.wrist.distanceTo(restPositions["middle-finger-metacarpal"]),
  };
  const childByName = {
    wrist: "middle-finger-metacarpal",
    "thumb-metacarpal": "thumb-phalanx-proximal",
    "thumb-phalanx-proximal": "thumb-phalanx-distal",
    "thumb-phalanx-distal": "thumb-tip",
    "index-finger-metacarpal": "index-finger-phalanx-proximal",
    "index-finger-phalanx-proximal": "index-finger-phalanx-intermediate",
    "index-finger-phalanx-intermediate": "index-finger-phalanx-distal",
    "index-finger-phalanx-distal": "index-finger-tip",
    "middle-finger-metacarpal": "middle-finger-phalanx-proximal",
    "middle-finger-phalanx-proximal": "middle-finger-phalanx-intermediate",
    "middle-finger-phalanx-intermediate": "middle-finger-phalanx-distal",
    "middle-finger-phalanx-distal": "middle-finger-tip",
    "ring-finger-metacarpal": "ring-finger-phalanx-proximal",
    "ring-finger-phalanx-proximal": "ring-finger-phalanx-intermediate",
    "ring-finger-phalanx-intermediate": "ring-finger-phalanx-distal",
    "ring-finger-phalanx-distal": "ring-finger-tip",
    "pinky-finger-metacarpal": "pinky-finger-phalanx-proximal",
    "pinky-finger-phalanx-proximal": "pinky-finger-phalanx-intermediate",
    "pinky-finger-phalanx-intermediate": "pinky-finger-phalanx-distal",
    "pinky-finger-phalanx-distal": "pinky-finger-tip",
  };

  return {
    side,
    restPositions,
    restQuaternions,
    rest,
    mapJoints(entries, pose) {
      const points = Object.fromEntries((entries ?? []).map((entry) => [entry.name, finitePoint(entry)]));
      const wristPoint = points.wrist;
      if (!wristPoint) return null;
      const tracked = poseBasis(pose);
      const measuredSpan = Number.isFinite(pose?.palmSpan) && pose.palmSpan > EPSILON ? pose.palmSpan : 1;
      const scale = clamp(rest.palmSpan / measuredSpan, 0.04, 0.8);
      const mapped = {};
      for (const [name, point] of Object.entries(points)) {
        if (point) mapped[name] = mapPoint(point, wristPoint, tracked, rest, scale);
      }
      const transforms = {};
      for (const [name, position] of Object.entries(mapped)) {
        const childName = childByName[name] ?? name;
        const targetChild = mapped[childName] ?? position;
        const restChild = restPositions[childName] ?? restPositions[name] ?? position;
        const restDirection = normalize(restChild.clone().sub(restPositions[name] ?? position));
        const targetDirection = normalize(targetChild.clone().sub(position), restDirection);
        const delta = new THREE.Quaternion().setFromUnitVectors(restDirection, targetDirection);
        transforms[name] = {
          position,
          quaternion: delta.multiply(restQuaternions[name] ?? new THREE.Quaternion()).normalize(),
        };
      }
      return { transforms, scale, wrist: mapped.wrist.clone() };
    },
  };
}

function poseBasisQuaternion(pose) {
  const basis = displayPoseBasis(pose);
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(basis.right, basis.up, basis.forward),
  ).normalize();
}

function trackedDirection(start, end, pose) {
  const a = finitePoint(start);
  const b = finitePoint(end);
  if (!a || !b) return null;
  const delta = b.sub(a);
  const basis = poseBasis(pose);
  return new THREE.Vector3(
    delta.dot(basis.right),
    delta.dot(basis.up),
    delta.dot(basis.forward),
  ).normalize();
}

function discoverEntryMap(entries) {
  return Object.fromEntries((entries ?? []).map((entry) => [entry.name, finitePoint(entry)]));
}

function restWorldPosition(object) {
  object.updateWorldMatrix?.(true, false);
  const position = new THREE.Vector3();
  object.getWorldPosition(position);
  return position;
}

function restWorldQuaternion(object) {
  object.updateWorldMatrix?.(true, false);
  const quaternion = new THREE.Quaternion();
  object.getWorldQuaternion(quaternion);
  return quaternion.normalize();
}

function restPalmQuaternion(bones, suffix, side, fallback) {
  const hand = bones?.[`hand${suffix}`];
  const index = bones?.[`palm01${suffix}`];
  const middle = bones?.[`palm02${suffix}`];
  const pinky = bones?.[`palm04${suffix}`];
  if (!hand || !index || !middle || !pinky) return fallback.clone();
  const wristPosition = restWorldPosition(hand);
  const up = restWorldPosition(middle).sub(wristPosition);
  const across = restWorldPosition(pinky).sub(restWorldPosition(index));
  if (up.lengthSq() < EPSILON || across.lengthSq() < EPSILON) return fallback.clone();
  up.normalize();
  const right = across.sub(up.clone().multiplyScalar(across.dot(up)));
  if (side === "left") right.multiplyScalar(-1);
  if (right.lengthSq() < EPSILON) return fallback.clone();
  right.normalize();
  const forward = right.clone().cross(up).normalize();
  const correctedUp = forward.clone().cross(right).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, correctedUp, forward),
  ).normalize();
}

const ARM_SEGMENTS = [
  ["palm01", "wrist", "index-finger-metacarpal"],
  ["palm02", "wrist", "middle-finger-metacarpal"],
  ["palm03", "wrist", "ring-finger-metacarpal"],
  ["palm04", "wrist", "pinky-finger-metacarpal"],
  ["thumb01", "thumb-metacarpal", "thumb-phalanx-proximal"],
  ["thumb02", "thumb-phalanx-proximal", "thumb-phalanx-distal"],
  ["thumb03", "thumb-phalanx-distal", "thumb-tip"],
  ["f_index01", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate"],
  ["f_index02", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal"],
  ["f_index03", "index-finger-phalanx-distal", "index-finger-tip"],
  ["f_middle01", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate"],
  ["f_middle02", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal"],
  ["f_middle03", "middle-finger-phalanx-distal", "middle-finger-tip"],
  ["f_ring01", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate"],
  ["f_ring02", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal"],
  ["f_ring03", "ring-finger-phalanx-distal", "ring-finger-tip"],
  ["f_pinky01", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate"],
  ["f_pinky02", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal"],
  ["f_pinky03", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
];

function fingerIndexForBone(name) {
  if (name.startsWith("thumb")) return 0;
  if (name.startsWith("palm01") || name.startsWith("f_index")) return 1;
  if (name.startsWith("palm02") || name.startsWith("f_middle")) return 2;
  if (name.startsWith("palm03") || name.startsWith("f_ring")) return 3;
  if (name.startsWith("palm04") || name.startsWith("f_pinky")) return 4;
  return null;
}

function sampleClipQuaternion(clip, boneName, time) {
  const track = clip?.tracks?.find((entry) => entry.name === `${boneName}.quaternion`);
  if (!track) return null;
  const value = track.createInterpolant(new Float32Array(4)).evaluate(time);
  return new THREE.Quaternion(value[0], value[1], value[2], value[3]).normalize();
}

function createAuthoredFingerPoses(animations, suffix, restQuaternions) {
  const restClip = animations?.find?.((clip) => clip.name === "rest");
  const grabClip = animations?.find?.((clip) => clip.name === `grab.${suffix}`);
  if (!grabClip) return {};
  const result = {};
  for (const [baseName] of ARM_SEGMENTS) {
    const name = `${baseName}${suffix}`;
    const closed = sampleClipQuaternion(grabClip, name, grabClip.duration);
    if (!closed) continue;
    result[name] = {
      finger: fingerIndexForBone(baseName),
      open: sampleClipQuaternion(restClip, name, 0) ?? restQuaternions[name]?.clone() ?? new THREE.Quaternion(),
      closed,
    };
  }
  return result;
}

/**
 * Keeps the forearm on a stable lower-screen entry path while retargeting the
 * wrist basis and blending each finger between the rig's authored poses.
 */
export function createArmRigAdapter(root, bones, side = "right", animations = []) {
  const suffix = side === "right" ? "L" : "R";
  const otherSuffix = suffix === "L" ? "R" : "L";
  const hand = bones?.[`hand${suffix}`];
  const activeShoulder = bones?.[`shoulder${suffix}`];
  const inactiveShoulder = bones?.[`shoulder${otherSuffix}`];
  if (!root || !hand || !activeShoulder || !inactiveShoulder) throw new Error("arm rig missing side bones");
  const armEntryQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI + (side === "left" ? ARM_ENTRY_SWEEP : -ARM_ENTRY_SWEEP),
  );

  root.updateMatrixWorld?.(true);
  const restHandPosition = restWorldPosition(hand);
  const restHandQuaternion = restWorldQuaternion(hand);
  const authoredPalmQuaternion = restPalmQuaternion(bones, suffix, side, restHandQuaternion);
  const handToPalmQuaternion = restHandQuaternion.clone().invert().multiply(authoredPalmQuaternion).normalize();
  const palmReference = bones?.[`palm02${suffix}`] ?? hand;
  const restPalmSpan = Math.max(restHandPosition.distanceTo(restWorldPosition(palmReference)), 0.02);
  const restQuaternions = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, bone.quaternion.clone()]),
  );
  const authoredFingerPoses = createAuthoredFingerPoses(animations, suffix, restQuaternions);
  const restParentWorldQuaternions = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [
      name,
      bone.parent ? restWorldQuaternion(bone.parent) : new THREE.Quaternion(),
    ]),
  );
  const restScales = new Map([
    [activeShoulder, activeShoulder.scale.clone()],
    [inactiveShoulder, inactiveShoulder.scale.clone()],
  ]);
  const restShoulderPositions = new Map([
    [activeShoulder, activeShoulder.position.clone()],
    [inactiveShoulder, inactiveShoulder.position.clone()],
  ]);

  return {
    side,
    suffix,
    restHandPosition,
    restHandQuaternion,
    restPalmQuaternion: authoredPalmQuaternion,
    handToPalmQuaternion,
    restPalmSpan,
    prepareModel() {
      for (const [shoulder, scale] of restScales) {
        shoulder.scale.copy(scale);
        shoulder.position.copy(restShoulderPositions.get(shoulder));
      }
      inactiveShoulder.position.y -= 20;
      inactiveShoulder.scale.setScalar(0.0001);
      activeShoulder.scale.copy(restScales.get(activeShoulder));
    },
    mapJoints(entries, pose) {
      const points = discoverEntryMap(entries);
      if (!points.wrist) return null;
      const targetPalmQuaternion = poseBasisQuaternion(pose);
      const transforms = {};
      const byName = Object.fromEntries(
        ARM_SEGMENTS.map(([name, start, end]) => [`${name}${this.suffix}`, { start, end }]),
      );
      const relativeScale = Number.isFinite(pose?.relativeScale) && pose.relativeScale > EPSILON
        ? pose.relativeScale
        : 1;
      const scale = clamp(1.05 * Math.sqrt(relativeScale), 0.82, 1.32);

      for (const [name, source] of Object.entries(byName)) {
        const bone = bones[name];
        const child = bone?.children?.[0];
        const authoredPose = authoredFingerPoses[name];
        if (bone && authoredPose && authoredPose.finger !== null) {
          const curl = clamp(pose?.curls?.[authoredPose.finger] ?? 0, 0, 1);
          transforms[name] = {
            quaternion: authoredPose.open.clone().slerp(authoredPose.closed, curl).normalize(),
          };
          continue;
        }
        const direction = trackedDirection(points[source.start], points[source.end], pose);
        if (!bone || !child || !direction) continue;
        const targetModelDirection = direction.clone().applyQuaternion(this.restHandQuaternion).normalize();
        const parentRestQuaternion = restParentWorldQuaternions[name]?.clone() ?? new THREE.Quaternion();
        const targetLocalDirection = targetModelDirection.applyQuaternion(parentRestQuaternion.invert()).normalize();
        const restLocalDirection = normalize(child.position, new THREE.Vector3(0, 1, 0));
        const delta = new THREE.Quaternion().setFromUnitVectors(restLocalDirection, targetLocalDirection);
        transforms[name] = { quaternion: delta.multiply(restQuaternions[name] ?? bone.quaternion).normalize() };
      }

      const handParentRestQuaternion = restParentWorldQuaternions[hand.name]?.clone() ?? new THREE.Quaternion();
      const targetHandWorldQuaternion = targetPalmQuaternion.clone()
        .multiply(this.handToPalmQuaternion.clone().invert())
        .normalize();
      transforms[hand.name] = {
        quaternion: handParentRestQuaternion.invert()
          .multiply(armEntryQuaternion.clone().invert())
          .multiply(targetHandWorldQuaternion)
          .normalize(),
      };

      return { transforms, rootQuaternion: armEntryQuaternion.clone(), scale };
    },
  };
}
