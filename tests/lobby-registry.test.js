import { describe, expect, it } from "vitest";
import { createLobbyRegistry } from "../relay/lobby.js";

function freshRegistry() {
  let counter = 100000;
  return createLobbyRegistry({ randomCode: () => String(counter += 7) });
}

describe("lobby registry", () => {
  it("creates a lobby with the host as first player", () => {
    const lobbies = freshRegistry();
    const created = lobbies.create("host-socket", "房主的电脑");
    expect(created.code).toMatch(/^\d{6}$/);
    const state = lobbies.stateOf(created.code);
    expect(state.players).toEqual([
      { socketId: "host-socket", name: "房主的电脑", isHost: true },
    ]);
    expect(state.state).toBe("lobby");
  });

  it("lets desktops join by code and tracks the roster", () => {
    const lobbies = freshRegistry();
    const { code } = lobbies.create("host-socket", "A");
    expect(lobbies.join(code, "b-socket", "B")).toEqual({ ok: true });
    expect(lobbies.join(code, "c-socket", "C")).toEqual({ ok: true });
    const state = lobbies.stateOf(code);
    expect(state.players.map((player) => player.name)).toEqual(["A", "B", "C"]);
    expect(state.players.filter((player) => player.isHost)).toHaveLength(1);
  });

  it("rejects joins for unknown codes, full lobbies and double joins", () => {
    const lobbies = createLobbyRegistry({ randomCode: () => "100001", maxDesktops: 2 });
    const { code } = lobbies.create("host-socket", "A");
    expect(lobbies.join("999999", "b-socket", "B")).toMatchObject({ ok: false, reason: "lobby-not-found" });
    expect(lobbies.join(code, "b-socket", "B").ok).toBe(true);
    expect(lobbies.join(code, "c-socket", "C")).toMatchObject({ ok: false, reason: "lobby-full" });
    expect(lobbies.join(code, "b-socket", "B")).toMatchObject({ ok: false, reason: "already-joined" });
  });

  it("only the host can start the game", () => {
    const lobbies = freshRegistry();
    const { code } = lobbies.create("host-socket", "A");
    lobbies.join(code, "b-socket", "B");
    expect(lobbies.start(code, "b-socket")).toMatchObject({ ok: false, reason: "not-host" });
    expect(lobbies.start(code, "host-socket")).toEqual({ ok: true });
    expect(lobbies.stateOf(code).state).toBe("playing");
    expect(lobbies.join(code, "c-socket", "C")).toMatchObject({ ok: false, reason: "already-playing" });
  });

  it("removes players on leave and ends the lobby when the host leaves", () => {
    const lobbies = freshRegistry();
    const { code } = lobbies.create("host-socket", "A");
    lobbies.join(code, "b-socket", "B");

    expect(lobbies.leave("b-socket")).toEqual({ ok: true, code, ended: false });
    expect(lobbies.stateOf(code).players.map((player) => player.name)).toEqual(["A"]);

    expect(lobbies.leave("host-socket")).toEqual({ ok: true, code, ended: true });
    expect(lobbies.stateOf(code)).toBe(null);
  });

  it("ignores leaves from sockets outside any lobby", () => {
    const lobbies = freshRegistry();
    expect(lobbies.leave("nobody")).toEqual({ ok: false });
  });
});
