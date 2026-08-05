import { describe, expect, it } from "vitest";
import * as THREE from "three";
import * as sceneModule from "../src/desktop/create-scene.js";

function createRig(camera) {
  expect(sceneModule.createFlashlightRig).toBeTypeOf("function");
  return sceneModule.createFlashlightRig(camera, new THREE.Vector3(0, -0.05, -16), {
    cookieFactory: () => null,
  });
}

describe("flashlight rig", () => {
  it("uses a brighter long-range core, spill, and visible beam", () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = createRig(camera);

    expect(rig.core.intensity).toBeGreaterThan(26);
    expect(rig.core.distance).toBeGreaterThan(34);
    expect(rig.spill.intensity).toBeGreaterThan(4.2);
    expect(rig.spill.distance).toBeGreaterThan(18);
    expect(rig.outerBeam.geometry.parameters.height).toBeGreaterThan(8.2);
    expect(rig.innerBeam.geometry.parameters.height).toBeGreaterThan(6.1);
  });

  it("follows the final camera rotation with a frame-rate-independent 45ms lag", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(2, 1.6, -4);
    camera.rotation.set(0, 0, 0);
    const rig = createRig(camera);

    expect(sceneModule.updateFlashlightRig).toBeTypeOf("function");
    camera.rotation.y = Math.PI / 2;
    sceneModule.updateFlashlightRig(rig, camera, 0.045);

    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const expectedLag = 1 - Math.exp(-1);
    expect(rig.group.position.toArray()).toEqual([2, 1.6, -4]);
    expect(rig.group.quaternion.angleTo(expected)).toBeCloseTo((1 - expectedLag) * Math.PI / 2, 6);
  });

  it("converges to the same presentation pose over equal elapsed time at different frame rates", () => {
    const camera = new THREE.PerspectiveCamera();
    const atSixty = createRig(camera);
    const atThirty = createRig(camera);
    camera.rotation.y = Math.PI / 2;

    for (let frame = 0; frame < 6; frame += 1) sceneModule.updateFlashlightRig(atSixty, camera, 1 / 60);
    for (let frame = 0; frame < 3; frame += 1) sceneModule.updateFlashlightRig(atThirty, camera, 1 / 30);

    expect(atSixty.group.quaternion.angleTo(atThirty.group.quaternion)).toBeLessThan(1e-6);
  });
});
