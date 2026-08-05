import { describe, expect, it } from "vitest";
import { HandPoseStream } from "../src/desktop/HandPoseStream.js";

const pose = (overrides = {}) => ({
  state: "tracked", seq: 1, modeEpoch: 0, receivedAt: 0, handedness: "right", handConfidence: 0.9,
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

  it("smooths nested landmarks and exposes low confidence without moving the stable render pose", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0, landmarks: [[0, 0, 0]], worldLandmarks: [[0, 0, 0]], curls: [0, 0, 0, 0, 0] }));
    stream.accept(pose({ seq: 2, receivedAt: 85, landmarks: [[1, 0, 0]], worldLandmarks: [[1, 0, 0]], curls: [1, 1, 1, 1, 1] }));
    expect(stream.sample(85).pose.landmarks[0][0]).toBeGreaterThan(0.5);
    expect(stream.sample(85).pose.curls[0]).toBeGreaterThan(0.5);
    const before = stream.sample(85).pose.center[0];
    stream.accept(pose({ seq: 3, receivedAt: 100, trackingConfidence: 0.61, center: [100, 0, 0] }));
    const low = stream.sample(100);
    expect(low).toMatchObject({ state: "low-confidence", fresh: false, trackingConfidence: 0.61 });
    expect(low.pose.center[0]).toBe(before);
  });

  it("freezes and fades, detects silence, handles explicit statuses, epochs, and handedness evidence", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0 }));
    expect(stream.sample(250).opacity).toBe(1);
    expect(stream.sample(600).opacity).toBeCloseTo(0, 8);
    expect(stream.sample(349).state).toBe("tracked");
    expect(stream.sample(350).state).toBe("lost");
    expect(stream.accept(pose({ seq: 2, receivedAt: 360, state: "lost" }))).toBe(true);
    expect(stream.sample(360).state).toBe("lost");
    expect(stream.accept(pose({ seq: 3, receivedAt: 370, state: "unavailable" }))).toBe(true);
    expect(stream.sample(370).state).toBe("unavailable");
    expect(stream.accept(pose({ seq: 1, modeEpoch: 1, receivedAt: 400, center: [10, 0, 0] }))).toBe(true);
    expect(stream.sample(400).pose.center[0]).toBe(10);
    expect(stream.accept(pose({ seq: 2, modeEpoch: 1, receivedAt: 500, handedness: "left" }))).toBe(true);
    expect(stream.sample(500).pose.handedness).toBe("right");
    expect(stream.accept(pose({ seq: 3, modeEpoch: 1, receivedAt: 999, handedness: "left" }))).toBe(true);
    expect(stream.sample(999).pose.handedness).toBe("right");
    expect(stream.accept(pose({ seq: 4, modeEpoch: 1, receivedAt: 1000, handedness: "left" }))).toBe(true);
    expect(stream.sample(1000).pose.handedness).toBe("left");
  });

  it("resets competing-handedness evidence when a stale sequence interrupts it", () => {
    const stream = new HandPoseStream();
    stream.accept(pose({ seq: 1, receivedAt: 0, handedness: "right" }));
    stream.accept(pose({ seq: 2, receivedAt: 100, handedness: "left" }));
    expect(stream.accept(pose({ seq: 2, receivedAt: 200, handedness: "left" }))).toBe(false);
    stream.accept(pose({ seq: 3, receivedAt: 600, handedness: "left" }));
    expect(stream.sample(600).pose.handedness).toBe("right");
    stream.accept(pose({ seq: 4, receivedAt: 1099, handedness: "left" }));
    expect(stream.sample(1099).pose.handedness).toBe("right");
    stream.accept(pose({ seq: 5, receivedAt: 1100, handedness: "left" }));
    expect(stream.sample(1100).pose.handedness).toBe("left");
  });
});
