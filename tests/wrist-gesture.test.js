import { describe, expect, it, vi } from "vitest";
import { createWristGestureDetector } from "../src/shared/wrist-gesture.js";

function sampleTwist(detector, startTimeMs, twistRate) {
  const results = [0, 40, 80, 120].map((offset) =>
    detector.update({ timeMs: startTimeMs + offset, twistRate }),
  );
  results.push(detector.update({ timeMs: startTimeMs + 160, twistRate: 0 }));
  return results;
}

describe("wrist gesture detector", () => {
  it("does not interact after one fast twist expires", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    sampleTwist(detector, 0, 220);

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).not.toHaveBeenCalled();
    expect(detector.stage).toBe("first");

    expect(detector.update({ timeMs: 1100, twistRate: 0 })).toEqual({
      rotating: false,
      stage: "idle",
    });
    expect(onInteract).not.toHaveBeenCalled();
  });

  it("interacts once for two opposite valid twists inside the pair window", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    sampleTwist(detector, 0, 220);
    const secondTwist = sampleTwist(detector, 300, -220);

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).toHaveBeenCalledTimes(1);
    expect(secondTwist[3]).toEqual({ rotating: true, stage: "interact" });
    expect(secondTwist[4]).toEqual({ rotating: false, stage: "idle" });
    expect(detector.stage).toBe("idle");
  });

  it("does not interact for two same-direction twists", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    sampleTwist(detector, 0, 220);
    sampleTwist(detector, 300, 220);

    expect(onCandidate).toHaveBeenCalledTimes(2);
    expect(onInteract).not.toHaveBeenCalled();
    expect(detector.stage).toBe("first");
  });

  it("does not candidate for slow rotation even across a large total angle", () => {
    const onCandidate = vi.fn();
    const detector = createWristGestureDetector({ onCandidate });

    for (let timeMs = 0; timeMs <= 1200; timeMs += 40) {
      detector.update({ timeMs, twistRate: 160 });
    }

    expect(onCandidate).not.toHaveBeenCalled();
    expect(detector.stage).toBe("idle");
  });

  it("clears a started excursion when speed falls below the start threshold", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    detector.update({ timeMs: 0, twistRate: 220 });
    for (let timeMs = 40; timeMs <= 400; timeMs += 40) {
      detector.update({ timeMs, twistRate: 100 });
    }

    expect(onCandidate).not.toHaveBeenCalled();
    expect(onInteract).not.toHaveBeenCalled();
    expect(detector.stage).toBe("idle");
  });

  it("does not interact for an opposite candidate before minimum separation", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ minimumExcursion: 8, onCandidate, onInteract });

    detector.update({ timeMs: 0, twistRate: 220 });
    detector.update({ timeMs: 40, twistRate: 220 });
    detector.update({ timeMs: 50, twistRate: 0 });
    detector.update({ timeMs: 60, twistRate: -220 });
    detector.update({ timeMs: 100, twistRate: -220 });

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).not.toHaveBeenCalled();
    expect(detector.stage).toBe("first");
  });

  it("treats an opposite candidate after the pair window as a new first", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    sampleTwist(detector, 0, 220);
    sampleTwist(detector, 1100, -220);

    expect(onCandidate).toHaveBeenCalledTimes(2);
    expect(onInteract).not.toHaveBeenCalled();
    expect(detector.stage).toBe("first");
  });

  it("blocks a third and fourth rapid twist during cooldown", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    sampleTwist(detector, 0, 220);
    sampleTwist(detector, 300, -220);
    sampleTwist(detector, 600, 220);
    sampleTwist(detector, 900, -220);

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).toHaveBeenCalledTimes(1);
    expect(detector.stage).toBe("idle");
  });

  it("requires release at or below the release speed before another candidate", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    [0, 40, 80, 120].forEach((timeMs) => detector.update({ timeMs, twistRate: 220 }));
    [300, 340, 380, 420].forEach((timeMs) => detector.update({ timeMs, twistRate: -220 }));
    detector.update({ timeMs: 460, twistRate: 71 });
    [470, 480, 490].forEach((timeMs) => detector.update({ timeMs, twistRate: -220 }));

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).not.toHaveBeenCalled();

    detector.update({ timeMs: 500, twistRate: 70 });
    sampleTwist(detector, 540, -220);

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).toHaveBeenCalledTimes(1);
  });

  it("clears first-candidate state and timing on reset", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    sampleTwist(detector, 0, 220);
    detector.reset();
    sampleTwist(detector, 0, -220);

    expect(onCandidate).toHaveBeenCalledTimes(2);
    expect(onInteract).not.toHaveBeenCalled();
    expect(detector.stage).toBe("first");
  });

  it("ignores invalid and non-monotonic samples safely", () => {
    const onCandidate = vi.fn();
    const onInteract = vi.fn();
    const detector = createWristGestureDetector({ onCandidate, onInteract });

    for (const sample of [
      null,
      {},
      { timeMs: Number.NaN, twistRate: 220 },
      { timeMs: 0, twistRate: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => detector.update(sample)).not.toThrow();
      expect(detector.stage).toBe("idle");
    }

    detector.update({ timeMs: 100, twistRate: 220 });
    detector.update({ timeMs: 80, twistRate: -220 });
    detector.update({ timeMs: 140, twistRate: 220 });
    detector.update({ timeMs: 180, twistRate: 220 });
    detector.update({ timeMs: 220, twistRate: 220 });

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onInteract).not.toHaveBeenCalled();
  });

  it("restarts excursion when direction reverses before a candidate", () => {
    const onCandidate = vi.fn();
    const detector = createWristGestureDetector({ onCandidate });

    detector.update({ timeMs: 0, twistRate: 220 });
    detector.update({ timeMs: 40, twistRate: 220 });
    detector.update({ timeMs: 80, twistRate: 220 });
    detector.update({ timeMs: 120, twistRate: -220 });
    detector.update({ timeMs: 160, twistRate: -220 });
    detector.update({ timeMs: 200, twistRate: -220 });
    expect(onCandidate).not.toHaveBeenCalled();

    detector.update({ timeMs: 240, twistRate: -220 });
    expect(onCandidate).toHaveBeenCalledTimes(1);
  });

  it("clamps each integration interval to 50 milliseconds", () => {
    const onCandidate = vi.fn();
    const detector = createWristGestureDetector({ minimumExcursion: 20, onCandidate });

    detector.update({ timeMs: 0, twistRate: 220 });
    detector.update({ timeMs: 1000, twistRate: 220 });
    detector.update({ timeMs: 1040, twistRate: 220 });
    expect(onCandidate).not.toHaveBeenCalled();

    detector.update({ timeMs: 1041, twistRate: 220 });
    expect(onCandidate).toHaveBeenCalledTimes(1);
  });

  it("reports rotating at both signs of the inclusive threshold", () => {
    const detector = createWristGestureDetector();

    expect(detector.update({ timeMs: 0, twistRate: 54.999 })).toEqual({ rotating: false, stage: "idle" });
    expect(detector.update({ timeMs: 10, twistRate: 55 })).toEqual({ rotating: true, stage: "idle" });
    expect(detector.update({ timeMs: 20, twistRate: -55 })).toEqual({ rotating: true, stage: "idle" });
  });
});
