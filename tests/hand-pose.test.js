import { describe, expect, it } from "vitest";
import {
  HAND_LANDMARK_COUNT,
  createHandStatusFrame,
  createTrackedHandFrame,
  deriveHandFeatures,
  normalizeHandedness,
  normalizeMediaPipeHandedness,
  normalizeCameraLandmarks,
} from "../src/shared/hand-pose.js";
import {
  MEDIAPIPE_HAND_LANDMARKS,
  curledHand,
  openHand,
} from "./fixtures/hand-landmarks.js";

const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const length = (value) => Math.hypot(...value);
const pointDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
const palmSpan = (sample) => (
  pointDistance(sample.landmarks[0], sample.landmarks[9])
  + pointDistance(sample.landmarks[5], sample.landmarks[17])
) / 2;

describe("hand pose features", () => {
  it("uses the MediaPipe 21-landmark order", () => {
    expect(HAND_LANDMARK_COUNT).toBe(21);
    expect(MEDIAPIPE_HAND_LANDMARKS).toMatchObject({
      wrist: 0,
      thumbTip: 4,
      indexMcp: 5,
      indexTip: 8,
      middleMcp: 9,
      middleTip: 12,
      ringMcp: 13,
      ringTip: 16,
      pinkyMcp: 17,
      pinkyTip: 20,
    });
  });

  it("preserves the original single-argument handedness primitive", () => {
    expect(normalizeHandedness.length).toBe(1);
    expect(normalizeHandedness("Left")).toBe("left");
    expect(normalizeHandedness("RIGHT")).toBe("right");
    expect(normalizeHandedness("unknown")).toBeNull();
    expect(normalizeHandedness(null)).toBeNull();
  });

  it("normalizes raw MediaPipe labels through an explicit input mirror helper", () => {
    expect(normalizeMediaPipeHandedness("Left", false)).toBe("right");
    expect(normalizeMediaPipeHandedness("RIGHT", false)).toBe("left");
    expect(normalizeMediaPipeHandedness("Left", true)).toBe("left");
    expect(normalizeMediaPipeHandedness("RIGHT", true)).toBe("right");
    expect(normalizeMediaPipeHandedness("unknown", false)).toBeNull();
    expect(normalizeMediaPipeHandedness(null, true)).toBeNull();
    expect(() => normalizeMediaPipeHandedness("Left")).toThrow(/inputMirrored/);
    expect(() => normalizeMediaPipeHandedness("Left", "false")).toThrow(/inputMirrored/);
  });

  it("separates a naturally open hand from a fist", () => {
    const open = deriveHandFeatures(openHand());
    const fist = deriveHandFeatures(curledHand());

    expect(open.openness).toBeGreaterThan(0.72);
    expect(open.grabStrength).toBeLessThan(0.42);
    expect(fist.openness).toBeLessThan(0.38);
    expect(fist.grabStrength).toBeGreaterThan(0.68);
    expect(open.curls).toHaveLength(5);
    expect(fist.curls).toHaveLength(5);
  });

  it("normalizes a 90-degree camera frame before pose derivation", () => {
    const [rotated] = normalizeCameraLandmarks([{ x: 0.2, y: 0.8, z: -0.1 }], 90);
    expect(rotated).toMatchObject({ z: -0.1 });
    expect(rotated.x).toBeCloseTo(0.2, 8);
    expect(rotated.y).toBeCloseTo(0.2, 8);
  });

  it("derives pinch strength from thumb/index distance and carries canonical reach fields", () => {
    const pinched = openHand();
    pinched.landmarks[8] = { ...pinched.landmarks[4] };
    const pose = deriveHandFeatures(pinched);
    const open = deriveHandFeatures(openHand());
    const frame = createTrackedHandFrame({ seq: 1, capturedAt: 100, modeEpoch: 1, sample: pinched });

    expect(pose.pinchStrength).toBeGreaterThan(0.95);
    expect(pose.grabStrength).toBeGreaterThan(open.grabStrength);
    expect(pose.palmSpan).toBeGreaterThan(0);
    expect(Number.isFinite(pose.depth)).toBe(true);
    expect(frame).toMatchObject({ pinchStrength: expect.any(Number), reachEligible: false, reachProgress: 0 });
  });

  it("bounds every score for in-frame and out-of-frame poses", () => {
    for (const pose of [deriveHandFeatures(openHand()), deriveHandFeatures(openHand({ translate: [0.8, 0, 0] }))]) {
      const scores = [
        pose.handConfidence,
        pose.trackingConfidence,
        pose.openness,
        pose.grabStrength,
        pose.palmFacing,
        ...pose.curls,
      ];
      expect(scores.every((score) => Number.isFinite(score) && score >= 0 && score <= 1)).toBe(true);
    }
  });

  it.each([
    { physicalHandedness: "Right", unmirroredRaw: "Left", mirroredRaw: "Right", expected: "right" },
    { physicalHandedness: "Left", unmirroredRaw: "Right", mirroredRaw: "Left", expected: "left" },
  ])("keeps a physical $expected palm equivalent across raw input conventions", ({
    physicalHandedness,
    unmirroredRaw,
    mirroredRaw,
    expected,
  }) => {
    const unmirrored = deriveHandFeatures(openHand({
      physicalHandedness,
      rawHandedness: unmirroredRaw,
      inputMirrored: false,
    }));
    const mirrored = deriveHandFeatures(openHand({
      physicalHandedness,
      rawHandedness: mirroredRaw,
      inputMirrored: true,
    }));

    expect(unmirrored.handedness).toBe(expected);
    expect(mirrored.handedness).toBe(expected);
    for (const pose of [unmirrored, mirrored]) {
      const axes = [pose.wrist.right, pose.wrist.up, pose.wrist.forward];
      for (const axis of axes) {
        expect(axis).toHaveLength(3);
        expect(axis.every(Number.isFinite)).toBe(true);
        expect(length(axis)).toBeCloseTo(1, 8);
      }
      expect(dot(axes[0], axes[1])).toBeCloseTo(0, 8);
      expect(dot(axes[0], axes[2])).toBeCloseTo(0, 8);
      expect(dot(axes[1], axes[2])).toBeCloseTo(0, 8);
    }

    for (const axis of ["right", "up", "forward"]) {
      mirrored.wrist[axis].forEach((value, index) => {
        expect(value).toBeCloseTo(unmirrored.wrist[axis][index], 8);
      });
    }
    expect(mirrored.palmFacing).toBeCloseTo(unmirrored.palmFacing, 8);
  });

  it("rejects samples without an explicit boolean input mirror convention", () => {
    const missing = openHand();
    delete missing.inputMirrored;

    expect(() => deriveHandFeatures(missing)).toThrow(/inputMirrored/);
    expect(() => deriveHandFeatures(openHand({ inputMirrored: "false" }))).toThrow(/inputMirrored/);
  });

  it("derives velocity only from forward sender capture timestamps", () => {
    const previous = createTrackedHandFrame({
      seq: 1,
      capturedAt: 100,
      modeEpoch: 4,
      sample: openHand({ receivedAt: 50_000 }),
    });
    const moved = createTrackedHandFrame({
      seq: 2,
      capturedAt: 200,
      modeEpoch: 4,
      sample: openHand({ translate: [0.02, 0, 0], receivedAt: 5_000_000 }),
      previous,
    });
    const repeated = createTrackedHandFrame({
      seq: 3,
      capturedAt: 200,
      modeEpoch: 4,
      sample: openHand({ translate: [0.04, 0, 0] }),
      previous: moved,
    });
    const backwards = createTrackedHandFrame({
      seq: 4,
      capturedAt: 199,
      modeEpoch: 4,
      sample: openHand({ translate: [0.04, 0, 0] }),
      previous: moved,
    });

    expect(moved.velocity).toBeCloseTo(0.2, 8);
    expect(repeated.velocity).toBe(0);
    expect(backwards.velocity).toBe(0);
    expect(repeated.trackingConfidence).toBe(0);
    expect(backwards.trackingConfidence).toBe(0);
  });

  it("invalidates continuity when either sender capture timestamp is missing", () => {
    const missingPreviousTimestamp = openHand();
    delete missingPreviousTimestamp.capturedAt;
    const previous = deriveHandFeatures(missingPreviousTimestamp);
    const current = deriveHandFeatures(openHand({ capturedAt: 200 }), previous);

    const missingCurrentTimestamp = openHand();
    delete missingCurrentTimestamp.capturedAt;
    const missingCurrent = deriveHandFeatures(missingCurrentTimestamp, deriveHandFeatures(openHand()));

    expect(current.velocity).toBe(0);
    expect(current.trackingConfidence).toBe(0);
    expect(missingCurrent.velocity).toBe(0);
    expect(missingCurrent.trackingConfidence).toBe(0);
  });

  it("retains sender capture time when chaining direct derived poses", () => {
    const previous = deriveHandFeatures(openHand({ capturedAt: 100 }));
    const moved = deriveHandFeatures(
      openHand({ capturedAt: 200, translate: [0.02, 0, 0] }),
      previous,
    );

    expect(previous.capturedAt).toBe(100);
    expect(moved.capturedAt).toBe(200);
    expect(moved.velocity).toBeCloseTo(0.2, 8);
  });

  it("penalizes discontinuous scale, center, handedness, and boundary coverage", () => {
    const previous = createTrackedHandFrame({
      seq: 1,
      capturedAt: 100,
      modeEpoch: 1,
      sample: openHand(),
    });
    const stable = createTrackedHandFrame({
      seq: 2,
      capturedAt: 200,
      modeEpoch: 1,
      sample: openHand({ translate: [0.002, 0, 0] }),
      previous,
    });
    const discontinuous = createTrackedHandFrame({
      seq: 3,
      capturedAt: 200,
      modeEpoch: 1,
      sample: openHand({ physicalHandedness: "Left", translate: [0.8, 0, 0], scale: 1.7 }),
      previous,
    });

    expect(stable.trackingConfidence).toBeGreaterThan(0.8);
    expect(discontinuous.trackingConfidence).toBeLessThan(stable.trackingConfidence);
  });

  it("uses palm-span calibration without constraining relative scale to a score range", () => {
    const baselineSample = openHand();
    const baseline = deriveHandFeatures(baselineSample);
    const larger = deriveHandFeatures(openHand({ scale: 1.25 }), null, {
      palmSpan: palmSpan(baselineSample),
    });

    expect(baseline.relativeScale).toBe(1);
    expect(larger.relativeScale).toBeCloseTo(1.25, 8);
  });

  it("rejects finite geometry when derived feature arithmetic overflows", () => {
    expect(() => deriveHandFeatures(openHand({ scale: 1e303 }), null, {
      palmSpan: 1.000001e-6,
    })).toThrow(/finite/);
  });

  it("rejects missing, degenerate, and non-finite landmarks", () => {
    const extraCoordinate = openHand();
    extraCoordinate.landmarks[0] = [0.5, 0.82, 0, 1];

    expect(() => deriveHandFeatures({ landmarks: [] })).toThrow(/21/);
    expect(() => deriveHandFeatures({ ...openHand(), worldLandmarks: [] })).toThrow(/21/);
    expect(() => deriveHandFeatures(extraCoordinate)).toThrow(/three/);
    expect(() => deriveHandFeatures(openHand({ x: Number.NaN }))).toThrow(/finite/);
    expect(() => deriveHandFeatures(openHand({ degenerate: true }))).toThrow(/palm/);
    expect(() => deriveHandFeatures(openHand({ worldScale: 0.001 }))).toThrow(/palm/);
    expect(() => deriveHandFeatures(openHand({ rawHandedness: "Unknown" }))).toThrow(/handedness/);
  });

  it("creates a task-scoped tracked frame with no raw-media fields", () => {
    const frame = createTrackedHandFrame({
      seq: 3,
      capturedAt: 120,
      modeEpoch: 2,
      sample: openHand({
        image: { raw: true },
        video: { raw: true },
        pixels: [1, 2, 3],
        frame: { raw: true },
        blob: { raw: true },
        dataUrl: "data:image/png;base64,raw",
      }),
    });

    expect(frame).toMatchObject({
      version: 1,
      seq: 3,
      capturedAt: 120,
      modeEpoch: 2,
      state: "tracked",
      handedness: "right",
    });
    expect(frame.landmarks).toHaveLength(21);
    expect(frame.worldLandmarks).toHaveLength(21);
    for (const key of ["image", "video", "pixels", "frame", "blob", "dataUrl", "receivedAt"]) {
      expect(frame).not.toHaveProperty(key);
    }
  });

  it("creates bounded lost and unavailable frames while rejecting tracked status", () => {
    expect(createHandStatusFrame({
      seq: 7,
      capturedAt: 400,
      modeEpoch: 0,
      state: "lost",
      reason: "x".repeat(60),
    })).toEqual({
      version: 1,
      seq: 7,
      capturedAt: 400,
      modeEpoch: 0,
      state: "lost",
      reason: "x".repeat(48),
    });
    expect(createHandStatusFrame({
      seq: 8,
      capturedAt: 420,
      modeEpoch: 3,
      state: "unavailable",
    }).reason).toBe("unknown");
    expect(() => createHandStatusFrame({ state: "tracked" })).toThrow(/invalid hand state/);
  });
});
