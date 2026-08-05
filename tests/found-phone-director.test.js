import { describe, expect, it, vi } from "vitest";
import { FoundPhoneDirector } from "../src/desktop/FoundPhoneDirector.js";

function createHarness() {
  let handState = { phase: "tracking", fresh: true };
  const handTracking = {
    beginTask: vi.fn(() => true),
    snapshot: vi.fn(() => handState),
    endTask: vi.fn(),
  };
  const foundPhone = { enabled: true, setHeld: vi.fn() };
  const player = { beginCinematic: vi.fn(), endCinematic: vi.fn() };
  const audio = { cue: vi.fn() };
  const sendControllerEvent = vi.fn();
  const director = new FoundPhoneDirector({
    experience: { objects: { foundPhone } }, player, audio, sendControllerEvent, handTracking,
  });
  return {
    director, foundPhone, player, audio, sendControllerEvent, handTracking,
    setHandState: (state) => { handState = state; },
  };
}

describe("found phone director", () => {
  it("accepts only a globally confirmed hand grab", () => {
    const { director, player, handTracking } = createHarness();

    expect(director.handleInteraction("found-phone", { source: "touch" })).toBe(false);
    expect(director.handleInteraction("found-phone", { source: "keyboard" })).toBe(false);
    expect(director.handleInteraction("found-phone", { source: "hand" })).toBe(true);
    expect(handTracking.beginTask).toHaveBeenCalledExactlyOnceWith({
      context: "found-phone", requiredAction: "grab", preCalibrated: true,
    });
    expect(player.beginCinematic).toHaveBeenCalledOnce();
  });

  it("does not show the held phone or UI before the state machine reaches held", () => {
    const { director, foundPhone, sendControllerEvent, setHandState } = createHarness();
    director.handleInteraction("found-phone", { source: "hand" });

    director.update(0.1);
    expect(foundPhone.setHeld).not.toHaveBeenCalled();
    expect(sendControllerEvent).not.toHaveBeenCalled();

    setHandState({ phase: "held", fresh: true });
    director.update(0.1);
    director.update(0.1);
    expect(foundPhone.setHeld).toHaveBeenCalledExactlyOnceWith(true);
    expect(sendControllerEvent).toHaveBeenCalledExactlyOnceWith({ type: "found-phone-ui", active: true });
  });

  it("drops immediately on confirmed release and blocks another pickup for three seconds", () => {
    const { director, foundPhone, player, handTracking, sendControllerEvent, setHandState } = createHarness();
    director.handleInteraction("found-phone", { source: "hand" });
    setHandState({ phase: "held", fresh: true });
    director.update(0.1);
    setHandState({ phase: "success", fresh: true });
    director.update(0.01);

    expect(director.isInspecting()).toBe(false);
    expect(foundPhone.setHeld).toHaveBeenLastCalledWith(false);
    expect(player.endCinematic).toHaveBeenCalledOnce();
    expect(handTracking.endTask).toHaveBeenCalledExactlyOnceWith("found-phone");
    expect(sendControllerEvent).toHaveBeenLastCalledWith({ type: "found-phone-ui", active: false });
    expect(director.handleInteraction("found-phone", { source: "hand" })).toBe(false);

    director.update(2.999);
    expect(director.handleInteraction("found-phone", { source: "hand" })).toBe(false);
    director.update(0.001);
    expect(director.handleInteraction("found-phone", { source: "hand" })).toBe(true);
  });

  it("drops immediately when sustained grab becomes unstable and never accepts presence fallback", () => {
    const { director, foundPhone, player, sendControllerEvent, setHandState } = createHarness();
    director.handleInteraction("found-phone", { source: "hand" });
    setHandState({ phase: "held", fresh: true });
    director.update(0.1);
    setHandState({ phase: "unstable", fresh: false });
    director.update(0.01);

    expect(foundPhone.setHeld).toHaveBeenLastCalledWith(false);
    expect(player.endCinematic).toHaveBeenCalledOnce();
    expect(sendControllerEvent).toHaveBeenLastCalledWith({ type: "found-phone-ui", active: false });
    expect(director.handlePresence({ context: "found-phone", ready: true, active: true })).toBe(false);
  });
});
