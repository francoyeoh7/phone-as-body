import { describe, expect, it, vi } from "vitest";
import { BraceHaptics } from "../src/controller/BraceHaptics.js";

describe("brace haptics", () => {
  it("starts the brace pattern and cancels it deterministically", () => {
    const vibrate = vi.fn(() => true);
    const fallback = vi.fn();
    const setTimer = vi.fn(() => 7);
    const clearTimer = vi.fn();
    const haptics = new BraceHaptics({ vibrate, onFallbackPulse: fallback, setTimer, clearTimer });

    haptics.start();
    haptics.start();
    haptics.stop();

    expect(vibrate).toHaveBeenNthCalledWith(1, [55, 35, 90]);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    expect(setTimer).toHaveBeenCalledOnce();
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 220);
    expect(clearTimer).toHaveBeenCalledWith(7);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when vibration is unsupported", () => {
    const fallback = vi.fn();
    const haptics = new BraceHaptics({
      vibrate: vi.fn(() => false),
      onFallbackPulse: fallback,
      setTimer: vi.fn(() => 7),
      clearTimer: vi.fn(),
    });

    haptics.start();

    expect(fallback).toHaveBeenCalledOnce();
  });

  it("falls back and still stops when the vibration implementation throws", () => {
    const fallback = vi.fn();
    const vibrate = vi.fn(() => { throw new Error("vibration blocked"); });
    const haptics = new BraceHaptics({
      vibrate,
      onFallbackPulse: fallback,
      setTimer: vi.fn(() => 7),
      clearTimer: vi.fn(),
    });

    expect(() => haptics.start()).not.toThrow();
    expect(() => haptics.stop()).not.toThrow();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
