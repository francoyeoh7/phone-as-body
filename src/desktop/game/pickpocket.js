// Pickpocket logic: crouched behind a target, press E, then 1 = coins, 2 = a
// random item. Pure logic over the elimination state; the renderer handles UI.

export const PICKPOCKET_COIN_AMOUNT = 50;

export function pickpocketCoins(state, thiefId, victimId) {
  const thief = state.players.find((p) => p.id === thiefId);
  const victim = state.players.find((p) => p.id === victimId);
  if (!thief?.alive || !victim?.alive) return { ok: false, reason: "dead" };
  if (thiefId === victimId) return { ok: false, reason: "self" };
  const amount = Math.min(PICKPOCKET_COIN_AMOUNT, victim.coins);
  if (amount <= 0) return { ok: false, reason: "empty" };
  victim.coins -= amount;
  thief.coins += amount;
  return { ok: true, kind: "coins", amount };
}

export function pickpocketItem(state, thiefId, victimId) {
  const thief = state.players.find((p) => p.id === thiefId);
  const victim = state.players.find((p) => p.id === victimId);
  if (!thief?.alive || !victim?.alive) return { ok: false, reason: "dead" };
  if (thiefId === victimId) return { ok: false, reason: "self" };
  if (victim.items.length === 0) return { ok: false, reason: "empty" };
  const index = Math.floor(state.random() * victim.items.length);
  const [item] = victim.items.splice(index, 1);
  thief.items.push(item);
  return { ok: true, kind: "item", item };
}

export function pickpocketOptions() {
  return [
    { key: "1", id: "coins", label: `偷金币（${PICKPOCKET_COIN_AMOUNT}）` },
    { key: "2", id: "item", label: "偷道具（随机一件）" },
  ];
}
