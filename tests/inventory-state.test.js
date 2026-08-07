import { describe, expect, it } from "vitest";
import { InventoryState } from "../src/desktop/InventoryState.js";

describe("InventoryState", () => {
  it("starts empty and acquires only registered, unconsumed items", () => {
    const state = new InventoryState([
      { id: "spare-fuse", enabled: true },
      { id: "disabled-tool", enabled: false },
    ]);

    expect(state.snapshot()).toEqual({ items: [], equippedId: null, hoveredId: null });
    expect(state.acquire("missing")).toBe(false);
    expect(state.acquire("spare-fuse")).toBe(true);
    expect(state.acquire("spare-fuse")).toBe(false);
    expect(state.snapshot().items).toEqual([{ id: "spare-fuse", enabled: true }]);
  });

  it("equips only acquired enabled items and tracks acquired hover", () => {
    const state = new InventoryState([
      { id: "spare-fuse", enabled: true },
      { id: "disabled-tool", enabled: false },
    ]);
    state.acquire("spare-fuse");
    state.acquire("disabled-tool");

    expect(state.equip("missing")).toBe(false);
    expect(state.equip("disabled-tool")).toBe(false);
    expect(state.equip("spare-fuse")).toBe(true);
    expect(state.setHovered("disabled-tool")).toBe(true);
    expect(state.snapshot()).toMatchObject({ equippedId: "spare-fuse", hoveredId: "disabled-tool" });
    expect(state.setHovered("missing")).toBe(false);
    expect(state.setHovered(null)).toBe(true);
    expect(state.snapshot().hoveredId).toBeNull();
  });

  it("consumes possession once and clears matching equipment and hover", () => {
    const state = new InventoryState([{ id: "spare-fuse", enabled: true }]);
    state.acquire("spare-fuse");
    state.equip("spare-fuse");
    state.setHovered("spare-fuse");

    expect(state.consume("spare-fuse")).toBe(true);
    expect(state.snapshot()).toEqual({ items: [], equippedId: null, hoveredId: null });
    expect(state.acquire("spare-fuse")).toBe(false);
    expect(state.equip("spare-fuse")).toBe(false);
    expect(state.setHovered("spare-fuse")).toBe(false);
    expect(state.consume("spare-fuse")).toBe(false);
  });

  it("returns deeply immutable snapshots detached from catalog input", () => {
    const item = { id: "spare-fuse", enabled: true, metadata: { tags: ["power"] } };
    const state = new InventoryState([item]);
    state.acquire("spare-fuse");
    item.enabled = false;
    item.metadata.tags[0] = "changed";
    const snapshot = state.snapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0])).toBe(true);
    expect(Object.isFrozen(snapshot.items[0].metadata)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0].metadata.tags)).toBe(true);
    expect(snapshot.items[0]).toEqual({ id: "spare-fuse", enabled: true, metadata: { tags: ["power"] } });
    expect(() => snapshot.items.push({ id: "other", enabled: true })).toThrow(TypeError);
    expect(() => snapshot.items[0].metadata.tags.push("unsafe")).toThrow(TypeError);
    expect(state.snapshot().items).toEqual([
      { id: "spare-fuse", enabled: true, metadata: { tags: ["power"] } },
    ]);
  });
});
