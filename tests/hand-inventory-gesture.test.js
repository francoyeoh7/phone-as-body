import { describe, expect, it, vi } from "vitest";
import { HandInventoryGesture } from "../src/desktop/HandInventoryGesture.js";

function sample(x, y = 0.5, overrides = {}) {
  return {
    state: "tracked",
    fresh: true,
    pose: { center: [x, y, 0] },
    ...overrides,
  };
}

describe("HandInventoryGesture", () => {
  it("opens only after a fast, mostly-left swipe from the right edge", () => {
    const events = [];
    const gesture = new HandInventoryGesture({ onEvent: (event) => events.push(event) });

    gesture.update(sample(0.88, 0.25), 0, { canOpen: () => true, inventoryOpen: false });
    gesture.update(sample(0.80, 0.28), 300, { canOpen: () => true, inventoryOpen: false });
    expect(events).toEqual([]);

    gesture.update(sample(0.68, 0.28), 500, { canOpen: () => true, inventoryOpen: false });
    expect(events[0]).toMatchObject({ type: "open", entryY: 0.25 });
    expect(events[1]).toMatchObject({ type: "move" });
    expect(gesture.isCapturing()).toBe(true);
  });

  it("moves the inventory cursor and commits after a stable hover dwell", () => {
    const events = [];
    let hoveredId = null;
    const gesture = new HandInventoryGesture({
      onEvent: (event) => events.push(event),
      getHoveredId: () => hoveredId,
    });
    const context = { canOpen: () => true, inventoryOpen: false };

    gesture.update(sample(0.9, 0.5), 0, context);
    gesture.update(sample(0.68, 0.5), 180, context);
    context.inventoryOpen = true;
    hoveredId = "spare-fuse";
    gesture.update(sample(0.56, 0.5), 220, context);
    gesture.update(sample(0.56, 0.5), 499, context);
    expect(events.filter((event) => event.type === "commit")).toHaveLength(0);
    gesture.update(sample(0.56, 0.5), 500, context);

    expect(events.some((event) => event.type === "move")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "commit", id: "spare-fuse" });
    expect(gesture.isCapturing()).toBe(false);
  });

  it("cancels on a prolonged loss or a clear rightward escape without committing", () => {
    const onEvent = vi.fn();
    const gesture = new HandInventoryGesture({ onEvent, getHoveredId: () => "spare-fuse" });
    const context = { canOpen: () => true, inventoryOpen: false };
    gesture.update(sample(0.9), 0, context);
    gesture.update(sample(0.68), 160, context);
    context.inventoryOpen = true;
    gesture.update(sample(0.74), 200, context);
    expect(onEvent).toHaveBeenLastCalledWith({ type: "cancel", reason: "rightward" });

    gesture.update(sample(0.9), 300, { canOpen: () => true, inventoryOpen: false });
    gesture.update(sample(0.68), 450, { canOpen: () => true, inventoryOpen: false });
    const beforeLoss = onEvent.mock.calls.length;
    gesture.update({ state: "lost", fresh: false }, 600, { canOpen: () => true, inventoryOpen: true });
    expect(onEvent.mock.calls.length).toBe(beforeLoss);
    gesture.update({ state: "lost", fresh: false }, 900, { canOpen: () => true, inventoryOpen: true });
    expect(onEvent).toHaveBeenLastCalledWith({ type: "cancel", reason: "lost" });
  });
});
