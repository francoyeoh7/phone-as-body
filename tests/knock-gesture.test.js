import { describe, expect, it } from "vitest";
import { KnockGestureDetector } from "../src/desktop/KnockGestureDetector.js";

const sample = ({ time, depth = 0, velocity = 0, grabStrength = 0.86, openness = 0.16, curls = [0.86, 0.86, 0.86, 0.86, 0.86], relativeScale = 1, state = "tracked" } = {}) => ({
  state,
  fresh: true,
  receivedAt: time,
  pose: { depth, velocity, grabStrength, openness, curls, relativeScale, center: [0.5, 0.55, depth] },
  gesturePose: { depth, velocity, grabStrength, openness, curls, relativeScale, center: [0.5, 0.55, depth] },
});

describe("KnockGestureDetector", () => {
  it("requires two closed-hand forward impulses", () => {
    const detector = new KnockGestureDetector();
    expect(detector.update(sample({ time: 0, depth: 0 }), { focused: true, now: 0 })).toBe(false);
    expect(detector.update(sample({ time: 90, depth: -0.08, velocity: 1.2 }), { focused: true, now: 90 })).toBe(false);
    expect(detector.update(sample({ time: 220, depth: -0.01, velocity: 0.2 }), { focused: true, now: 220 })).toBe(false);
    expect(detector.update(sample({ time: 410, depth: -0.1, velocity: 1.25 }), { focused: true, now: 410 })).toBe(true);
  });

  it("recognizes the natural two-finger knock pose from the camera", () => {
    const detector = new KnockGestureDetector();
    const pose = { curls: [0.35, 0.24, 0.3, 0.82, 0.88], grabStrength: 0.58, openness: 0.56 };
    expect(detector.update(sample({ time: 0, depth: 0, ...pose }), { focused: true, now: 0 })).toBe(false);
    expect(detector.update(sample({ time: 100, depth: -0.035, velocity: 0.72, ...pose }), { focused: true, now: 100 })).toBe(false);
    expect(detector.update(sample({ time: 220, depth: -0.005, velocity: 0.2, ...pose }), { focused: true, now: 220 })).toBe(false);
    expect(detector.update(sample({ time: 420, depth: -0.04, velocity: 0.76, ...pose }), { focused: true, now: 420 })).toBe(true);
  });

  it("uses the raw gesture stream instead of the visually smoothed hand", () => {
    const detector = new KnockGestureDetector();
    const raw = { curls: [0.3, 0.2, 0.25, 0.84, 0.9], grabStrength: 0.55, openness: 0.58 };
    const frame = (time, depth, velocity) => {
      const tracked = sample({ time, depth, velocity, ...raw });
      tracked.pose = { ...tracked.pose, depth: 0, velocity: 0.08, curls: [0, 0, 0, 0, 0], openness: 1, grabStrength: 0 };
      return tracked;
    };
    expect(detector.update(frame(0, 0, 0), { focused: true, now: 0 })).toBe(false);
    expect(detector.update(frame(100, -0.04, 0.8), { focused: true, now: 100 })).toBe(false);
    expect(detector.update(frame(230, -0.005, 0.2), { focused: true, now: 230 })).toBe(false);
    expect(detector.update(frame(430, -0.045, 0.82), { focused: true, now: 430 })).toBe(true);
  });

  it("does not count an open hand, a single knock, or a slow movement", () => {
    const detector = new KnockGestureDetector();
    expect(detector.update(sample({ time: 0, depth: 0 }), { focused: true, now: 0 })).toBe(false);
    expect(detector.update(sample({ time: 100, depth: -0.1, velocity: 1.1, openness: 0.82, grabStrength: 0.08 }), { focused: true, now: 100 })).toBe(false);
    expect(detector.update(sample({ time: 800, depth: -0.2, velocity: 0.3 }), { focused: true, now: 800 })).toBe(false);
  });

  it("requires a release/rearm between impulses", () => {
    const detector = new KnockGestureDetector();
    detector.update(sample({ time: 0, depth: 0 }), { focused: true, now: 0 });
    detector.update(sample({ time: 100, depth: -0.1, velocity: 1.2 }), { focused: true, now: 100 });
    expect(detector.update(sample({ time: 220, depth: -0.2, velocity: 1.2 }), { focused: true, now: 220 })).toBe(false);
    expect(detector.update(sample({ time: 300, depth: -0.2, velocity: 0.1 }), { focused: true, now: 300 })).toBe(false);
    expect(detector.update(sample({ time: 420, depth: -0.3, velocity: 1.2 }), { focused: true, now: 420 })).toBe(true);
  });

  it("resets when focus is lost and enforces a cooldown after a pair", () => {
    const detector = new KnockGestureDetector({ cooldownMs: 900 });
    detector.update(sample({ time: 0, depth: 0 }), { focused: true, now: 0 });
    detector.update(sample({ time: 100, depth: -0.1, velocity: 1.2 }), { focused: true, now: 100 });
    detector.update(sample({ time: 220, depth: -0.01, velocity: 0.2 }), { focused: true, now: 220 });
    expect(detector.update(sample({ time: 400, depth: -0.1, velocity: 1.2 }), { focused: true, now: 400 })).toBe(true);
    detector.update(sample({ time: 520, depth: 0 }), { focused: false, now: 520 });
    expect(detector.update(sample({ time: 600, depth: -0.1, velocity: 1.2 }), { focused: true, now: 600 })).toBe(false);
  });
});
