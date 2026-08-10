const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const ELDERBOOM_V1_CONFIG = deepFreeze({
  id: "elderboom-v1",
  source: {
    defaultPath: "D:\\3d资产\\ElderBoomHollow\\source\\elderbloom_hollow.glb",
    bytes: 936_886_692,
    sha256: "0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB",
  },
  selection: { bounds: { min: [-10, -2, 12], max: [25, 30, 48] } },
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
    cellSize: 4,
    maxInstancesPerMeshPerCell: 4,
  },
  outputs: {
    directory: "public/assets/environment/elderboom-v1/chunks",
    report: "public/assets/environment/elderboom-v1/build-report.json",
    manifest: "public/assets/environment/elderboom-v1/manifest.json",
  },
});

export function assertExpectedSourceHash(actual, config = ELDERBOOM_V1_CONFIG) {
  const normalized = String(actual ?? "").toUpperCase();
  if (normalized !== config.source.sha256) {
    throw new Error(`Village source hash mismatch: expected ${config.source.sha256}, received ${normalized || "empty"}`);
  }
  return true;
}
