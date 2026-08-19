# Village NPC Asset Provenance

Downloaded from Fab on 2026-08-10 through each listing's official anonymous **Download** flow after accepting the Fab End User License Agreement. All three listing dialogs identified the asset license as Creative Commons Attribution 4.0, the price as free, AI usage as allowed, and generated-with-AI as no.

## Mara, Innkeeper

- Source: [Free Animated Character with Suit](https://www.fab.com/listings/bf2bfa79-bc89-402b-b5e7-2c47f47c8401)
- Author: Marko J
- Local file: `models/mara-innkeeper.glb`
- Original converted file: `free_animated_boss_character.glb`
- Attribution: Character by Marko J, licensed under CC BY 4.0.

## Bram, Blacksmith

- Source: [Modular Humanoid Characters | Male (Free Demo)](https://www.fab.com/listings/9a94d6ab-d51e-43c1-b203-1ddf91879229?lang=en)
- Author: joaobaltieri
- Local file: `models/bram-blacksmith.glb`
- Original converted file: `modular_humanoid_characters_male_free_demo.glb`
- Attribution: Character by joaobaltieri, licensed under CC BY 4.0.

## Elowen, Herbalist

- Source: [Cartoon Old Woman](https://www.fab.com/listings/fd66628e-2b69-4293-be6c-f794b773d6a6)
- Author: Furkan Dogru
- Local file: `models/elowen-herbalist.glb`
- Original converted file: `cartoon_old_woman.glb`
- Attribution: Character by Furkan Dogru, licensed under CC BY 4.0.

The local filenames, byte counts, and SHA-256 digests are recorded in `manifest.json`. Runtime code adds role props, spatial audio anchors, look-at behavior, and procedural animation but does not redistribute the source files separately from this project.

## Runtime visual safety

The downloaded files remain intact for provenance, but the browser loader now applies a standing-profile gate before hiding the procedural fallback. The old-woman demo contains a depth-dominant walker pose in its free scene export, so it falls back to the coherent role model when that pose exceeds its configured depth ratio. This prevents a collapsed or sideways NPC from entering the first-person village view.
