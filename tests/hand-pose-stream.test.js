import { describe, expect, it } from "vitest";
import { basisQuaternion, HandPoseStream } from "../src/desktop/HandPoseStream.js";

const pose = (overrides = {}) => ({
  state: "tracked", seq: 1, modeEpoch: 0, receivedAt: 0, handedness: "left", handConfidence: 0.9,
  trackingConfidence: 0.9, landmarks: [[0, 0, 0]], worldLandmarks: [[0, 0, 0]], center: [0, 0, 0],
  wrist: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] }, curls: [0, 0, 0, 0, 0],
  openness: 0.9, grabStrength: 0.1, palmFacing: 0.9, relativeScale: 1, velocity: 0, ...overrides,
});

describe("HandPoseStream", () => {
  it("rejects stale sequence and sender-clock skew, and smooths only on receipt", () => {
    const stream = new HandPoseStream();
    expect(stream.accept(pose({ seq: 1, receivedAt: 10, capturedAt: 1_000_000 }))).toBe(true);
    expect(stream.accept(pose({ seq: 1, receivedAt: 11 }))).toBe(false);
    expect(stream.accept(pose({ seq: 2, receivedAt: 95, center: [1, 0, 0] }))).toBe(true);
    expect(stream.sample(100)).toMatchObject({ modeEpoch: 0, seq: 2 });
    expect(stream.sample(100).pose.center[0]).toBeGreaterThan(0);
    const repeated = stream.sample(10_000);
    expect(repeated.pose.center[0]).toBe(stream.sample(10_001).pose.center[0]);
  });

  it("smooths position and slerps wrist basis with identity and sign-equivalent quaternions", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0 }));
    stream.accept(pose({ seq: 2, receivedAt: 85, center: [1, 0, 0], wrist: { right: [0, 1, 0], up: [-1, 0, 0], forward: [0, 0, 1] } }));
    const sampled = stream.sample(85);
    expect(sampled.pose.center[0]).toBeGreaterThan(0.5);
    expect(sampled.pose.wristQuaternion).toHaveLength(4);
    stream.accept(pose({ seq: 3, receivedAt: 170, wristQuaternion: [0, 0, 0, -1] }));
    expect(stream.sample(170).pose.wristQuaternion[3]).toBeGreaterThan(0);
  });

  it("rejects right tracked frames without replacing the visual left pose", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0, center: [0.2, 0, 0] }));

    expect(stream.accept(pose({ seq: 2, receivedAt: 66, handedness: "right", center: [0.9, 0, 0] }))).toBe(false);
    expect(stream.sample(66).pose).toMatchObject({ handedness: "left", center: [0.2, 0, 0] });
  });

  it("renders wrist response within 180ms while retaining raw gesture strength", () => {
    const stream = new HandPoseStream({ wristTimeConstantMs: 60 });
    stream.accept(pose({ seq: 1, receivedAt: 0, center: [0, 0, 0], pinchStrength: 0.1 }));
    stream.accept(pose({ seq: 2, receivedAt: 180, center: [1, 0, 0], pinchStrength: 0.9 }));

    const sampled = stream.sample(180);
    expect(sampled.pose.center[0]).toBeGreaterThanOrEqual(0.9);
    expect(sampled.gesturePose.pinchStrength).toBe(0.9);
  });

  it("renders every structurally valid tracked frame regardless of confidence", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0, landmarks: [[0, 0, 0]], worldLandmarks: [[0, 0, 0]], curls: [0, 0, 0, 0, 0] }));
    stream.accept(pose({ seq: 2, receivedAt: 85, landmarks: [[1, 0, 0]], worldLandmarks: [[1, 0, 0]], curls: [1, 1, 1, 1, 1] }));
    expect(stream.sample(85).pose.landmarks[0][0]).toBeGreaterThan(0.5);
    expect(stream.sample(85).pose.curls[0]).toBeGreaterThan(0.5);
    const before = stream.sample(85).pose.center[0];
    stream.accept(pose({ seq: 3, receivedAt: 100, trackingConfidence: 0.25, center: [1, 0, 0] }));
    const low = stream.sample(100);
    expect(low).toMatchObject({ state: "tracked", fresh: true, trackingConfidence: 0.25, opacity: 1 });
    expect(low.pose.center[0]).toBeGreaterThan(before);
  });

  it("uses every accepted receive timestamp as the smoothing interval anchor", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0, center: [0, 0, 0] }));
    stream.accept(pose({ seq: 2, receivedAt: 100, trackingConfidence: 0.61, center: [0.5, 0, 0] }));
    stream.accept(pose({ seq: 3, receivedAt: 185, center: [1, 0, 0] }));
    const afterSecond = 0.5 * (1 - Math.exp(-100 / 68));
    const expected = afterSecond + (1 - afterSecond) * (1 - Math.exp(-85 / 60));
    expect(stream.sample(185).pose.center[0]).toBeCloseTo(expected, 6);
  });

  it("clears immediately on explicit loss and uses silence only as a transport watchdog", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0 }));
    expect(stream.sample(149)).toMatchObject({ state: "tracked", fresh: true, opacity: 1 });
    expect(stream.sample(150)).toMatchObject({ state: "lost", fresh: false, opacity: 0 });
    expect(stream.accept(pose({ seq: 2, receivedAt: 160, state: "lost" }))).toBe(true);
    expect(stream.sample(160)).toMatchObject({ state: "lost", opacity: 0 });
    expect(stream.accept(pose({ seq: 3, receivedAt: 170, state: "unavailable" }))).toBe(true);
    expect(stream.sample(170)).toMatchObject({ state: "unavailable", opacity: 0 });
    expect(stream.accept(pose({ seq: 1, modeEpoch: 1, receivedAt: 400, center: [10, 0, 0] }))).toBe(true);
    expect(stream.sample(400).pose.center[0]).toBe(10);
    expect(stream.sample(400).pose.handedness).toBe("left");
  });

  it("converts identity and quarter-turn wrist bases to canonical quaternions", () => {
    expect(basisQuaternion({ right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] })).toEqual([0, 0, 0, 1]);
    expect(basisQuaternion({ right: [0, 1, 0], up: [-1, 0, 0], forward: [0, 0, 1] })).toEqual([
      0, 0, expect.closeTo(Math.SQRT1_2, 6), expect.closeTo(Math.SQRT1_2, 6),
    ]);
  });
});
