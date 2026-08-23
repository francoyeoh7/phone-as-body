# ElderBoom Hollow Local Asset Provenance

- Fab listing ID: `e12de9d5-be28-40df-a387-42ae6f84e05c`
- Local source: `D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb`
- Source byte length: `936886692`
- Source SHA-256: `0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB`
- Source generator: Unreal Engine `5.5.4`
- Deterministic extraction command: `npm run assets:village -- --source "D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb"`

Since 2026-08-22 the extractor retains the complete map (source bounds `x=-51..102`, `y=-1..30`, `z=-51..102`, shifted by `[-7.5, -1, -30]` at runtime) and keeps every foliage instance: no spatial pruning, no deterministic thinning, and no high-poly foliage exclusion. Mesh data, UVs, PBR assignments, and `KHR_materials_specular`, `KHR_materials_sheen`, `KHR_materials_anisotropy`, and `KHR_texture_transform` payloads are preserved. Repeated meshes are grouped with `EXT_mesh_gpu_instancing`, and large groups are additionally split into 16 m spatial tiles so the runtime can frustum-cull and distance-cull each tile independently.

The source GLB ships with Unreal material-instance placeholders that lost their texture bindings (magenta `baseColorFactor`/`emissiveFactor` debug materials): the landscape paint, several grass LOD variants, the water wall cards, and all `MI_BlackAlder_*_Field_*` leaf-card materials. The extractor deterministically repairs them by cloning the nearest textured sibling material of the same variant family (falling back to a dark leaf tone), so the runtime never ships a broken placeholder.

Quality is delivered as four deterministic texture tiers, one chunk per tier (`full-village-low`, `full-village-balanced`, `full-village-high`, `full-village-ultra`):

- `low` / `balanced` / `high`: embedded PNG textures are re-encoded as WebP with color/data dimension caps of 1024/512, 1536/768, and 2048/1024 respectively (runtime scale 0.8).
- `ultra`: original texture bytes and dimensions are copied byte-for-byte without re-encoding.

The desktop runtime defaults to `balanced` and lets the player switch tiers live from the controller settings menu. Geometry is identical in all tiers.

The complete 936 MB source GLB remains outside this repository and must never be staged, served, or bundled. The generated tier chunks are incorporated into the game and stored with Git LFS so a private clone remains runnable.

The project owner explicitly authorized acquisition, integration, public gameplay tunneling, and private GitHub storage of this asset on 2026-08-11. Fab's Standard License permits incorporating the asset into a project and sharing it through a private repository with project collaborators; it does not permit redistributing the asset on a standalone basis. This note records the owner's authorization and project-only use, but is not a substitute for the owner's Fab account records.

- Fab Standard License: https://www.fab.com/eula
