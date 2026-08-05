import { describe, expect, it } from "vitest";
import { HAND_TASK_DEFAULTS, HandTaskStateMachine, scoreHandAction } from "../src/shared/hand-task-state.js";

const obs = (overrides = {}) => ({
  state: "tracked", fresh: true, trackingConfidence: 0.9, handConfidence: 0.9,
  pose: { openness: 0.9, palmFacing: 0.8, grabStrength: 0.1, curls: [0, 0, 0, 0, 0], velocity: 0 },
  ...overrides,
});

describe("hand action scoring", () => {
  it("keeps action scores distinct and maps each semantic action", () => {
    const pose = { openness: 0.8, palmFacing: 0.7, grabStrength: 0.3, curls: [0.1, 0.2, 0.3, 0.4, 0.5], velocity: 0.2 };
    expect(scoreHandAction("open", pose)).toBe(0.8);
    expect(scoreHandAction("fist", pose)).toBeCloseTo(0.3);
    expect(scoreHandAction("grab", pose)).toBe(0.3);
    expect(scoreHandAction("release", pose)).toBe(0.7);
    expect(scoreHandAction("brace", pose)).toBeCloseTo(0.7);
  });
});

describe("HandTaskStateMachine", () => {
  it("requires continuous tracking, calibration, candidate, confirmation, and hold", () => {
    const machine = new HandTaskStateMachine();
    machine.begin({ context: "door-defense", requiredAction: "grab", now: 0 });
    expect(machine.snapshot().phase).toBe("untracked");
    machine.update(obs(), 0);
    machine.update(obs(), 119);
    expect(machine.snapshot().phase).toBe("untracked");
    machine.update(obs(), 120);
    expect(machine.snapshot().phase).toBe("tracking");
    machine.update(obs(), 1019);
    expect(machine.snapshot().calibrated).toBe(false);
    machine.update(obs(), 1020);
    expect(machine.snapshot().calibrated).toBe(true);
    const grab = obs({ pose: { ...obs().pose, grabStrength: 0.9 } });
    machine.update(grab, 1020);
    machine.update(grab, 1239);
    expect(machine.snapshot().phase).toBe("tracking");
    machine.update(grab, 1240);
    expect(machine.snapshot().phase).toBe("candidate");
    machine.update(grab, 1241);
    expect(machine.snapshot().phase).toBe("confirmed");
    machine.update(grab, 1242);
    expect(machine.snapshot().phase).toBe("held");
  });

  it("requires the exact calibration and release boundaries", () => {
    expect(HAND_TASK_DEFAULTS).toMatchObject({ trackingMs: 120, calibrationMs: 900, candidateMs: 220, releaseMs: 180, lossGraceMs: 250 });
    const machine = new HandTaskStateMachine();
    machine.begin({ context: "found-phone", requiredAction: "grab", now: 0 });
    machine.update(obs(), 0);
    machine.update(obs(), 120);
    machine.update(obs(), 1019);
    expect(machine.snapshot().calibrationProgress).toBeLessThan(1);
    machine.update(obs(), 1020);
    expect(machine.snapshot().calibrated).toBe(true);
    const grab = obs({ pose: { ...obs().pose, grabStrength: 0.9 } });
    machine.update(grab, 1020); machine.update(grab, 1240); machine.update(grab, 1241); machine.update(grab, 1242);
    expect(machine.snapshot().phase).toBe("held");
    const release = obs({ pose: { ...obs().pose, grabStrength: 0.1 } });
    machine.update(release, 1243);
    machine.update(release, 1422);
    expect(machine.snapshot().phase).toBe("held");
    machine.update(release, 1423);
    expect(machine.snapshot().phase).toBe("success");
  });

  it("does not advance from a low confidence fresh frame and enters unstable only after grace", () => {
    const machine = new HandTaskStateMachine();
    machine.begin({ context: "door-defense", requiredAction: "grab", now: 0 });
    machine.update(obs(), 0);
    machine.update(obs(), 120); machine.update(obs(), 1020);
    const grab = obs({ pose: { ...obs().pose, grabStrength: 0.9 } });
    machine.update(grab, 1020); machine.update(grab, 1240); machine.update(grab, 1241); machine.update(grab, 1242);
    machine.update({ ...grab, trackingConfidence: 0.4 }, 1243);
    expect(machine.snapshot().phase).toBe("held");
    machine.update({ ...grab, trackingConfidence: 0.4 }, 1492);
    expect(machine.snapshot().phase).toBe("held");
    machine.update({ ...grab, trackingConfidence: 0.4 }, 1493);
    expect(machine.snapshot().phase).toBe("unstable");
  });

  it("keeps held through one sub-entry-confidence frame and the action-exit boundary", () => {
    const machine = new HandTaskStateMachine();
    machine.begin({ context: "door-defense", requiredAction: "grab", now: 0 });
    machine.update(obs(), 0); machine.update(obs(), 120); machine.update(obs(), 1020);
    const grab = obs({ pose: { ...obs().pose, grabStrength: 0.9 } });
    machine.update(grab, 1020); machine.update(grab, 1240); machine.update(grab, 1241); machine.update(grab, 1242);
    machine.update({ ...grab, trackingConfidence: 0.6, pose: { ...grab.pose, grabStrength: 0.55 } }, 1243);
    expect(machine.snapshot().phase).toBe("held");
  });

  it("exposes failed for a candidate interruption and never completes brace from release", () => {
    const machine = new HandTaskStateMachine();
    machine.begin({ context: "door-defense", requiredAction: "brace", now: 0 });
    machine.update(obs(), 0); machine.update(obs(), 120); machine.update(obs(), 1020);
    const brace = obs({ pose: { ...obs().pose, openness: 0.9, palmFacing: 0.9, velocity: 0 } });
    machine.update(brace, 1020); machine.update(brace, 1240);
    expect(machine.snapshot().phase).toBe("candidate");
    machine.update(obs({ pose: { ...obs().pose, openness: 0.1 } }), 1241);
    expect(machine.snapshot().phase).toBe("failed");
    machine.update(brace, 1242);
    expect(machine.snapshot().phase).toBe("tracking");
  });

  it("resets task-owned calibration and ownership", () => {
    const machine = new HandTaskStateMachine();
    machine.begin({ context: "x", requiredAction: "open", now: 0 });
    machine.update(obs(), 0);
    machine.update(obs(), 120); machine.update(obs(), 1020);
    machine.reset();
    expect(machine.snapshot()).toMatchObject({ context: null, requiredAction: null, phase: "untracked", calibrated: false, calibrationProgress: 0 });
  });
});
