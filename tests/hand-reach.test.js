import { describe, expect, it } from "vitest";
import { createReachState, updateReachState } from "../src/shared/hand-reach.js";

function pose({ wristY = 0.8, palmY = 0.65, palmX = 0.5, coverage = 21 } = {}) {
  return {
    center: [palmX, palmY, 0],
    landmarks: Array.from({ length: 21 }, (_, index) => [
      index < coverage ? palmX : 1.2,
      index === 0 ? wristY : palmY,
      0,
    ]),
  };
}

describe("hand reach state", () => {
  it("acquires only after three lower-edge frames over 140ms", () => {
    let state = createReachState();
    let result = updateReachState(state, pose(), 0);
    state = result.state;
    expect(result).toMatchObject({ eligible: false, progress: expect.closeTo(1 / 3, 8), entered: false });

    result = updateReachState(state, pose(), 70);
    state = result.state;
    expect(result).toMatchObject({ eligible: false, progress: expect.closeTo(2 / 3, 8), entered: false });

    result = updateReachState(state, pose(), 140);
    expect(result).toMatchObject({ eligible: true, progress: 1, entered: true });
  });

  it("rejects upper-frame and insufficient-coverage poses from acquisition", () => {
    let result = updateReachState(createReachState(), pose({ wristY: 0.71 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });

    result = updateReachState(createReachState(), pose({ palmY: 0.49 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });

    result = updateReachState(createReachState(), pose({ coverage: 15 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });

    result = updateReachState(createReachState(), pose({ palmX: 0.04 }), 0);
    expect(result).toMatchObject({ eligible: false, progress: 0 });
  });

  it("keeps acquired reach through entry hysteresis but resets after the wrist exits the top for 120ms", () => {
    let state = createReachState();
    for (const now of [0, 70, 140]) state = updateReachState(state, pose(), now).state;

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
    for (const now of [0, 70, 140]) state = updateReachState(state, pose(), now).state;

    let result = updateReachState(state, pose({ palmX: 0.02 }), 180);
    expect(result.eligible).toBe(true);
    result = updateReachState(result.state, pose({ palmX: -0.01 }), 240);
    expect(result.eligible).toBe(true);
    result = updateReachState(result.state, pose({ palmX: -0.01 }), 360);
    expect(result.eligible).toBe(false);
  });
});
