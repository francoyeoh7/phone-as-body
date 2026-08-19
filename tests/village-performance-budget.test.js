import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ELDERBOOM_V1_CONFIG } from "../scripts/environment/elderboom-v1.config.mjs";
import { VILLAGE_TEXTURE_LIMITS } from "../scripts/environment/optimize-village-textures.mjs";

const reportUrl = new URL(
  "../public/assets/environment/elderboom-v1/build-report.json",
  import.meta.url,
);

describe("village frame-rate budget", () => {
  it("caps dense foliage before it can dominate the scene", () => {
    expect(ELDERBOOM_V1_CONFIG.foliage).toMatchObject({
      cellSize: 5,
      maxInstancesPerMeshPerCell: 2,
      maxInstancesPerMesh: 120,
      highPolyTriangleThreshold: 100_000,
      maxHighPolyInstancesPerMesh: 0,
    });
  });

  it("caps runtime texture dimensions at the contracted limits", () => {
    expect(VILLAGE_TEXTURE_LIMITS).toEqual({ color: 768, data: 384 });
  });

  it("keeps the shipped village inside the runtime triangle budget", async () => {
    const report = JSON.parse(await readFile(reportUrl, "utf8"));

    expect(report.metrics.expandedTriangles).toBeLessThan(2_900_000);
    expect(report.artifact.bytes).toBeLessThan(50 * 1024 * 1024);
    expect(report.metrics.drawCalls).toBeLessThan(180);
  });
});
