# ElderBoom Hollow Local Asset Provenance

- Fab listing ID: `e12de9d5-be28-40df-a387-42ae6f84e05c`
- Local source: `D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb`
- Source byte length: `936886692`
- Source SHA-256: `0DFDDCB9650C9EAAF22F488014F332109EF9966F90E12635F4B2C3B8A2A08ADB`
- Source generator: Unreal Engine `5.5.4`
- Deterministic extraction command: `npm run assets:village -- --source "D:\3d资产\ElderBoomHollow\source\elderbloom_hollow.glb"`

The extractor retains selected mesh data, UVs, PBR assignments, texture dimensions, and embedded image bytes. It omits sectors outside the selected western-core bounds and deterministically thins only repeated foliage before grouping compatible repeats with `EXT_mesh_gpu_instancing`. The runtime profile caps only repeated foliage, including one retained copy of each source mesh above 100,000 triangles; it does not decimate retained architecture or props and does not resize retained textures. The scripted knock-door house remains in the retained architecture set.

The complete 936 MB source GLB remains outside this repository and must never be staged, served, or bundled. The deterministic western-core subset is incorporated into the game and stored with Git LFS so a private clone remains runnable.

The project owner explicitly authorized acquisition, integration, public gameplay tunneling, and private GitHub storage of this asset on 2026-08-11. Fab's Standard License permits incorporating the asset into a project and sharing it through a private repository with project collaborators; it does not permit redistributing the asset on a standalone basis. This note records the owner's authorization and project-only use, but is not a substitute for the owner's Fab account records.

- Fab Standard License: https://www.fab.com/eula
