import { describe, expect, it } from "vitest";
import { shouldServeSpaShell } from "../server/spa-fallback.js";

describe("production SPA fallback", () => {
  it("serves extensionless game routes but never masks API or asset failures", () => {
    expect(shouldServeSpaShell({ method: "GET", path: "/controller" })).toBe(true);
    expect(shouldServeSpaShell({ method: "GET", path: "/ue-bridge/" })).toBe(true);
    expect(shouldServeSpaShell({ method: "GET", path: "/assets/app.js" })).toBe(false);
    expect(shouldServeSpaShell({ method: "GET", path: "/api/config" })).toBe(false);
    expect(shouldServeSpaShell({ method: "POST", path: "/controller" })).toBe(false);
  });
});
