import { describe, expect, it, vi } from "vitest";
import { createWashbasinState } from "../src/desktop/Washbasin.js";

describe("washbasin state", () => {
  it("starts off and emits every repeated toggle", () => {
    const changes = [];
    const basin = createWashbasinState({ onChange: (state) => changes.push(state) });

    expect(basin.running).toBe(false);
    expect(basin.toggle()).toBe(true);
    expect(basin.toggle()).toBe(false);
    expect(basin.toggle()).toBe(true);
    expect(changes).toEqual([{ running: true }, { running: false }, { running: true }]);
  });

  it("does not emit when setRunning keeps the current state", () => {
    const onChange = vi.fn();
    const basin = createWashbasinState({ onChange });

    basin.setRunning(false);
    basin.setRunning(true);
    basin.setRunning(true);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
