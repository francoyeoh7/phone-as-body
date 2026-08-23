import {
  ENVIRONMENT_DEFAULT_QUALITY,
  ENVIRONMENT_QUALITY_LEVELS,
} from "../../src/desktop/environment/manifest.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const VILLAGE_QUALITY_PROFILES = deepFreeze({
  low: {
    id: "low",
    label: "流畅",
    encoding: "webp",
    colorMax: 1024,
    dataMax: 512,
    webpQuality: 85,
    maxTextureTexels: 450_000_000,
    maxArtifactBytes: 768 * 1024 * 1024,
  },
  balanced: {
    id: "balanced",
    label: "均衡",
    encoding: "webp",
    colorMax: 1536,
    dataMax: 768,
    webpQuality: 88,
    maxTextureTexels: 850_000_000,
    maxArtifactBytes: 768 * 1024 * 1024,
  },
  high: {
    id: "high",
    label: "高清",
    encoding: "webp",
    colorMax: 2048,
    dataMax: 1024,
    webpQuality: 90,
    maxTextureTexels: 1_200_000_000,
    maxArtifactBytes: 768 * 1024 * 1024,
  },
  ultra: {
    id: "ultra",
    label: "极限",
    encoding: "original",
    colorMax: 8192,
    dataMax: 8192,
    webpQuality: null,
    maxTextureTexels: 2_100_000_000,
    maxArtifactBytes: 1024 * 1024 * 1024,
  },
});

export const ELDERBOOM_V1_CONFIG = deepFreeze({
  id: "elderboom-v1",
  source: {
    defaultPath: "D:\\3d资产\\ElderBoomHollow\\source\\elderbloom_hollow.glb",
    bytes: 936_886_692,
    sha256: "0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB",
  },
  selection: { bounds: { min: [-51, -1, -51], max: [102, 30, 102] } },
  rootTransform: { position: [-7.5, -1, -30], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  excludeNamePatterns: [
    /^LandscapeHeightfieldCollisionComponent/,
    /^InstancedFoliageActor/,
    /^NS_/,
  ],
  foliage: {
    seed: "elderboom-v1",
    denseNamePatterns: [
      /^FoliageInstancedStaticMeshComponent_\d+:/,
    ],
    cellSize: 5,
    maxInstancesPerMeshPerCell: Number.MAX_SAFE_INTEGER,
    maxInstancesPerMesh: Number.MAX_SAFE_INTEGER,
    highPolyTriangleThreshold: 100_000,
    maxHighPolyInstancesPerMesh: Number.MAX_SAFE_INTEGER,
  },
  instancing: {
    tileSize: 16,
    minGroupSize: 16,
  },
  geometryGates: {
    maxRenderNodesExclusive: 3200,
    maxDrawCallsExclusive: 5200,
    maxExpandedTrianglesExclusive: 120_000_000,
    maxImages: 1600,
  },
  defaultQuality: ENVIRONMENT_DEFAULT_QUALITY,
  chunks: [
    { id: "full-village-low", quality: "low" },
    { id: "full-village-balanced", quality: "balanced" },
    { id: "full-village-high", quality: "high" },
    { id: "full-village-ultra", quality: "ultra" },
  ],
  outputs: {
    directory: "public/assets/environment/elderboom-v1/chunks",
    report: "public/assets/environment/elderboom-v1/build-report.json",
    manifest: "public/assets/environment/elderboom-v1/manifest.json",
  },
});

export function villageQualityProfile(quality, profiles = VILLAGE_QUALITY_PROFILES) {
  const profile = profiles[quality];
  if (!profile) throw new Error(`Unknown village quality level: ${quality}`);
  return profile;
}

export function villageGatesForQuality(quality, config = ELDERBOOM_V1_CONFIG) {
  const profile = villageQualityProfile(quality);
  return {
    maxRenderNodesExclusive: config.geometryGates.maxRenderNodesExclusive,
    maxDrawCallsExclusive: config.geometryGates.maxDrawCallsExclusive,
    maxExpandedTrianglesExclusive: config.geometryGates.maxExpandedTrianglesExclusive,
    maxImages: config.geometryGates.maxImages,
    maxTextureTexels: profile.maxTextureTexels,
    maxColorDimension: profile.colorMax,
    maxDataDimension: profile.dataMax,
    minArtifactBytes: 1,
    maxArtifactBytes: profile.maxArtifactBytes,
  };
}

export function assertExpectedSourceHash(actual, config = ELDERBOOM_V1_CONFIG) {
  const normalized = String(actual ?? "").toUpperCase();
  if (normalized !== config.source.sha256) {
    throw new Error(`Village source hash mismatch: expected ${config.source.sha256}, received ${normalized || "empty"}`);
  }
  return true;
}

export { ENVIRONMENT_QUALITY_LEVELS };
