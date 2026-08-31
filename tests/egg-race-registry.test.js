import { describe, expect, it } from "vitest";
import { createEggRaceRegistry } from "../server/egg-race-registry.js";

function setup() {
  const registry = createEggRaceRegistry({ randomCode: () => 123456 });
  const { code } = registry.createHost("host-1");
  return { registry, code };
}

describe("egg race registry", () => {
  it("allocates a room for the host", () => {
    const { code } = setup();
    expect(code).toBe("123456");
  });

  it("assigns sequential slots to joining players", () => {
    const { registry, code } = setup();
    const first = registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    const second = registry.join(code, { key: "key-b", name: "B", socketId: "p-2" });
    const third = registry.join(code, { key: "key-c", name: "C", socketId: "p-3" });
    expect(first).toMatchObject({ ok: true, slot: 0 });
    expect(second).toMatchObject({ ok: true, slot: 1 });
    expect(third).toMatchObject({ ok: true, slot: 2 });
  });

  it("caps the room at three players", () => {
    const { registry, code } = setup();
    registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    registry.join(code, { key: "key-b", name: "B", socketId: "p-2" });
    registry.join(code, { key: "key-c", name: "C", socketId: "p-3" });
    const fourth = registry.join(code, { key: "key-d", name: "D", socketId: "p-4" });
    expect(fourth).toEqual({ ok: false, reason: "room-full" });
  });

  it("rejoins the same key on its original slot after a reconnect", () => {
    const { registry, code } = setup();
    registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    registry.disconnect("p-1");
    const rejoined = registry.join(code, { key: "key-a", name: "A", socketId: "p-1b" });
    expect(rejoined).toMatchObject({ ok: true, slot: 0 });
    expect(registry.socketFor(code, "key-a")).toBe("p-1b");
  });

  it("frees a slot for new players when a disconnected key never returns", () => {
    const { registry, code } = setup();
    registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    registry.disconnect("p-1");
    const newcomer = registry.join(code, { key: "key-b", name: "B", socketId: "p-2" });
    expect(newcomer).toMatchObject({ ok: true, slot: 0 });
  });

  it("never evicts connected players to make room", () => {
    const { registry, code } = setup();
    registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    registry.join(code, { key: "key-b", name: "B", socketId: "p-2" });
    registry.join(code, { key: "key-c", name: "C", socketId: "p-3" });
    expect(registry.join(code, { key: "key-d", name: "D", socketId: "p-4" }))
      .toEqual({ ok: false, reason: "room-full" });
    expect(registry.snapshotPlayers(registry.get(code))).toHaveLength(3);
  });

  it("marks the room gone when the host disconnects", () => {
    const { registry, code } = setup();
    registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    const result = registry.disconnect("host-1");
    expect(result).toMatchObject({ role: "host", code });
    expect(registry.get(code)).toBeNull();
    expect(registry.join(code, { key: "key-b", name: "B", socketId: "p-2" }))
      .toEqual({ ok: false, reason: "room-not-found" });
  });

  it("rejects unknown rooms", () => {
    const registry = createEggRaceRegistry();
    expect(registry.join("999999", { key: "key-a", name: "A", socketId: "p-1" }))
      .toEqual({ ok: false, reason: "room-not-found" });
  });

  it("reports connected state in snapshots", () => {
    const { registry, code } = setup();
    registry.join(code, { key: "key-a", name: "A", socketId: "p-1" });
    const before = registry.snapshotPlayers(registry.get(code));
    expect(before[0]).toMatchObject({ slot: 0, name: "A", connected: true });
    registry.disconnect("p-1");
    const after = registry.snapshotPlayers(registry.get(code));
    expect(after[0]).toMatchObject({ slot: 0, name: "A", connected: false });
  });
});
