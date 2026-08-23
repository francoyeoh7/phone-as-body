import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const manifestPath = new URL("../public/assets/environment/elderboom-v1/manifest.json", import.meta.url);

describe("village night lighting", () => {
  it("keeps a readable blue-black atmosphere and reserves local contrast for the flashlight", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.atmosphere.background.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.atmosphere.fog.color.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    const background = Number.parseInt(manifest.atmosphere.background.slice(1), 16);
    expect(background).toBeGreaterThan(0x050810);
    expect(background).toBeLessThan(0x0d1520);
    const fog = Number.parseInt(manifest.atmosphere.fog.color.slice(1), 16);
    expect(fog).toBeGreaterThan(background);
    expect(fog).toBeLessThan(0x182438);
    const moon = manifest.lights.find((light) => light.id === "moon-key");
    const hemi = manifest.lights.find((light) => light.id === "night-hemi");
    // Darker night so the flashlight reads as the main light source.
    expect(moon.intensity).toBeGreaterThan(0.2);
    expect(moon.intensity).toBeLessThan(0.35);
    expect(hemi.intensity).toBeGreaterThan(0.08);
    expect(hemi.intensity).toBeLessThan(0.18);
  });

  it("uses the actual ElderBoom architecture, wall, fence, well, and tree names for shadow casters", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.chunks[0].castShadowNamePrefixes).toEqual(expect.arrayContaining([
      "S_Medieval_Modular_",
      "Wall_",
      "S_Mossy_Stone_Wall_",
      "S_Modular_Fence_",
      "SM_BlackAlder_",
      "S_Japanese_Wooden_Well_Roof_",
    ]));
  });
});
