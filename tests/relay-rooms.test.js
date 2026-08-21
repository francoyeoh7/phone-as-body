import { describe, expect, it } from "vitest";
import { createRoomRegistry } from "../relay/rooms.js";

describe("relay room registry", () => {
  it("registers and validates rooms by secret", () => {
    const registry = createRoomRegistry();
    expect(registry.register("123456", "abcdEFGH12345678", "desktop-1")).toBe(true);
    expect(registry.validate("123456", "abcdEFGH12345678")?.desktopSocketId).toBe("desktop-1");
    expect(registry.validate("123456", "wrong-secret-xx")).toBe(null);
    expect(registry.validate("654321", "abcdEFGH12345678")).toBe(null);
  });

  it("rejects malformed codes and weak secrets", () => {
    const registry = createRoomRegistry();
    expect(registry.register("12345", "abcdEFGH12345678", "d")).toBe(false);
    expect(registry.register("123456", "short", "d")).toBe(false);
    expect(registry.register("123456", 123456789012, "d")).toBe(false);
  });

  it("blocks a second desktop from stealing a live room code", () => {
    const registry = createRoomRegistry();
    registry.register("123456", "abcdEFGH12345678", "desktop-1");
    expect(registry.register("123456", "zzzzYYYY9999zzzz", "desktop-2")).toBe(false);
    expect(registry.register("123456", "abcdEFGH12345678", "desktop-2")).toBe(true);
  });

  it("attaches controllers up to the cap and detaches by socket", () => {
    const registry = createRoomRegistry({ maxControllers: 2 });
    registry.register("123456", "abcdEFGH12345678", "desktop-1");
    expect(registry.attach("123456", "phone-a")).toEqual({ ok: true, cid: "phone-a" });
    expect(registry.attach("123456", "phone-b")).toEqual({ ok: true, cid: "phone-b" });
    expect(registry.attach("123456", "phone-c")).toMatchObject({ ok: false, reason: "room-full" });
    expect(registry.detach("phone-a")).toEqual({ ok: true, code: "123456" });
    expect(registry.attach("123456", "phone-c")).toEqual({ ok: true, cid: "phone-c" });
    expect(registry.detach("phone-a")).toEqual({ ok: false });
  });

  it("sweeps rooms after the ttl", () => {
    let now = 1_000;
    const registry = createRoomRegistry({ now: () => now });
    registry.register("123456", "abcdEFGH12345678", "desktop-1");
    registry.markOrphan("123456");
    now += 59_999;
    expect(registry.sweep()).toEqual([]);
    now += 2;
    expect(registry.sweep()).toEqual(["123456"]);
    expect(registry.get("123456")).toBe(null);
  });
});
