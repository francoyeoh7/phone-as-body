export const NPC_ASSETS = Object.freeze([
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
