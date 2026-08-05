import { describe, expect, it, vi } from "vitest";
import { FoundPhoneDirector } from "../src/desktop/FoundPhoneDirector.js";

function createHarness({ foundPhone = { enabled: true, setHeld: vi.fn() }, handTracking = null } = {}) {
  const player = {
    beginCinematic: vi.fn(),
    endCinematic: vi.fn(),
  };
  const audio = { cue: vi.fn() };
  const sendControllerEvent = vi.fn();
  const experience = { objects: { foundPhone } };
  const director = new FoundPhoneDirector({ experience, player, audio, sendControllerEvent, handTracking });
  return { director, foundPhone, player, audio, sendControllerEvent };
}

describe("found phone director", () => {
  it("starts a retained phone inspection exactly once", () => {
    const { director, foundPhone, player, audio, sendControllerEvent } = createHarness();

    expect(director.handleInteraction("found-phone")).toBe(true);
    expect(director.isInspecting()).toBe(true);
    expect(player.beginCinematic).toHaveBeenCalledOnce();
    expect(foundPhone.setHeld).toHaveBeenCalledWith(true);
    expect(audio.cue).toHaveBeenCalledWith("phone-pickup");
    expect(sendControllerEvent).toHaveBeenCalledWith({
      type: "gesture-mode",
      mode: "presence",
      context: "found-phone",
      baseline: "retained",
    });
    expect(sendControllerEvent).toHaveBeenCalledWith({ type: "found-phone-ui", active: true });

    expect(director.handleInteraction("found-phone")).toBe(false);
    expect(player.beginCinematic).toHaveBeenCalledOnce();
    expect(foundPhone.setHeld).toHaveBeenCalledOnce();
    expect(audio.cue).toHaveBeenCalledOnce();
    expect(sendControllerEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects unrelated interactions and unavailable phone props", () => {
    const disabled = createHarness({ foundPhone: { enabled: false, setHeld: vi.fn() } });
    const missing = createHarness({ foundPhone: null });
    const available = createHarness();

    expect(available.director.handleInteraction("exit-door")).toBe(false);
    expect(disabled.director.handleInteraction("found-phone")).toBe(false);
    expect(missing.director.handleInteraction("found-phone")).toBe(false);
    expect(available.player.beginCinematic).not.toHaveBeenCalled();
    expect(disabled.player.beginCinematic).not.toHaveBeenCalled();
    expect(missing.player.beginCinematic).not.toHaveBeenCalled();
  });

  it("rejects an interaction when hand ownership is already held by another context", () => {
    const handTracking = {
      beginTask: vi.fn(() => false),
      usesFallback: vi.fn(() => false),
      snapshot: vi.fn(() => null),
      endTask: vi.fn(),
    };
    const { director, foundPhone, player, audio, sendControllerEvent } = createHarness({ handTracking });

    expect(director.handleInteraction("found-phone")).toBe(false);
    expect(director.isInspecting()).toBe(false);
    expect(handTracking.beginTask).toHaveBeenCalledOnce();
    expect(handTracking.endTask).not.toHaveBeenCalled();
    expect(player.beginCinematic).not.toHaveBeenCalled();
    expect(foundPhone.setHeld).not.toHaveBeenCalled();
    expect(audio.cue).not.toHaveBeenCalled();
    expect(sendControllerEvent).not.toHaveBeenCalled();
  });

  it("releases only on the first matching ready inactive presence sample", () => {
    const { director, foundPhone, player, audio, sendControllerEvent } = createHarness();
    director.handleInteraction("found-phone");

    director.handlePresence({ context: "door-defense", ready: true, active: false });
    director.handlePresence({ context: "found-phone", ready: false, active: false });
    director.handlePresence({ context: "found-phone", ready: true, active: true });
    expect(director.isInspecting()).toBe(true);
    expect(player.endCinematic).not.toHaveBeenCalled();

    director.handlePresence({ context: "found-phone", ready: true, active: false });
    expect(director.isInspecting()).toBe(false);
    expect(foundPhone.setHeld).toHaveBeenLastCalledWith(false);
    expect(player.endCinematic).toHaveBeenCalledOnce();
    expect(audio.cue).toHaveBeenLastCalledWith("phone-release");
    expect(sendControllerEvent).toHaveBeenLastCalledWith({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });

    director.handlePresence({ context: "found-phone", ready: true, active: false });
    expect(player.endCinematic).toHaveBeenCalledOnce();
    expect(audio.cue).toHaveBeenCalledTimes(2);
    expect(sendControllerEvent).toHaveBeenCalledTimes(4);
    expect(director.handleInteraction("found-phone")).toBe(true);
  });

  it("returns the phone and exploration controls when presence never becomes ready", () => {
    const { director, foundPhone, player, audio, sendControllerEvent } = createHarness();
    director.handleInteraction("found-phone");

    director.update(2.999);
    expect(director.isInspecting()).toBe(true);
    expect(player.endCinematic).not.toHaveBeenCalled();

    director.update(0.001);

    expect(director.isInspecting()).toBe(false);
    expect(foundPhone.setHeld).toHaveBeenLastCalledWith(false);
    expect(player.endCinematic).toHaveBeenCalledOnce();
    expect(audio.cue).toHaveBeenLastCalledWith("phone-release");
    expect(sendControllerEvent).toHaveBeenLastCalledWith({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
  });

  it("does not time-limit reading after the first active presence state", () => {
    const { director, player } = createHarness();
    director.handleInteraction("found-phone");
    director.handlePresence({ context: "found-phone", ready: true, active: true });

    director.update(30);

    expect(director.isInspecting()).toBe(true);
    expect(player.endCinematic).not.toHaveBeenCalled();
  });

  it("destroy restores the initial controller and prop state once", () => {
    const { director, foundPhone, player, audio, sendControllerEvent } = createHarness();
    director.handleInteraction("found-phone");

    director.destroy();
    director.destroy();
    director.release();

    expect(director.isInspecting()).toBe(false);
    expect(foundPhone.setHeld).toHaveBeenLastCalledWith(false);
    expect(player.endCinematic).toHaveBeenCalledOnce();
    expect(audio.cue).toHaveBeenNthCalledWith(2, "phone-release");
    expect(audio.cue).toHaveBeenCalledTimes(2);
    expect(sendControllerEvent).toHaveBeenCalledTimes(4);
    expect(sendControllerEvent).toHaveBeenLastCalledWith({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
  });
});
