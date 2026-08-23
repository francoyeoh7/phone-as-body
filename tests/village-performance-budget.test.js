import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  ELDERBOOM_V1_CONFIG,
  VILLAGE_QUALITY_PROFILES,
  villageGatesForQuality,
} from "../scripts/environment/elderboom-v1.config.mjs";

const reportUrl = new URL(
  "../public/assets/environment/elderboom-v1/build-report.json",
  import.meta.url,
);

describe("village frame-rate budget", () => {
  it("keeps every foliage instance and lets the quality tiers own texture budgets", () => {
    expect(ELDERBOOM_V1_CONFIG.foliage.maxInstancesPerMeshPerCell).toBe(Number.MAX_SAFE_INTEGER);
    expect(ELDERBOOM_V1_CONFIG.foliage.maxInstancesPerMesh).toBe(Number.MAX_SAFE_INTEGER);
    expect(ELDERBOOM_V1_CONFIG.foliage.maxHighPolyInstancesPerMesh).toBe(Number.MAX_SAFE_INTEGER);
    expect(ELDERBOOM_V1_CONFIG.defaultQuality).toBe("balanced");
  });

  it("scales texture gates monotonically across the four quality tiers", () => {
    const tiers = ["low", "balanced", "high", "ultra"];
    for (const tier of tiers) {
      expect(VILLAGE_QUALITY_PROFILES[tier].maxTextureTexels).toBeGreaterThan(0);
    }
    expect(VILLAGE_QUALITY_PROFILES.low.maxTextureTexels).toBeLessThan(VILLAGE_QUALITY_PROFILES.balanced.maxTextureTexels);
    expect(VILLAGE_QUALITY_PROFILES.balanced.maxTextureTexels).toBeLessThan(VILLAGE_QUALITY_PROFILES.high.maxTextureTexels);
    expect(VILLAGE_QUALITY_PROFILES.high.maxTextureTexels).toBeLessThan(VILLAGE_QUALITY_PROFILES.ultra.maxTextureTexels);
    expect(villageGatesForQuality("high").maxColorDimension).toBe(2048);
    expect(() => villageGatesForQuality("extreme")).toThrow(/unknown village quality/i);
  });

  it.runIf(existsSync(reportUrl))(
    "keeps every shipped village chunk inside its own quality gates",
    async () => {
      const report = JSON.parse(await readFile(reportUrl, "utf8"));

      expect(report.version).toBe(2);
      expect(report.defaultQuality).toBe("balanced");
      expect(report.chunks).toHaveLength(4);
      for (const chunk of report.chunks) {
        const gates = villageGatesForQuality(chunk.quality);
        expect(chunk.metrics.renderNodes).toBeLessThan(gates.maxRenderNodesExclusive);
        expect(chunk.metrics.drawCalls).toBeLessThan(gates.maxDrawCallsExclusive);
        expect(chunk.metrics.expandedTriangles).toBeLessThan(gates.maxExpandedTrianglesExclusive);
        expect(chunk.metrics.images).toBeLessThanOrEqual(gates.maxImages);
        expect(chunk.metrics.texels).toBeLessThanOrEqual(gates.maxTextureTexels);
        expect(chunk.metrics.maxColorDimension).toBeLessThanOrEqual(gates.maxColorDimension);
        expect(chunk.metrics.maxDataDimension).toBeLessThanOrEqual(gates.maxDataDimension);
        expect(chunk.artifact.bytes).toBeLessThanOrEqual(gates.maxArtifactBytes);
      }
      const byQuality = Object.fromEntries(report.chunks.map((chunk) => [chunk.quality, chunk]));
      expect(byQuality.low.metrics.texels).toBeLessThan(byQuality.balanced.metrics.texels);
      expect(byQuality.balanced.metrics.texels).toBeLessThan(byQuality.high.metrics.texels);
      expect(byQuality.high.metrics.texels).toBeLessThan(byQuality.ultra.metrics.texels);
    },
    30_000,
  );
});
