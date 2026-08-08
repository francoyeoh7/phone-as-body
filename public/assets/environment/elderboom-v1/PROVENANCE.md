# ElderBoom Hollow Local Asset Provenance

- Fab listing ID: `e12de9d5-be28-40df-a387-42ae6f84e05c`
- Local source: `D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb`
- Source byte length: `936886692`
- Source SHA-256: `0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB`
- Source generator: Unreal Engine `5.5.4`
- Deterministic extraction command: `npm run assets:village -- --source "D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb"`

The extractor retains selected mesh data, UVs, PBR assignments, texture dimensions, and embedded image bytes. It omits sectors outside the selected western-core bounds and deterministically thins only repeated foliage before grouping compatible repeats with `EXT_mesh_gpu_instancing`. It does not decimate retained architecture or props and does not resize retained textures.

Generated GLB chunks and build reports are local-only working artifacts ignored by Git. The complete source GLB remains outside this repository and must never be staged, served, or bundled.

No license tier is asserted here because no entitlement record is archived in this workspace. Publishing, uploading, releasing, tunneling publicly, or otherwise distributing the generated subset requires both an archived account-entitlement record for the listing and explicit user authorization.
