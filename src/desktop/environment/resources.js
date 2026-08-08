export const ENVIRONMENT_TEXTURE_SLOTS = Object.freeze([
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "lightMap",
  "specularIntensityMap",
  "specularColorMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "anisotropyMap",
  "envMap",
]);

function asRoots(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function collectEnvironmentResources(roots, { environmentTextures = [] } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set(environmentTextures.filter(Boolean));

  for (const root of asRoots(roots)) {
    root?.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const entries = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of entries) materials.add(material);
    });
  }

  for (const material of materials) {
    for (const slot of ENVIRONMENT_TEXTURE_SLOTS) {
      const texture = material?.[slot];
      if (texture?.isTexture) textures.add(texture);
    }
  }

  return { geometries, materials, textures };
}

export function disposeEnvironmentResources(roots, options) {
  const resources = collectEnvironmentResources(roots, options);
  for (const texture of resources.textures) texture.dispose?.();
  for (const material of resources.materials) material.dispose?.();
  for (const geometry of resources.geometries) geometry.dispose?.();
  return resources;
}
