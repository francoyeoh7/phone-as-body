// Crafting: materials picked up around the map get combined at a crafting
// station into gear. Pure logic + recipe data.

export const RECIPES = Object.freeze([
  { id: "hammer", label: "锤子", materials: { stone: 2, wood: 2 } },
  { id: "stimulant", label: "亢奋剂", materials: { herb: 2, bottle: 1 } },
  { id: "trap", label: "捕兽夹", materials: { part: 2, wood: 2 } },
]);

export const MATERIAL_LABELS = Object.freeze({
  stone: "石头",
  wood: "木棍",
  herb: "药草",
  bottle: "玻璃瓶",
  part: "零件",
});

export function canCraft(state, playerId, recipeId) {
  const recipe = RECIPES.find((entry) => entry.id === recipeId);
  const player = state.players.find((entry) => entry.id === playerId);
  if (!recipe || !player) return false;
  return Object.entries(recipe.materials).every(([material, count]) => (player.materials[material] ?? 0) >= count);
}

export function craft(state, playerId, recipeId) {
  if (!canCraft(state, playerId, recipeId)) return { ok: false };
  const recipe = RECIPES.find((entry) => entry.id === recipeId);
  const player = state.players.find((entry) => entry.id === playerId);
  for (const [material, count] of Object.entries(recipe.materials)) {
    player.materials[material] -= count;
  }
  const item = { id: `${recipeId}#${player.items.length}`, label: recipe.label, crafted: true };
  player.items.push(item);
  return { ok: true, item };
}
