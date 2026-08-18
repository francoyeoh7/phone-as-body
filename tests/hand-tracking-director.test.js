import { describe, expect, it, vi } from "vitest";
import { HandTrackingDirector } from "../src/desktop/HandTrackingDirector.js";
import { PhoneSession } from "../src/desktop/PhoneSession.js";

function frame(overrides = {}) {
  return {
    modeEpoch: 1,
    seq: 0,
    state: "tracked",
    trackingConfidence: 0.95,
    handConfidence: 0.95,
    handedness: "left",
    reachEligible: true,
    openness: 0.9,
    palmFacing: 0.9,
    grabStrength: 0.9,
    velocity: 0,
    ...overrides,
  };
}

describe("HandTrackingDirector", () => {
  it("gives a tracked right-edge swipe priority over equipment and emits a dwell commit", () => {
    let now = 0;
    let inventoryOpen = false;
    let hoveredId = null;
    const events = [];
    const samples = [
      { state: "tracked", fresh: true, pose: { center: [0.9, 0.5, 0] } },
      { state: "tracked", fresh: true, pose: { center: [0.68, 0.5, 0] } },
      { state: "tracked", fresh: true, pose: { center: [0.56, 0.5, 0] } },
    ];
    const stream = { sample: vi.fn(() => samples[Math.min(stream.index++, samples.length - 1)]), index: 0 };
    const equipmentGate = { update: vi.fn(() => "grab"), suppressUntilRelease: vi.fn(), reset: vi.fn() };
    const hand = { fallback: false, setHolding: vi.fn(), setVisible: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const director = new HandTrackingDirector({
      hand,
      stream,
      equipmentGate,
      getEquippedId: () => "spare-fuse",
      canPresentEquipment: () => true,
      canOpenInventory: () => true,
      isInventoryOpen: () => inventoryOpen,
      getInventoryHoveredId: () => hoveredId,
      onInventoryGesture: (event) => {
        events.push(event);
        if (event.type === "open") inventoryOpen = true;
        if (event.type === "commit" || event.type === "cancel") inventoryOpen = false;
      },
      now: () => now,
      sendControllerEvent: vi.fn(),
    });

    director.update(0);
    now = 180;
    director.update(0);
    hoveredId = "spare-fuse";
    now = 220;
    director.update(0);
    now = 499;
    director.update(0);
    now = 500;
    director.update(0);

    expect(events.map((event) => event.type)).toEqual(["open", "move", "move", "commit"]);
    expect(events.at(-1)).toMatchObject({ id: "spare-fuse" });
    expect(equipmentGate.update).not.toHaveBeenCalled();
    expect(equipmentGate.suppressUntilRelease).toHaveBeenCalled();
  });

  it("routes semantic task, focused target, then untargeted equipment in priority order", () => {
    const tracked = {
      state: "tracked", fresh: true, trackingConfidence: 0.95, modeEpoch: 1, seq: 1,
      pose: frame(), gesturePose: frame(),
    };
    const stream = { sample: vi.fn(() => tracked), accept: vi.fn(() => true) };
    const equipmentGate = {
      update: vi.fn(() => "grab"),
      suppressUntilRelease: vi.fn(),
      reset: vi.fn(),
    };
    const gestureGate = { update: vi.fn(() => false), reset: vi.fn(), isContactCandidate: vi.fn(() => false) };
    const hand = {
      fallback: false, setContext: vi.fn(), setVisible: vi.fn(), setTargetContact: vi.fn(),
      setHolding: vi.fn(), applyPose: vi.fn(), destroy: vi.fn(),
    };
    let equippedId = "spare-fuse";
    const director = new HandTrackingDirector({
      hand, stream, equipmentGate, gestureGate,
      getEquippedId: () => equippedId,
      canPresentEquipment: () => true,
      now: () => 200,
      sendControllerEvent: vi.fn(),
    });

    director.update(0.016);
    expect(equipmentGate.update).toHaveBeenCalledWith(tracked, 200);
    expect(hand.setHolding).toHaveBeenLastCalledWith(true);

    director.setTarget({ id: "panel", epoch: 1, focusedAt: 0 });
    equipmentGate.update.mockClear();
    director.update(0.016);
    expect(gestureGate.update).toHaveBeenCalled();
    expect(equipmentGate.update).not.toHaveBeenCalled();
    expect(equipmentGate.suppressUntilRelease).toHaveBeenCalled();
    expect(hand.setHolding).toHaveBeenLastCalledWith(false);

    director.setTarget(null);
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    equipmentGate.update.mockClear();
    director.update(0.016);
    expect(equipmentGate.update).not.toHaveBeenCalled();
    expect(equipmentGate.suppressUntilRelease).toHaveBeenCalledTimes(2);

    director.endTask("door-defense");
    equippedId = null;
    director.update(0.016);
    expect(hand.setHolding).toHaveBeenLastCalledWith(false);
  });

  it("suppresses equipped presentation while cinematic permission is denied", () => {
    const sample = { state: "tracked", fresh: true, trackingConfidence: 0.95, pose: frame(), gesturePose: frame() };
    const equipmentGate = { update: vi.fn(() => "grab"), suppressUntilRelease: vi.fn(), reset: vi.fn() };
    const hand = { fallback: false, setHolding: vi.fn(), setVisible: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const director = new HandTrackingDirector({
      hand,
      stream: { sample: () => sample },
      equipmentGate,
      getEquippedId: () => "spare-fuse",
      canPresentEquipment: () => false,
      now: () => 1,
      sendControllerEvent: vi.fn(),
    });

    director.update(0.016);
    expect(equipmentGate.update).not.toHaveBeenCalled();
    expect(equipmentGate.suppressUntilRelease).toHaveBeenCalledOnce();
    expect(hand.setHolding).toHaveBeenCalledWith(false);
  });

  it("accepts and renders tracked poses during ordinary exploration", () => {
    let now = 10;
    const hand = {
      fallback: false,
      loaded: true,
      setContext: vi.fn(),
      setVisible: vi.fn(),
      applyPose: vi.fn(),
      destroy: vi.fn(),
    };
    const director = new HandTrackingDirector({ hand, now: () => now, sendControllerEvent: vi.fn() });

    expect(director.acceptFrame(frame({ receivedAt: now }))).toBe(true);
    director.update(1 / 60);

    expect(hand.applyPose).toHaveBeenCalledWith(expect.objectContaining({ handedness: "left" }), 1 / 60);
    expect(hand.setVisible).toHaveBeenCalledWith(true);
    expect(director.owner).toBeNull();
  });

  it("emits global grab pulses only when no semantic task owns the hand", () => {
    let now = 10;
    const onGesture = vi.fn();
    const gestureGate = { update: vi.fn(() => true), reset: vi.fn() };
    const hand = { fallback: false, setContext: vi.fn(), setVisible: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const director = new HandTrackingDirector({ hand, gestureGate, onGesture, now: () => now, sendControllerEvent: vi.fn() });
    director.setTarget({
      id: "washbasin",
      contactPoint: { x: 0.2, y: 1, z: -1 },
      contactNormal: { x: 0, y: 0, z: 1 },
      focusedAt: 4,
    });
    director.acceptFrame(frame({ receivedAt: now }));

    director.update(0);
    expect(gestureGate.update).toHaveBeenCalledWith(expect.anything(), now, expect.objectContaining({
      id: "washbasin",
      focusedAt: 4,
    }));
    expect(onGesture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: "grab",
      at: now,
      targetId: "washbasin",
    }));

    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    now = 20;
    director.acceptFrame(frame({ seq: 1, receivedAt: now }));
    director.update(0);
    expect(onGesture).toHaveBeenCalledOnce();
    expect(gestureGate.reset).toHaveBeenCalledWith({ requireRelease: true });
  });

  it("propagates target contact to the hand and rearms the gate on focus loss or change", () => {
    const gestureGate = { update: vi.fn(() => false), reset: vi.fn() };
    const hand = {
      fallback: false,
      setContext: vi.fn(),
      setVisible: vi.fn(),
      setTargetContact: vi.fn(),
      applyPose: vi.fn(),
      destroy: vi.fn(),
    };
    const director = new HandTrackingDirector({ hand, gestureGate, now: () => 100, sendControllerEvent: vi.fn() });

    const target = {
      id: "faucet",
      contactPoint: { x: 0.25, y: 1.2, z: -1.4 },
      contactNormal: { x: 1, y: 0, z: 0 },
      focusedAt: 75,
    };
    expect(director.setTarget(target)).toEqual({
      id: "faucet",
      epoch: 1,
      contactPoint: [0.25, 1.2, -1.4],
      contactNormal: [1, 0, 0],
      focusedAt: 75,
    });
    expect(hand.setTargetContact).toHaveBeenLastCalledWith({
      point: [0.25, 1.2, -1.4],
      normal: [1, 0, 0],
      epoch: 1,
      engaged: false,
    });
    expect(gestureGate.reset).toHaveBeenLastCalledWith({ requireRelease: false });

    director.setTarget({ ...target, contactPoint: { x: 0.3, y: 1.2, z: -1.4 } });
    expect(gestureGate.reset).toHaveBeenCalledTimes(1);
    expect(hand.setTargetContact).toHaveBeenLastCalledWith({
      point: [0.3, 1.2, -1.4],
      normal: [1, 0, 0],
      epoch: 1,
      engaged: false,
    });

    director.setTarget(null);
    expect(hand.setTargetContact).toHaveBeenLastCalledWith(null);
    expect(gestureGate.reset).toHaveBeenCalledTimes(2);
  });

  it("publishes candidate contact and emits the matching target epoch", () => {
    const gestureGate = {
      update: vi.fn(() => true),
      reset: vi.fn(),
      isContactCandidate: vi.fn(() => true),
    };
    const hand = {
      fallback: false,
      setContext: vi.fn(),
      setVisible: vi.fn(),
      setTargetContact: vi.fn(),
      applyPose: vi.fn(),
      destroy: vi.fn(),
    };
    const onGesture = vi.fn();
    const director = new HandTrackingDirector({ hand, gestureGate, onGesture, now: () => 200, sendControllerEvent: vi.fn() });
    director.setTarget({
      id: "faucet", epoch: 7, focusedAt: 0,
      contactPoint: [0.2, 1, -1], contactNormal: [0, 0, 1],
    });
    director.acceptFrame(frame({ receivedAt: 200 }));

    director.update(0.016);

    expect(hand.setTargetContact).toHaveBeenLastCalledWith(expect.objectContaining({ epoch: 7, engaged: true }));
    expect(onGesture).toHaveBeenCalledWith(expect.objectContaining({ targetId: "faucet", targetEpoch: 7 }));
  });

  it("does not consume a grab while the reticle has no focused target", () => {
    const gestureGate = { update: vi.fn(() => true), reset: vi.fn() };
    const onGesture = vi.fn();
    const hand = { fallback: false, setContext: vi.fn(), setVisible: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const director = new HandTrackingDirector({ hand, gestureGate, onGesture, now: () => 10, sendControllerEvent: vi.fn() });

    director.acceptFrame(frame({ receivedAt: 10 }));
    director.update(0);

    expect(gestureGate.update).not.toHaveBeenCalled();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it("owns one context and emits exactly-once task lifecycle events", () => {
    let now = 0;
    const hand = { fallback: false, load: vi.fn(async () => true), setContext: vi.fn(), setVisible: vi.fn(), setTargetContact: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const send = vi.fn();
    const director = new HandTrackingDirector({ hand, now: () => now, sendControllerEvent: send });
    director.setTarget({ id: "found-phone", epoch: 4, contactPoint: [0.2, 1, -1], contactNormal: [0, 0, 1] });
    expect(director.beginTask({ context: "found-phone", requiredAction: "grab" })).toBe(true);
    expect(director.beginTask({ context: "door-defense", requiredAction: "brace" })).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: "hand-task", active: true, context: "found-phone" });
    director.acceptFrame(frame({ receivedAt: 10 }));
    now = 1000;
    director.update(1);
    expect(director.snapshot("found-phone")).toEqual(expect.objectContaining({ context: "found-phone" }));
    director.publishTargetContact(true);
    expect(hand.setTargetContact).toHaveBeenLastCalledWith(expect.objectContaining({ epoch: 4, engaged: true }));
    expect(director.endTask("found-phone")).toBe(true);
    expect(hand.setTargetContact).toHaveBeenLastCalledWith(expect.objectContaining({ epoch: 4, engaged: false }));
    expect(director.endTask("found-phone")).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: "hand-task", active: false, context: "found-phone" });
    expect(hand.setVisible).not.toHaveBeenCalledWith(false);
  });

  it("keeps waiting for persistent tracking instead of permanently falling back after 1.5 seconds", () => {
    let now = 0;
    const director = new HandTrackingDirector({ hand: { fallback: false, setContext() {}, setVisible() {}, applyPose() {}, destroy() {} }, now: () => now, sendControllerEvent: vi.fn() });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    now = 1600;
    director.update(1.6);
    expect(director.usesFallback("door-defense")).toBe(false);

    expect(director.acceptFrame(frame({ receivedAt: now }))).toBe(true);
    director.update(0);
    expect(director.snapshot("door-defense").sample).toMatchObject({ state: "tracked", fresh: true });
  });

  it("fades a silent visual stream without converting task input to pixel fallback", () => {
    let now = 0;
    const director = new HandTrackingDirector({
      hand: { fallback: false, setContext() {}, setVisible() {}, applyPose() {}, destroy() {} },
      now: () => now,
      sendControllerEvent: vi.fn(),
    });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    expect(director.acceptFrame(frame({ receivedAt: 0 }))).toBe(true);

    now = 1499;
    director.update(1.499);
    expect(director.usesFallback("door-defense")).toBe(false);

    now = 1500;
    director.update(0.001);
    expect(director.usesFallback("door-defense")).toBe(false);
    expect(director.snapshot("door-defense").sample).toMatchObject({ state: "lost", fresh: false });
  });

  it("recovers from an unavailable status when a newer tracked epoch arrives", () => {
    let now = 0;
    const hand = { fallback: false, setContext: vi.fn(), setVisible: vi.fn(), applyPose: vi.fn(), destroy: vi.fn() };
    const director = new HandTrackingDirector({ hand, now: () => now, sendControllerEvent: vi.fn() });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    expect(director.acceptFrame({ version: 1, modeEpoch: 1, seq: 0, state: "unavailable", reason: "init", receivedAt: 0 })).toBe(true);
    director.update(0);
    expect(director.usesFallback("door-defense")).toBe(true);

    now = 10;
    expect(director.acceptFrame(frame({ modeEpoch: 2, seq: 0, receivedAt: now }))).toBe(true);
    director.update(0);

    expect(director.usesFallback("door-defense")).toBe(false);
    expect(hand.applyPose).toHaveBeenCalled();
  });

  it("exposes whether the latest sampled held observation is fresh", () => {
    let now = 0;
    const director = new HandTrackingDirector({
      hand: { fallback: false, setContext() {}, setVisible() {}, applyPose() {}, destroy() {} },
      now: () => now,
      sendControllerEvent: vi.fn(),
    });
    director.beginTask({ context: "door-defense", requiredAction: "brace" });
    expect(director.acceptFrame(frame({ seq: 0, receivedAt: 0 }))).toBe(true);
    director.update(0);
    expect(director.snapshot("door-defense").fresh).toBe(true);

    now = 1;
    expect(director.acceptFrame(frame({ seq: 1, receivedAt: 1, trackingConfidence: 0.4 }))).toBe(true);
    director.update(0);
    expect(director.snapshot("door-defense").sample).toMatchObject({
      state: "tracked",
      fresh: true,
      trackingConfidence: 0.4,
    });
    expect(director.snapshot("door-defense").fresh).toBe(false);
  });

  it("accepts sequence zero when the handset starts a newer mode epoch", () => {
    const session = new PhoneSession();
    const hand = vi.fn();
    session.addEventListener("hand", ({ detail }) => hand(detail));
    const status = (modeEpoch, seq) => ({ version: 1, modeEpoch, seq, capturedAt: 1, state: "lost" });
    expect(session.acceptHandFrame(status(1, 4))).toBe(true);
    expect(session.acceptHandFrame(status(2, 0))).toBe(true);
    expect(hand).toHaveBeenCalledTimes(2);
  });

  it("forwards cancellation to a pending hand load without enabling the late hand", async () => {
    let resolveLoad;
    const hand = {
      fallback: false,
      load: vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; })),
      setVisible: vi.fn(),
      destroy: vi.fn(),
    };
    const director = new HandTrackingDirector({ hand });
    const controller = new AbortController();
    const loading = director.load({ signal: controller.signal });

    controller.abort(new DOMException("retry", "AbortError"));
    resolveLoad(true);

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(hand.load).toHaveBeenCalledWith({ signal: controller.signal });
    expect(hand.setVisible).not.toHaveBeenCalled();
    expect(hand.destroy).toHaveBeenCalledOnce();
  });
});
