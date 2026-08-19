Parallel work boundaries:

- npc_render_fix: src/desktop/npc/, public/assets/npcs/, NPC-focused tests; no scene, voice, or hand files.
- mobile_voice_activation: controller voice files, server NPC transcription bridge, voice/UI tests; no scene, NPC asset, or hand files.
- hand_extremes: shared hand pose, hand asset adapter, first-person hand mapping, hand-focused tests; no scene, NPC, or voice files.

Root owns village lighting, knock detector/director, DesktopApp integration, and final verification.
