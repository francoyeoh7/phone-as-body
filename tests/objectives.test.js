import { describe, expect, it } from "vitest";
import { createObjectiveState, OBJECTIVE_LABELS } from "../src/shared/objectives.js";

describe("objective progression", () => {
  it("starts by asking the player to find the fuse", () => {
    const story = createObjectiveState();
    expect(story.current()).toBe("find-fuse");
    expect(story.label()).toBe(OBJECTIVE_LABELS["find-fuse"]);
  });

  it("rejects out-of-order interactions without changing state", () => {
    const story = createObjectiveState();
    expect(story.dispatch("panel-used")).toMatchObject({ accepted: false, current: "find-fuse" });
    expect(story.dispatch("elevator-entered")).toMatchObject({ accepted: false, current: "find-fuse" });
    expect(story.current()).toBe("find-fuse");
  });

  it("advances through the secured exit-door sequence", () => {
    const story = createObjectiveState();
    expect(story.dispatch("fuse-collected")).toMatchObject({ accepted: true, next: "restore-power" });
    expect(story.dispatch("panel-used")).toMatchObject({ accepted: true, next: "reach-door" });
    expect(story.dispatch("door-defended")).toMatchObject({ accepted: true, next: "secured" });
    expect(story.current()).toBe("secured");
  });

  it("rejects elevator entry and does not expose elevator objective labels", () => {
    const story = createObjectiveState();
    expect(story.dispatch("elevator-entered")).toMatchObject({ accepted: false, current: "find-fuse" });
    expect(OBJECTIVE_LABELS).not.toHaveProperty("reach-elevator");
    expect(OBJECTIVE_LABELS).not.toHaveProperty("escaped");
  });

  it("is idempotent after an event has already advanced the story", () => {
    const story = createObjectiveState();
    story.dispatch("fuse-collected");
    expect(story.dispatch("fuse-collected")).toMatchObject({ accepted: false, reason: "out-of-order" });
  });

  it("serializes only deterministic secured story data", () => {
    const story = createObjectiveState();
    story.dispatch("fuse-collected");
    story.dispatch("panel-used");
    story.dispatch("door-defended");
    expect(story.serialize()).toEqual({
      current: "secured",
      hasFuse: true,
      powerRestored: true,
      secured: true,
    });
  });
});
