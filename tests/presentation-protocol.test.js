import { describe, expect, it } from "vitest";
import { isControllerAction } from "../src/shared/protocol.js";

describe("presentation controller actions", () => {
  it("accepts only the bounded PPT open and navigation commands", () => {
    expect(isControllerAction({ action: "presentation-open", source: "settings", sentAt: 1 })).toBe(true);
    expect(isControllerAction({ action: "presentation-next", sentAt: 2 })).toBe(true);
    expect(isControllerAction({ action: "presentation-prev", sentAt: 3 })).toBe(true);
    expect(isControllerAction({ action: "presentation-close", sentAt: 4 })).toBe(true);
    expect(isControllerAction({ action: "presentation-open", source: "unknown", sentAt: 5 })).toBe(false);
    expect(isControllerAction({ action: "presentation-next", index: 8, sentAt: 6 })).toBe(false);
  });
});
