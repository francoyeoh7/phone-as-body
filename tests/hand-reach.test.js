import { describe, expect, it } from "vitest";
import { createReachState, updateReachState } from "../src/shared/hand-reach.js";

function pose({ wristY = 0.8, palmY = 0.65, palmX = 0.4, palmSpan = 0.22, coverage = 21 } = {}) {
  return {
    center: [palmX, palmY, 0],
    palmSpan,
    landmarks: Array.from({ length: 21 }, (_, index) => [
      index < coverage ? palmX : 1.2,
      index === 0 ? wristY : palmY,
      0,
    ]),
  };
}

describe("hand reach state", () => {
  it("acquires only after three lower-left frames over 120ms", () => {
    let state = createReachState();
    let result = updateReachState(state, pose(), 0);
    state = result.state;
    expect(result).toMatchObject({ eligible: false, progress: expect.closeTo(1 / 3, 8), entered: false });

    result = updateReachState(state, pose(), 60);
    state = result.state;
    expect(result).toMatchObject({ eligible: false, progress: expect.closeTo(2 / 3, 8), entered: false });

    result = updateReachState(state, pose(), 120);
    expect(result).toMatchObject({ eligible: true, progress: 0, entered: true });
  });

  it("rejects upper-frame and insufficient-coverage poses from acquisition", () => {
    let result = updateReachState(createReachState(), pose({ wristY: 0.65 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });

    result = updateReachState(createReachState(), pose({ palmY: 0.51 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });

    result = updateReachState(createReachState(), pose({ coverage: 15 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });

    result = updateReachState(createReachState(), pose({ palmX: 0.56 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });
  });

  it("rejects a hand entering from the lower-right quadrant", () => {
    let state = createReachState();
    for (const now of [0, 60, 120]) state = updateReachState(state, pose({ palmX: 0.76 }), now).state;
    expect(state.acquired).toBe(false);
  });

  it("derives continuous reach from depth and vertical travel, not horizontal movement", () => {
    let state = createReachState();
    for (const now of [0, 60, 120]) state = updateReachState(state, pose(), now).state;

    const horizontal = updateReachState(state, pose({ palmX: 0.7 }), 160);
    const forward = updateReachState(horizontal.state, pose({ palmX: 0.7, palmSpan: 0.33, wristY: 0.62 }), 200);

    expect(horizontal).toMatchObject({ eligible: true, progress: 0 });
    expect(forward.progress).toBeGreaterThan(0.35);
    expect(forward.progress).toBeLessThanOrEqual(1);
  });

  it("keeps acquired reach through entry hysteresis but resets after the wrist exits the top for 120ms", () => {
    let state = createReachState();
    for (const now of [0, 60, 120]) state = updateReachState(state, pose(), now).state;

    let result = updateReachState(state, pose({ wristY: 0.4, palmY: 0.3 }), 180);
    state = result.state;
    expect(result).toMatchObject({ eligible: true, entered: false });

    result = updateReachState(state, pose({ wristY: 0.2, palmY: 0.3 }), 240);
    state = result.state;
    expect(result.eligible).toBe(true);
    result = updateReachState(state, pose({ wristY: 0.2, palmY: 0.3 }), 360);
    expect(result).toMatchObject({ eligible: false, progress: 0 });
  });

  it("uses a wider outer horizontal margin before resetting an acquired hand", () => {
    let state = createReachState();
    for (const now of [0, 60, 120]) state = updateReachState(state, pose(), now).state;

    let result = updateReachState(state, pose({ palmX: 0.02 }), 180);
    expect(result.eligible).toBe(true);
    result = updateReachState(result.state, pose({ palmX: -0.01 }), 240);
    expect(result.eligible).toBe(true);
    result = updateReachState(result.state, pose({ palmX: -0.01 }), 360);
    expect(result.eligible).toBe(false);
  });
});
