import { describe, expect, it } from "vitest";
import { isFlashlightEnabled, setFlashlightEnabled, toggleFlashlight } from "../src/desktop/flashlight-state.js";

function makeFlashlightGroup() {
  return {
    visible: true,
    userData: {
      flashlightEnabled: true,
      flashlightLights: [
        { light: { intensity: 42 }, intensity: 42 },
        { light: { intensity: 8.4 }, intensity: 8.4 },
      ],
    },
  };
}

describe("flashlight toggle", () => {
  it("dims the lights instead of removing them from the scene graph", () => {
    const group = makeFlashlightGroup();
    expect(toggleFlashlight(group)).toBe(false);
    // Light count stays constant: no material recompile storm on toggle.
    expect(group.visible).toBe(true);
    expect(group.userData.flashlightLights[0].light.intensity).toBe(0);
    expect(group.userData.flashlightLights[1].light.intensity).toBe(0);
    expect(isFlashlightEnabled(group)).toBe(false);
  });

  it("restores the original intensities when toggled back on", () => {
    const group = makeFlashlightGroup();
    toggleFlashlight(group);
    expect(toggleFlashlight(group)).toBe(true);
    expect(group.userData.flashlightLights[0].light.intensity).toBe(42);
    expect(group.userData.flashlightLights[1].light.intensity).toBe(8.4);
    expect(isFlashlightEnabled(group)).toBe(true);
  });

  it("treats a group without recorded state as enabled", () => {
    expect(isFlashlightEnabled({ userData: {} })).toBe(true);
    expect(isFlashlightEnabled(null)).toBe(false);
    expect(setFlashlightEnabled(null, true)).toBe(false);
  });
});
