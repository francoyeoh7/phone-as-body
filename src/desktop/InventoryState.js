function immutableCopy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) copy[key] = immutableCopy(child, seen);
  return Object.freeze(copy);
}

export class InventoryState {
  constructor(items = []) {
    this.catalog = new Map();
    for (const item of items) {
      if (!item || typeof item.id !== "string" || !item.id || this.catalog.has(item.id)) continue;
      this.catalog.set(item.id, immutableCopy({ ...item, enabled: item.enabled !== false }));
    }
    this.acquired = new Set();
    this.consumed = new Set();
    this.equippedId = null;
    this.hoveredId = null;
  }

  acquire(id) {
    if (!this.catalog.has(id) || this.consumed.has(id) || this.acquired.has(id)) return false;
    this.acquired.add(id);
    return true;
  }

  equip(id) {
    const item = this.catalog.get(id);
    if (!item || !item.enabled || !this.acquired.has(id) || this.consumed.has(id)) return false;
    this.equippedId = id;
    return true;
  }

  consume(id) {
    if (!this.catalog.has(id) || !this.acquired.has(id) || this.consumed.has(id)) return false;
    this.acquired.delete(id);
    this.consumed.add(id);
    if (this.equippedId === id) this.equippedId = null;
    if (this.hoveredId === id) this.hoveredId = null;
    return true;
  }

  setHovered(id) {
    if (id === null) {
      this.hoveredId = null;
      return true;
    }
    if (!this.catalog.has(id) || !this.acquired.has(id) || this.consumed.has(id)) return false;
    this.hoveredId = id;
    return true;
  }

  snapshot() {
    const items = [];
    for (const [id, item] of this.catalog) {
      if (this.acquired.has(id) && !this.consumed.has(id)) items.push(immutableCopy(item));
    }
    return Object.freeze({
      items: Object.freeze(items),
      equippedId: this.equippedId,
      hoveredId: this.hoveredId,
    });
  }
}
