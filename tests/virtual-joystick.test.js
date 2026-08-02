import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualJoystick } from "../src/controller/VirtualJoystick.js";

function createElement() {
  const listeners = new Map();
  const base = {
    classList: { add: vi.fn(), remove: vi.fn() },
    style: {},
  };
  const thumb = { style: {} };
  const captured = new Set();
  const element = {
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn(),
    querySelector: vi.fn((selector) => selector === ".joystick-base" ? base : thumb),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn((pointerId) => captured.add(pointerId)),
    hasPointerCapture: vi.fn((pointerId) => captured.has(pointerId)),
    releasePointerCapture: vi.fn((pointerId) => captured.delete(pointerId)),
    dispatch(type, values = {}) {
      listeners.get(type)?.({
        pointerId: 7,
        clientX: 100,
        clientY: 120,
        target: {},
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...values,
      });
    },
  };
  return { element, base, thumb };
}

function createGesture(options = {}) {
  const { element, base, thumb } = createElement();
  const onChange = vi.fn();
  const onEngagementChange = vi.fn();
  const onTap = vi.fn();
  let now = 0;
  const gesture = new VirtualJoystick(element, {
    onChange,
    onEngagementChange,
    onTap,
    clock: () => now,
    ...options,
  });
  const dispatch = (type, values = {}) => {
    now = values.now ?? now;
    element.dispatch(type, values);
  };
  return { element, base, thumb, onChange, onEngagementChange, onTap, dispatch, gesture };
}

describe("full-surface touch gesture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not engage the motion clutch for a short stationary tap", () => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { clientX: 140, clientY: 180, now: 0 });
    gesture.dispatch("pointerup", { clientX: 145, clientY: 184, now: 200 });

    expect(gesture.onEngagementChange).not.toHaveBeenCalledWith(true);
    expect(gesture.onTap).toHaveBeenCalledOnce();
    expect(gesture.onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    gesture.gesture.destroy();
  });

  it("classifies a drag once distance crosses the threshold", () => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { clientX: 140, clientY: 180, now: 0 });
    gesture.dispatch("pointermove", { clientX: 190, clientY: 140, now: 90 });
    gesture.dispatch("pointerup", { clientX: 190, clientY: 140, now: 140 });

    expect(gesture.onEngagementChange).toHaveBeenNthCalledWith(1, true);
    expect(gesture.onTap).not.toHaveBeenCalled();
    expect(gesture.onChange).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(gesture.onEngagementChange).toHaveBeenLastCalledWith(false);
    gesture.gesture.destroy();
  });

  it("cancels a tap after a second pointer joins", () => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { pointerId: 7, now: 0 });
    gesture.dispatch("pointerdown", { pointerId: 8, now: 30 });
    gesture.dispatch("pointerup", { pointerId: 7, now: 80 });

    expect(gesture.onTap).not.toHaveBeenCalled();
    expect(gesture.onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    gesture.gesture.destroy();
  });

  it("cancels a tap when the second pointer starts on an ignored control", () => {
    const gesture = createGesture({ onIgnoreTarget: (target) => target?.ignored === true });
    gesture.dispatch("pointerdown", { pointerId: 7, now: 0 });
    gesture.dispatch("pointerdown", { pointerId: 8, target: { ignored: true }, now: 30 });
    gesture.dispatch("pointerup", { pointerId: 7, now: 80 });

    expect(gesture.onTap).not.toHaveBeenCalled();
    gesture.gesture.destroy();
  });

  it.each(["pointercancel", "lostpointercapture"])("never turns %s into an interaction", (eventType) => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { now: 0 });
    gesture.dispatch(eventType, { now: 80 });

    expect(gesture.onTap).not.toHaveBeenCalled();
    expect(gesture.onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    gesture.gesture.destroy();
  });

  it("rejects a long stationary hold without sending interaction", () => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { now: 0 });
    gesture.dispatch("pointerup", { now: 241 });

    expect(gesture.onTap).not.toHaveBeenCalled();
    gesture.gesture.destroy();
  });

  it("engages view control after a stationary hold", () => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { now: 0 });

    vi.advanceTimersByTime(180);

    expect(gesture.onEngagementChange).toHaveBeenCalledWith(true);
    gesture.dispatch("pointerup", { now: 190 });
    expect(gesture.onTap).not.toHaveBeenCalled();
    expect(gesture.onEngagementChange).toHaveBeenLastCalledWith(false);
    gesture.gesture.destroy();
  });

  it("resets without tapping when the page becomes hidden", () => {
    const gesture = createGesture();
    gesture.dispatch("pointerdown", { now: 0 });
    document.hidden = true;
    gesture.gesture.handleVisibility();

    expect(gesture.onTap).not.toHaveBeenCalled();
    expect(gesture.onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    gesture.gesture.destroy();
  });
});
