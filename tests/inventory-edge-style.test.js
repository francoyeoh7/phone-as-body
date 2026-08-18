import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("inventory edge touch target", () => {
  it("keeps a usable right-edge strip on narrow and wide phones", () => {
    const styles = readFileSync(new URL("../src/controller/styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.inventory-edge\s*\{[^}]*width:\s*clamp\(32px,\s*8vw,\s*56px\)/s);
  });
});
