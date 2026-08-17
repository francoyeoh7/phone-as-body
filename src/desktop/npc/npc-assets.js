export const NPC_ASSETS = Object.freeze([
  Object.freeze({
    id: "mara",
    url: "/assets/npcs/models/mara-innkeeper.glb",
    position: [9.3, 0, -7.7],
    rotation: [0, 0, 0],
    facingYaw: 2.8,
    targetHeight: 1.72,
    // The downloaded Fab character has an oversized stylized head/cap in the
    // first-person village scale. Keep the readable authored fallback until a
    // standing, proportionate variant is available.
    forceFallback: true,
    // Fab's character is a standing profile; reject a loader pose that spreads
    // the body into a prone/depth-dominant shape instead of showing a broken NPC.
    maxDepthRatio: 0.78,
    animation: ["ArmatureIdle1", "Idle1", "ArmatureIdle2", "Idle2"],
  }),
  Object.freeze({
    id: "bram",
    url: "/assets/npcs/models/bram-blacksmith.glb",
    position: [-4.4, 0, 1.6],
    rotation: [0, 0, 0],
    facingYaw: 1.15,
    targetHeight: 1.78,
    // The Fab demo is the collapsed blue silhouette reported in the mobile
    // capture. Keep Bram on the same coherent authored fallback as the other
    // village roles until a standing variant is available.
    forceFallback: true,
    maxDepthRatio: 0.82,
    animation: [],
  }),
  Object.freeze({
    id: "elowen",
    url: "/assets/npcs/models/elowen-herbalist.glb",
    position: [1.25, 0, 12.45],
    rotation: [0, 0, 0],
    facingYaw: -2.6,
    targetHeight: 1.68,
    // The free demo's old-woman scene contains a kneeling/walker presentation;
    // keep it out of the first-person village path until a standing variant is available.
    maxDepthRatio: 0.62,
    animation: ["Scene"],
  }),
]);
