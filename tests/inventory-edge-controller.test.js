import { describe, expect, it, vi } from "vitest";
import { InventoryEdgeController } from "../src/controller/InventoryEdgeController.js";
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
    clearTimeout(id) { pending.delete(id); },
    advance(ms) { now += ms; },
    runDue() {
      for (const [id, timer] of [...pending.entries()].filter(([, item]) => item.due <= now)) {
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

function createElement(viewportWidth = 400) {
  const captured = new Set();
  return {
    getBoundingClientRect: () => ({ left: viewportWidth - 24, top: 0, width: 24, height: 800 }),
    setPointerCapture: vi.fn((id) => captured.add(id)),
    hasPointerCapture: vi.fn((id) => captured.has(id)),
    releasePointerCapture: vi.fn((id) => captured.delete(id)),
  };
}

function pointer(pointerId, x, y, currentTarget) {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function createEdge({ viewportWidth = 400, ...overrides } = {}) {
  const timers = createTimers();
  const ownership = new PointerOwnership();
  const element = createElement(viewportWidth);
  const callbacks = {
    onClaim: vi.fn(),
    onOpen: vi.fn(),
    onMove: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const controller = new InventoryEdgeController(element, {
    ownership,
    clock: timers.clock,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    viewport: () => ({ width: viewportWidth, height: 800 }),
    canOpen: () => true,
    ...callbacks,
  });
  return { controller, element, ownership, timers, callbacks };
}

describe("InventoryEdgeController", () => {
  it("claims a right-edge pointer but opens only after a qualifying left swipe", () => {
    const { controller, element, callbacks } = createEdge();
    const down = pointer(4, 390, 220, element);

    expect(controller.pointerDown(down)).toBe(true);
    expect(callbacks.onOpen).not.toHaveBeenCalled();
    controller.pointerMove(pointer(4, 345, 230, element));

    expect(callbacks.onOpen).toHaveBeenCalledExactlyOnceWith({ entryY: 0.275 });
    expect(callbacks.onMove).toHaveBeenCalledExactlyOnceWith({ dx: -45, dy: 10 });
  });

  it("does not open on a short, slow, or diagonal edge movement", () => {
    const short = createEdge();
    short.controller.pointerDown(pointer(1, 390, 200, short.element));
    short.controller.pointerMove(pointer(1, 350, 245, short.element));
    expect(short.callbacks.onOpen).not.toHaveBeenCalled();

    const slow = createEdge();
    slow.controller.pointerDown(pointer(2, 390, 200, slow.element));
    slow.timers.advance(261);
    slow.controller.pointerMove(pointer(2, 330, 200, slow.element));
    expect(slow.callbacks.onOpen).not.toHaveBeenCalled();

    const diagonal = createEdge();
    diagonal.controller.pointerDown(pointer(3, 390, 200, diagonal.element));
    diagonal.controller.pointerMove(pointer(3, 340, 270, diagonal.element));
    expect(diagonal.callbacks.onOpen).not.toHaveBeenCalled();
  });

  it("flushes deltas and commits only after an opened gesture", () => {
    const { controller, element, callbacks } = createEdge();
    controller.pointerDown(pointer(5, 390, 300, element));
    controller.pointerMove(pointer(5, 340, 300, element));
    controller.pointerUp(pointer(5, 320, 310, element));

    expect(callbacks.onMove).toHaveBeenLastCalledWith({ dx: -20, dy: 10 });
    expect(callbacks.onCommit).toHaveBeenCalledOnce();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("preserves the complete right-to-left travel when one event spans the whole edge", () => {
    const { controller, element, callbacks } = createEdge();

    controller.pointerDown(pointer(6, 390, 300, element));
    controller.pointerMove(pointer(6, 0, 300, element));

    const totalDx = callbacks.onMove.mock.calls.reduce((sum, [{ dx }]) => sum + dx, 0);
    expect(callbacks.onOpen).toHaveBeenCalledExactlyOnceWith({ entryY: 0.375 });
    expect(totalDx).toBe(-390);
    expect(callbacks.onMove.mock.calls.every(([delta]) => Math.abs(delta.dx) <= 96)).toBe(true);
  });

  it("keeps an active swipe alive when the browser reports lost pointer capture", () => {
    const { controller, element, callbacks } = createEdge();

    controller.pointerDown(pointer(7, 390, 300, element));
    controller.pointerMove(pointer(7, 330, 300, element));

    expect(controller.pointerCaptureLost(pointer(7, 330, 300, element))).toBe(true);
    controller.pointerMove(pointer(7, 120, 300, element));
    controller.pointerUp(pointer(7, 0, 300, element));

    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(callbacks.onCommit).toHaveBeenCalledOnce();
    expect(callbacks.onMove.mock.calls.reduce((sum, [{ dx }]) => sum + dx, 0)).toBe(-390);
  });

  it("maps a narrow phone's full right-to-left travel to the complete desktop cursor span", () => {
    const { controller, element, callbacks } = createEdge({ viewportWidth: 320 });

    controller.pointerDown(pointer(8, 310, 300, element));
    controller.pointerMove(pointer(8, 0, 300, element));

    expect(callbacks.onMove.mock.calls.reduce((sum, [{ dx }]) => sum + dx, 0)).toBe(-350);
  });
});
