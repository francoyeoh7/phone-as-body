import { describe, expect, it } from "vitest";
import {
  alignMotionToGrip,
  blendVerticalMotion,
  gravityAlignedRoll,
  normalizeViewMotion,
  summarizePointMotion,
} from "../src/shared/view-motion.js";

function spatialGrid(columns = 6, rows = 6) {
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: 30 + (index % columns) * 18,
    y: 40 + Math.floor(index / columns) * 16,
  }));
}

function boundedSpatialGrid() {
  return Array.from({ length: 36 }, (_, index) => ({
    x: 8 + (index % 6) * 16,
    y: 6 + Math.floor(index / 6) * 12,
  }));
}

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : sorted[middle - 1] / 2 + sorted[middle] / 2;
}

function transformPoints(points, { dx = 0, dy = 0, scale = 1, rotation = 0 }) {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return points.map(({ x, y }) => ({
    x: dx + scale * (x * cosine - y * sine),
    y: dy + scale * (x * sine + y * cosine),
  }));
}

function expectFiniteSummary(summary) {
  const values = [summary.dx, summary.dy, summary.scale, summary.rotation, summary.confidence, summary.inliers];
  expect(values.every(Number.isFinite)).toBe(true);
  expect(summary.scale).toBeGreaterThanOrEqual(0);
  expect(summary.rotation).toBeGreaterThanOrEqual(-180);
  expect(summary.rotation).toBeLessThanOrEqual(180);
  expect(summary.confidence).toBeGreaterThanOrEqual(0);
  expect(summary.confidence).toBeLessThanOrEqual(1);
  expect(summary.inliers).toBeGreaterThanOrEqual(0);
}

function expectBoundedMotion(motion) {
  expect([motion.x, motion.y, motion.confidence].every(Number.isFinite)).toBe(true);
  expect(motion.x).toBeGreaterThanOrEqual(-1);
  expect(motion.x).toBeLessThanOrEqual(1);
  expect(motion.y).toBeGreaterThanOrEqual(-1);
  expect(motion.y).toBeLessThanOrEqual(1);
  expect(motion.confidence).toBeGreaterThanOrEqual(0);
  expect(motion.confidence).toBeLessThanOrEqual(1);
}

describe("view motion math", () => {
  it("exports the public motion helpers", () => {
    expect(summarizePointMotion).toBeTypeOf("function");
    expect(alignMotionToGrip).toBeTypeOf("function");
    expect(gravityAlignedRoll).toBeTypeOf("function");
    expect(blendVerticalMotion).toBeTypeOf("function");
    expect(normalizeViewMotion).toBeTypeOf("function");
  });

  it("recovers robust grid translation despite gross track outliers", () => {
    const previous = spatialGrid();
    const current = transformPoints(previous, { dx: -3, dy: 2 });
    previous.push(
      { x: 20, y: 20 },
      { x: 160, y: 30 },
      { x: 50, y: 150 },
      { x: 170, y: 160 },
    );
    current.push(
      { x: 900, y: -400 },
      { x: -700, y: 800 },
      { x: 1200, y: 900 },
      { x: -500, y: -600 },
    );

    const summary = summarizePointMotion(previous, current);

    expect(summary.dx).toBeCloseTo(-3, 6);
    expect(summary.dy).toBeCloseTo(2, 6);
    expect(summary.scale).toBeCloseTo(1, 6);
    expect(summary.rotation).toBeCloseTo(0, 6);
    expect(summary.confidence).toBeGreaterThan(0.75);
    expect(summary.inliers).toBe(36);
    expectFiniteSummary(summary);
  });

  it("estimates scale and rotation from a similarity transform", () => {
    const previous = spatialGrid();
    const current = transformPoints(previous, { dx: 11, dy: -8, scale: 1.04, rotation: 4 });
    const expectedDx = medianOf(current.map((point, index) => point.x - previous[index].x));
    const expectedDy = medianOf(current.map((point, index) => point.y - previous[index].y));

    const summary = summarizePointMotion(previous, current);

    expect(summary.dx).toBeCloseTo(expectedDx, 5);
    expect(summary.dy).toBeCloseTo(expectedDy, 5);
    expect(summary.scale).toBeCloseTo(1.04, 5);
    expect(summary.rotation).toBeCloseTo(4, 5);
    expect(summary.confidence).toBeGreaterThan(0.9);
    expect(summary.inliers).toBe(36);
    expectFiniteSummary(summary);
  });

  it("rejects scrambled correspondences that do not fit one similarity transform", () => {
    const previous = boundedSpatialGrid();
    const current = previous.map((_, index) => previous[(index * 13 + 7) % previous.length]);

    const summary = summarizePointMotion(previous, current);

    expect(summary.confidence).toBeLessThan(0.45);
    expect(summary.dx).toBe(0);
    expect(summary.dy).toBe(0);
    expectFiniteSummary(summary);
  });

  it("returns neutral motion when finite coordinates overflow similarity fitting", () => {
    const previous = [
      { x: 1e305, y: 0 },
      { x: -1e305, y: 0 },
      { x: 0, y: 1e305 },
      { x: 0, y: -1e305 },
      { x: 1e305, y: 1e305 },
      { x: -1e305, y: -1e305 },
    ];
    const current = previous.map(({ x, y }) => ({ x: x + 1e305, y }));

    expect(summarizePointMotion(previous, current)).toEqual({
      dx: 0,
      dy: 0,
      scale: 1,
      rotation: 0,
      confidence: 0,
      inliers: 0,
    });
  });

  it("returns neutral motion when fewer than six valid pairs remain", () => {
    const neutral = { dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0, inliers: 0 };
    const previous = spatialGrid(3, 2);
    const current = transformPoints(previous, { dx: 4, dy: -2 });
    previous[5] = { x: Number.NaN, y: 0 };

    expect(summarizePointMotion(previous, current)).toEqual(neutral);
    expect(summarizePointMotion(null, [])).toEqual(neutral);
  });

  it("returns neutral motion when outlier rejection leaves fewer than six inliers", () => {
    const previous = spatialGrid(3, 2);
    const current = transformPoints(previous, { dx: 4, dy: -2 });
    current[5] = { x: 1000, y: -1000 };

    expect(summarizePointMotion(previous, current)).toEqual({
      dx: 0,
      dy: 0,
      scale: 1,
      rotation: 0,
      confidence: 0,
      inliers: 0,
    });
  });

  it("ignores invalid pairs without allowing non-finite output", () => {
    const previous = spatialGrid(3, 2);
    const current = transformPoints(previous, { dx: 2, dy: -5 });
    previous.push(null, { x: Number.POSITIVE_INFINITY, y: 2 }, { x: 1, y: 1 });
    current.push({ x: 2, y: 2 }, { x: 4, y: 4 }, { x: Number.NaN, y: 1 });

    const summary = summarizePointMotion(previous, current);

    expect(summary.dx).toBeCloseTo(2, 6);
    expect(summary.dy).toBeCloseTo(-5, 6);
    expect(summary.inliers).toBe(6);
    expectFiniteSummary(summary);
  });

  it("assigns zero confidence to tightly clustered tracks", () => {
    const previous = Array.from({ length: 8 }, (_, index) => ({
      x: 100 + index * 0.00001,
      y: 80 + (index % 2) * 0.00001,
    }));
    const current = transformPoints(previous, { dx: -3, dy: 2, scale: 1.04, rotation: 4 });

    const summary = summarizePointMotion(previous, current);

    expect(summary.confidence).toBe(0);
    expectFiniteSummary(summary);
  });

  it("aligns image motion against grip roll", () => {
    expect(alignMotionToGrip({ x: 0.25, y: 1 }, 0)).toEqual({ x: 0.25, y: 1 });

    const clockwise = alignMotionToGrip({ x: 0, y: 1 }, 90);
    expect(clockwise.x).toBeCloseTo(1, 8);
    expect(clockwise.y).toBeCloseTo(0, 8);

    const counterClockwise = alignMotionToGrip({ x: 0, y: 1 }, -90);
    expect(counterClockwise.x).toBeCloseTo(-1, 8);
    expect(counterClockwise.y).toBeCloseTo(0, 8);
  });

  it("returns neutral alignment for invalid vector or roll input", () => {
    for (const [vector, roll] of [
      [null, 0],
      [{ x: Number.NaN, y: 1 }, 0],
      [{ x: 1, y: Number.POSITIVE_INFINITY }, 0],
      [{ x: 1, y: 1 }, Number.NaN],
    ]) {
      expect(alignMotionToGrip(vector, roll)).toEqual({ x: 0, y: 0 });
    }
  });

  it("derives roll from projected gravity when its magnitude is sufficient", () => {
    expect(gravityAlignedRoll({ x: 2, y: 2 }, 17)).toBeCloseTo(45, 8);
    expect(gravityAlignedRoll({ x: -3, y: 0 }, 17)).toBeCloseTo(-90, 8);
    expect(gravityAlignedRoll({ x: 0, y: -2 }, 17)).toBeCloseTo(180, 8);
  });

  it("falls back safely when projected gravity is weak or invalid", () => {
    expect(gravityAlignedRoll({ x: 1, y: 1 }, 17)).toBe(17);
    expect(gravityAlignedRoll({ x: Number.NaN, y: 3 }, -12)).toBe(-12);
    expect(gravityAlignedRoll(null, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("blends scale velocity into vertical image motion with clamped weight", () => {
    expect(blendVerticalMotion({ imageY: 0.25, scaleVelocity: 0.5, screenUpWeight: 0.4 })).toBeCloseTo(0.45, 8);
    expect(blendVerticalMotion({ imageY: 0.25, scaleVelocity: 0.5, screenUpWeight: -1 })).toBe(0.25);
    expect(blendVerticalMotion({ imageY: 0.25, scaleVelocity: 0.5, screenUpWeight: 2 })).toBe(0.75);
  });

  it("treats invalid vertical blend components as zero and stays finite", () => {
    expect(blendVerticalMotion({ imageY: Number.NaN, scaleVelocity: 2, screenUpWeight: 0.5 })).toBe(1);
    expect(blendVerticalMotion({ imageY: 3, scaleVelocity: Number.NaN, screenUpWeight: 0.5 })).toBe(3);
    expect(blendVerticalMotion({ imageY: 3, scaleVelocity: 2, screenUpWeight: Number.NaN })).toBe(3);
    expect(blendVerticalMotion(null)).toBe(0);
    expect(Number.isFinite(blendVerticalMotion({
      imageY: Number.MAX_VALUE,
      scaleVelocity: Number.MAX_VALUE,
      screenUpWeight: 1,
    }))).toBe(true);
  });

  it("gates motion below minimum confidence while preserving clamped confidence", () => {
    expect(normalizeViewMotion({ x: 1, y: -1, confidence: 0.44 })).toEqual({
      x: 0,
      y: 0,
      confidence: 0.44,
    });
    expect(normalizeViewMotion({ x: 1, y: 1, confidence: -2 })).toEqual({
      x: 0,
      y: 0,
      confidence: 0,
    });
  });

  it("applies a symmetric dead zone and rescales each component", () => {
    expect(normalizeViewMotion({ x: 0.1, y: 0, confidence: 0.45 })).toEqual({
      x: 0,
      y: 0,
      confidence: 0.45,
    });
    expect(normalizeViewMotion({ x: -0.1, y: 0, confidence: 1 })).toEqual({
      x: 0,
      y: 0,
      confidence: 1,
    });
    const positive = normalizeViewMotion({ x: 0.75, y: 0, confidence: 2 });
    const negative = normalizeViewMotion({ x: -0.75, y: 0, confidence: 1 });
    expect(positive).toMatchObject({ y: 0, confidence: 1 });
    expect(negative).toMatchObject({ y: 0, confidence: 1 });
    expect(positive.x).toBeCloseTo(0.5, 8);
    expect(negative.x).toBeCloseTo(-0.5, 8);
    expect(normalizeViewMotion({ x: 0.75, y: 0, confidence: 0.45 }).x).toBeCloseTo(0.5, 8);
  });

  it("saturates each component independently at full speed", () => {
    const positive = normalizeViewMotion({ x: 10, y: 0, confidence: 1 });
    const negative = normalizeViewMotion({ x: -10, y: 0, confidence: 1 });
    const diagonal = normalizeViewMotion({ x: 2, y: -2, confidence: 1 });

    expect(positive).toEqual({ x: 1, y: 0, confidence: 1 });
    expect(negative).toEqual({ x: -1, y: 0, confidence: 1 });
    expect(diagonal).toEqual({ x: 1, y: -1, confidence: 1 });
    expectBoundedMotion(positive);
    expectBoundedMotion(negative);
    expectBoundedMotion(diagonal);
  });

  it("keeps a sub-dead-zone component neutral when the other axis is active", () => {
    const result = normalizeViewMotion({ x: 1, y: 0.05, confidence: 1 });

    expect(result.x).toBeCloseTo(9 / 13, 8);
    expect(result.y).toBe(0);
    expect(result.confidence).toBe(1);
  });

  it("supports finite custom normalization thresholds", () => {
    const accepted = normalizeViewMotion(
      { x: 0.6, y: 0, confidence: 0.8 },
      { deadZone: 0.2, fullSpeed: 1, minimumConfidence: 0.7 },
    );
    expect(accepted).toMatchObject({ y: 0, confidence: 0.8 });
    expect(accepted.x).toBeCloseTo(0.5, 8);
    expect(normalizeViewMotion(
      { x: 0.6, y: 0, confidence: 0.69 },
      { deadZone: 0.2, fullSpeed: 1, minimumConfidence: 0.7 },
    )).toEqual({ x: 0, y: 0, confidence: 0.69 });
  });

  it("falls back safely for invalid samples and normalization configuration", () => {
    const neutral = { x: 0, y: 0, confidence: 0 };
    expect(normalizeViewMotion(null)).toEqual(neutral);
    expect(normalizeViewMotion({ x: Number.NaN, y: 0, confidence: 1 })).toEqual(neutral);
    expect(normalizeViewMotion({ x: 0, y: Number.POSITIVE_INFINITY, confidence: 1 })).toEqual(neutral);
    expect(normalizeViewMotion({ x: 0, y: 0, confidence: Number.NaN })).toEqual(neutral);

    const invalidNumbers = normalizeViewMotion(
      { x: 0.75, y: 0, confidence: 1 },
      { deadZone: Number.NaN, fullSpeed: Number.POSITIVE_INFINITY, minimumConfidence: Number.NaN },
    );
    const invalidRange = normalizeViewMotion(
      { x: 0.75, y: 0, confidence: 1 },
      { deadZone: -1, fullSpeed: 0, minimumConfidence: 3 },
    );
    const nullConfig = normalizeViewMotion({ x: 0.75, y: 0, confidence: 1 }, null);

    expect(invalidNumbers).toMatchObject({ y: 0, confidence: 1 });
    expect(invalidRange).toMatchObject({ y: 0, confidence: 1 });
    expect(nullConfig).toMatchObject({ y: 0, confidence: 1 });
    expect(invalidNumbers.x).toBeCloseTo(0.5, 8);
    expect(invalidRange.x).toBeCloseTo(0.5, 8);
    expect(nullConfig.x).toBeCloseTo(0.5, 8);
    expectBoundedMotion(invalidNumbers);
    expectBoundedMotion(invalidRange);
    expectBoundedMotion(nullConfig);
  });

  it("keeps extreme finite samples bounded and finite", () => {
    const result = normalizeViewMotion({
      x: Number.MAX_VALUE,
      y: -Number.MAX_VALUE,
      confidence: Number.MAX_VALUE,
    });

    expect(result).toEqual({ x: 1, y: -1, confidence: 1 });
    expectBoundedMotion(result);
  });
});
