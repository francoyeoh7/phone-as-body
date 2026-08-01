import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ControllerApp } from "../src/controller/ControllerApp.js";

function createApp({ motionEnabled = true } = {}) {
  const actions = vi.fn();
  const motion = {
    suspend: vi.fn(),
    resume: vi.fn(async () => true),
    resumeSensors: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
  };
  const app = Object.assign(Object.create(ControllerApp.prototype), {
    motion,
    motionEnabled,
    move: { x: 0.5, y: -0.5 },
    viewDelta: { yaw: 42, pitch: -18 },
    paused: false,
    pauseMenu: { hidden: false },
    permissionPanel: { hidden: true },
    permissionTitle: { textContent: "" },
    permissionCopy: { textContent: "" },
    enableMotion: { disabled: true, textContent: "" },
    requiresContinue: false,
    touchFallback: false,
    bfcacheSuspended: false,
    lifecycleGeneration: 0,
    socket: { sendAction: actions, markApplied: vi.fn() },
    diagnostics: { updateMotion: vi.fn(), updateNetwork: vi.fn(), updateJoystick: vi.fn() },
    sendInput: vi.fn(),
    destroy: vi.fn(),
  });
  return { app, motion, actions };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("controller app lifecycle", () => {
  beforeEach(() => vi.stubGlobal("navigator", { vibrate: vi.fn() }));
  afterEach(() => vi.unstubAllGlobals());

  it("suspends motion on manual pause and recalibrates sensors on resume", async () => {
    const { app, motion, actions } = createApp();

    await app.setPaused(true);

    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(app.move).toEqual({ x: 0, y: 0 });
    expect(app.viewDelta).toEqual({ yaw: 0, pitch: 0 });
    expect(app.sendInput).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(1, "pause");

    await app.setPaused(false);

    expect(motion.resumeSensors).toHaveBeenCalledTimes(1);
    expect(motion.reset).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(2, "resume");
  });

  it("resumes sensors without requesting camera access", async () => {
    const { app, motion, actions } = createApp();

    await app.setPaused(true);
    await app.setPaused(false);

    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(motion.resumeSensors).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(2, "resume");
  });

  it("pauses immediately when backgrounded during an active session", async () => {
    const { app, motion, actions } = createApp();

    app.suspendForBackground();

    expect(actions).not.toHaveBeenCalledWith("resume");
    expect(actions).toHaveBeenCalledWith("pause");
    expect(motion.suspend).toHaveBeenCalledTimes(1);
  });

  it("does not continue after a background suspension interrupts visibility recovery", async () => {
    const { app, motion, actions } = createApp();
    const pendingRecovery = deferred();
    motion.resume.mockReturnValueOnce(pendingRecovery.promise);

    const resume = app.continueAfterVisibility();
    await Promise.resolve();
    app.suspendForBackground();
    pendingRecovery.resolve(true);
    await resume;

    expect(motion.reset).not.toHaveBeenCalled();
    expect(actions).not.toHaveBeenCalledWith("resume");
    expect(app.requiresContinue).toBe(false);
  });

  it("keeps persisted pages alive and offers explicit continuation on pageshow", () => {
    const { app, motion, actions } = createApp();

    app.handlePageHide({ persisted: true });

    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(app.destroy).not.toHaveBeenCalled();
    expect(actions).toHaveBeenCalledWith("pause");

    app.handlePageShow({ persisted: true });

    expect(app.requiresContinue).toBe(true);
    expect(app.permissionPanel.hidden).toBe(false);
    expect(motion.resume).not.toHaveBeenCalled();
  });

  it("keeps the manual pause flow after returning from the background", async () => {
    const { app, motion, actions } = createApp();

    await app.setPaused(true);
    app.handlePageHide({ persisted: true });
    app.handlePageShow({ persisted: true });

    expect(app.paused).toBe(true);
    expect(app.requiresContinue).toBe(false);
    expect(motion.resume).not.toHaveBeenCalled();

    await app.setPaused(false);
    expect(motion.resumeSensors).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenLastCalledWith("resume");
  });

  it("does not show the visibility continuation while manually paused", () => {
    const { app, motion } = createApp();
    vi.stubGlobal("document", { hidden: false });
    app.paused = true;

    app.handleVisibility();

    expect(app.requiresContinue).toBe(false);
    expect(motion.resume).not.toHaveBeenCalled();
  });

  it("destroys on a non-persisted pagehide", () => {
    const { app } = createApp();

    app.handlePageHide({ persisted: false });

    expect(app.destroy).toHaveBeenCalledTimes(1);
  });

  it("matches desktop control feedback to the sent packet", () => {
    const { app } = createApp();
    const feedback = { type: "control-feedback", seq: 7, cameraYaw: 48, cameraPitch: -6 };

    app.handleDesktopEvent(feedback);

    expect(app.socket.markApplied).toHaveBeenCalledWith(feedback);
  });

  it("shows each motion sample and sends its output immediately", () => {
    const { app } = createApp();
    const sample = { yaw: 12, pitch: -4, physicalYaw: 3, physicalPitch: -1 };

    app.handleMotionSample(sample);

    expect(app.viewDelta).toBe(sample);
    expect(app.diagnostics.updateMotion).toHaveBeenCalledWith(sample);
    expect(app.sendInput).toHaveBeenCalledWith({ includeViewDelta: true, immediate: true });
  });

  it("passes immediate input through to the controller socket", () => {
    const setInput = vi.fn();
    const app = Object.assign(Object.create(ControllerApp.prototype), {
      move: { x: 0.2, y: 0.8 },
      viewDelta: { yaw: 9, pitch: 2 },
      socket: { setInput },
    });

    app.sendInput({ includeViewDelta: true, immediate: true });

    expect(setInput).toHaveBeenCalledWith({
      move: { x: 0.2, y: 0.8 },
      viewDelta: { yaw: 9, pitch: 2 },
    }, { immediate: true });
  });
});
