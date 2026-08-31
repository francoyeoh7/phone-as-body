import { describe, expect, it } from "vitest";
import { BUMPS, TRACK_HALF, aiControl, bumpHit, chooseGrabTarget } from "../src/egg/race-logic.js";

function makeRacer(slot, overrides = {}) {
  return {
    slot,
    dist: 0,
    worldX: 0,
    renderX: 0,
    eggPos: { x: 0, y: 0 },
    finished: false,
    dropTimer: 0,
    ...overrides,
  };
}

describe("bumpHit", () => {
  const row = { d: 10, segments: [{ x: -2, w: 2 }, { x: 2, w: 2 }] };

  it("hits when the racer center crosses onto a bar", () => {
    expect(bumpHit(row, -2, 9.9, 10.1)).toBe(true);
    expect(bumpHit(row, 2.9, 9.9, 10.1)).toBe(true);
  });

  it("misses when the racer is in the gap", () => {
    expect(bumpHit(row, 0, 9.9, 10.1)).toBe(false);
    expect(bumpHit(row, -4.5, 9.9, 10.1)).toBe(false);
  });

  it("has no hidden margin beyond the visual bar", () => {
    expect(bumpHit(row, -3.1, 9.9, 10.1)).toBe(false);
    expect(bumpHit(row, -3.0, 9.9, 10.1)).toBe(false);
  });

  it("only triggers while crossing the bar distance", () => {
    expect(bumpHit(row, -2, 10.1, 10.4)).toBe(false);
    expect(bumpHit(row, -2, 8, 9)).toBe(false);
  });

  it("every bump row leaves a dodgeable gap", () => {
    for (const bumpRow of BUMPS) {
      const sorted = [...bumpRow.segments].sort((a, b) => a.x - b.x);
      let cursor = -TRACK_HALF;
      const gaps = [];
      for (const segment of sorted) {
        gaps.push(segment.x - segment.w / 2 - cursor);
        cursor = segment.x + segment.w / 2;
      }
      gaps.push(TRACK_HALF - cursor);
      expect(Math.max(...gaps)).toBeGreaterThan(1.2);
    }
  });
});

describe("chooseGrabTarget", () => {
  it("grabs the nearest racer in range", () => {
    const racers = new Map([
      [0, makeRacer(0, { dist: 10, renderX: 0 })],
      [1, makeRacer(1, { dist: 11, renderX: 1.2 })],
      [2, makeRacer(2, { dist: 12, renderX: 0.5 })],
    ]);
    expect(chooseGrabTarget(racers, 0)?.slot).toBe(2);
  });

  it("returns null when nobody is in range", () => {
    const racers = new Map([
      [0, makeRacer(0, { dist: 10, renderX: 0 })],
      [1, makeRacer(1, { dist: 20, renderX: 0 })],
    ]);
    expect(chooseGrabTarget(racers, 0)).toBeNull();
  });

  it("skips finished and dropping racers", () => {
    const racers = new Map([
      [0, makeRacer(0, { dist: 10, renderX: 0 })],
      [1, makeRacer(1, { dist: 10.5, renderX: 0.5, finished: true })],
      [2, makeRacer(2, { dist: 10.5, renderX: -0.5, dropTimer: 1 })],
    ]);
    expect(chooseGrabTarget(racers, 0)).toBeNull();
  });
});

describe("aiControl", () => {
  it("runs at a human-beatable pace with a centered egg", () => {
    const control = aiControl(makeRacer(4), BUMPS);
    expect(control.y).toBeGreaterThan(0.5);
    expect(control.y).toBeLessThanOrEqual(0.85);
  });

  it("eases off when the egg nears the rim", () => {
    const control = aiControl(makeRacer(4, { eggPos: { x: 0.45, y: 0 } }), BUMPS);
    expect(control.y).toBeLessThan(1);
  });

  it("steers away from a bump ahead", () => {
    const row = BUMPS[0];
    const segment = row.segments[0];
    const racer = makeRacer(4, { dist: row.d - 5, worldX: segment.x });
    const control = aiControl(racer, BUMPS);
    expect(Math.abs(control.x)).toBeGreaterThan(0.5);
  });

  it("steers back inside the track bounds", () => {
    const control = aiControl(makeRacer(4, { worldX: TRACK_HALF - 0.2 }), BUMPS);
    expect(control.x).toBe(-1);
  });
});
