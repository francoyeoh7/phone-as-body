import { describe, expect, it } from "vitest";
import { chooseAssistedTarget } from "../src/shared/interaction.js";

const camera = { x: 0, y: 1.6, z: 0 };
const forward = { x: 0, y: 0, z: -1 };

describe("assisted interaction targeting", () => {
  it("selects a nearby target slightly outside the center ray", () => {
    const target = chooseAssistedTarget(
      [{ id: "fuse", position: { x: -0.7, y: 1.2, z: -1.8 }, enabled: true, visible: true }],
      camera,
      forward,
    );
    expect(target?.id).toBe("fuse");
  });

  it("ignores targets that are too far away or behind the player", () => {
    const targets = [
      { id: "far", position: { x: 0, y: 1.4, z: -4 }, enabled: true, visible: true },
      { id: "behind", position: { x: 0, y: 1.4, z: 1 }, enabled: true, visible: true },
    ];
    expect(chooseAssistedTarget(targets, camera, forward)).toBeNull();
  });

  it("ignores disabled and hidden targets", () => {
    const targets = [
      { id: "disabled", position: { x: 0, y: 1.4, z: -1 }, enabled: false, visible: true },
      { id: "hidden", position: { x: 0, y: 1.4, z: -1 }, enabled: true, visible: false },
    ];
    expect(chooseAssistedTarget(targets, camera, forward)).toBeNull();
  });

  it("keeps current near-equal target but rejects its occluded anchor", () => {
    const targets = [
      { id: "fuse", enabled: true, visible: true, anchor: { x: 0.05, y: 1.6, z: -1.4 }, contactRadius: 0.22, maxUseDistance: 2.35, occluded: false },
      { id: "panel", enabled: true, visible: true, anchor: { x: 0.04, y: 1.6, z: -1.45 }, contactRadius: 0.22, maxUseDistance: 2.35, occluded: false },
    ];

    expect(chooseAssistedTarget(targets, camera, forward, { currentId: "fuse" })?.id).toBe("fuse");
    targets[0].occluded = true;
    expect(chooseAssistedTarget(targets, camera, forward, { currentId: "fuse" })?.id).toBe("panel");
  });
});
