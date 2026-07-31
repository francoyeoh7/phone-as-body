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

  it("advances through the complete escape sequence", () => {
    const story = createObjectiveState();
    expect(story.dispatch("fuse-collected")).toMatchObject({ accepted: true, next: "restore-power" });
    expect(story.dispatch("panel-used")).toMatchObject({ accepted: true, next: "reach-elevator" });
    expect(story.dispatch("elevator-entered")).toMatchObject({ accepted: true, next: "escaped" });
    expect(story.current()).toBe("escaped");
  });

  it("is idempotent after an event has already advanced the story", () => {
    const story = createObjectiveState();
    story.dispatch("fuse-collected");
    expect(story.dispatch("fuse-collected")).toMatchObject({ accepted: false, reason: "out-of-order" });
  });

  it("serializes only deterministic story data", () => {
    const story = createObjectiveState();
    story.dispatch("fuse-collected");
    expect(story.serialize()).toEqual({
      current: "restore-power",
      hasFuse: true,
      powerRestored: false,
      escaped: false,
    });
  });
});
