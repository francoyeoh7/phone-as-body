import { describe, expect, it } from "vitest";
import {
  analyzeCallout,
  classifyFollowUp,
  containsExactAlias,
  normalizeTranscript,
} from "../src/shared/npc-cues.js";

describe("npc callout cues", () => {
  it("normalizes case, punctuation, and repeated whitespace", () => {
    expect(normalizeTranscript("  HEY，  Mara!! ")).toBe("hey mara");
  });

  it("uses word boundaries for Latin names", () => {
    expect(containsExactAlias("ward can you help", ["Ward"])).toBe(true);
    expect(containsExactAlias("walk toward the forge", ["Ward"])).toBe(false);
  });

  it("recognizes Chinese names without requiring spaces", () => {
    expect(containsExactAlias("玛拉你好我想问件事", ["玛拉"])).toBe(true);
  });

  it("reports named, greeting, request, and directed cues separately", () => {
    expect(analyzeCallout("你好玛拉，我想请你帮个忙", ["Mara", "玛拉"])).toMatchObject({
      named: true,
      greeting: true,
      request: true,
      directed: true,
    });
  });

  it.each(["没什么", "算了", "不是叫你", "never mind", "not talking to you"])(
    "makes cancellation phrase %s authoritative",
    (utterance) => {
      expect(classifyFollowUp(utterance, { confidence: 1 })).toMatchObject({ kind: "cancel" });
    },
  );

  it("distinguishes a clear purpose from a filler response", () => {
    expect(classifyFollowUp("我想问昨晚住店的陌生人", { confidence: 0.82 })).toMatchObject({ kind: "engage" });
    expect(classifyFollowUp("呃", { confidence: 0.82 })).toMatchObject({ kind: "ambiguous" });
    expect(classifyFollowUp("请帮我修这把钥匙", { confidence: 0.44 })).toMatchObject({ kind: "ambiguous" });
  });
});
