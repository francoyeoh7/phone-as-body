import { describe, expect, it, vi } from "vitest";
import { InventoryOrbController } from "../src/controller/InventoryOrbController.js";
import { PointerOwnership } from "../src/controller/PointerOwnership.js";

function createTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    clock: () => now,
    setTimeout(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
    },
    runDue() {
      const due = [...pending.entries()]
        .filter(([, timer]) => timer.due <= now)
        .sort((left, right) => left[1].due - right[1].due);
      for (const [id, timer] of due) {
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

function createTarget(order = []) {
  const captured = new Set();
  return {
    style: { transform: "" },
    setPointerCapture: vi.fn((pointerId) => captured.add(pointerId)),
    hasPointerCapture: vi.fn((pointerId) => captured.has(pointerId)),
    releasePointerCapture: vi.fn((pointerId) => {
      captured.delete(pointerId);
      order.push("release");
    }),
  };
}

function pointer(pointerId, clientX, clientY, currentTarget) {
  return {
    pointerId,
    clientX,
    clientY,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function createOrb(overrides = {}) {
  const timers = createTimers();
  const ownership = new PointerOwnership();
  const order = [];
  const target = createTarget(order);
  const callbacks = {
    onClaim: vi.fn(() => order.push("claim")),
    onOpen: vi.fn(() => order.push("open")),
    onMove: vi.fn(() => order.push("move")),
    onCommit: vi.fn(() => order.push("commit")),
    onCancel: vi.fn(() => order.push("cancel")),
    onRelease: vi.fn(),
    ...overrides,
  };
  const orb = new InventoryOrbController(target, {
    ownership,
    clock: timers.clock,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    canOpen: () => true,
    ...callbacks,
  });
  return { orb, timers, ownership, order, target, callbacks };
}

describe("InventoryOrbController", () => {
  it("consumes pointer down, claims the modal, captures, and opens synchronously", () => {
    const { orb, ownership, order, target, callbacks } = createOrb({
      onOpen: vi.fn(() => {
        expect(ownership.inventoryModal).toBe(true);
        order.push("open");
      }),
    });
    const event = pointer(9, 350, 40, target);

    expect(orb.pointerDown(event)).toBe(true);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(target.setPointerCapture).toHaveBeenCalledWith(9);
    expect(callbacks.onClaim).toHaveBeenCalledWith({ gameplay: null, voice: null });
    expect(order).toEqual(["claim", "open"]);
  });

  it("coalesces relative pointer deltas to at most 30Hz and bounds each axis", () => {
    const { orb, timers, target, callbacks } = createOrb();
    orb.pointerDown(pointer(9, 350, 40, target));

    orb.pointerMove(pointer(9, 362, 46, target));
    orb.pointerMove(pointer(9, 470, -80, target));
    timers.advance(32);
    timers.runDue();
    expect(callbacks.onMove).not.toHaveBeenCalled();

    timers.advance(2);
    timers.runDue();
    expect(callbacks.onMove).toHaveBeenCalledExactlyOnceWith({ dx: 96, dy: -96 });

    orb.pointerMove(pointer(9, 475, -78, target));
    timers.advance(34);
    timers.runDue();
    expect(callbacks.onMove).toHaveBeenLastCalledWith({ dx: 5, dy: 2 });
  });

  it("flushes the final relative delta before commit, releases, and returns home", () => {
    const { orb, target, order, ownership, callbacks } = createOrb();
    orb.pointerDown(pointer(9, 350, 40, target));
    orb.pointerMove(pointer(9, 362, 46, target));
    expect(target.style.transform).toBe("translate3d(12px, 6px, 0)");

    orb.pointerUp(pointer(9, 365, 50, target));

    expect(callbacks.onMove).toHaveBeenCalledExactlyOnceWith({ dx: 15, dy: 10 });
    expect(order).toEqual(["claim", "open", "move", "commit", "release"]);
    expect(target.style.transform).toBe("translate3d(0, 0, 0)");
    expect(ownership.inventoryModal).toBe(false);
  });

  it("cancels without flushing or committing and safely ignores stale pointer events", () => {
    const { orb, target, order, ownership, callbacks } = createOrb();
    orb.pointerDown(pointer(9, 350, 40, target));
    orb.pointerMove(pointer(9, 362, 46, target));

    expect(orb.cancel()).toBe(true);

    expect(callbacks.onMove).not.toHaveBeenCalled();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(order).toEqual(["claim", "open", "cancel", "release"]);
    expect(target.style.transform).toBe("translate3d(0, 0, 0)");
    expect(ownership.inventoryModal).toBe(false);
    expect(orb.pointerUp(pointer(9, 362, 46, target))).toBe(false);
  });

  it("consumes rejected opens without claiming or opening", () => {
    const { orb, target, ownership, callbacks } = createOrb({ canOpen: () => false });
    const event = pointer(4, 20, 20, target);

    expect(orb.pointerDown(event)).toBe(false);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(ownership.inventoryModal).toBe(false);
    expect(callbacks.onClaim).not.toHaveBeenCalled();
    expect(callbacks.onOpen).not.toHaveBeenCalled();
  });
});
