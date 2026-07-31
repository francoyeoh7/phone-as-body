import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ControllerApp } from "../src/controller/ControllerApp.js";

function createApp({ motionEnabled = true, cameraEnabled = true } = {}) {
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
    cameraEnabled,
    move: { x: 0.5, y: -0.5 },
    viewMotion: { x: 0.5, y: -0.25, confidence: 1 },
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
    socket: { sendAction: actions },
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

  it("suspends motion on manual pause and reacquires the camera on resume", async () => {
    const { app, motion, actions } = createApp();

    await app.setPaused(true);

    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(app.move).toEqual({ x: 0, y: 0 });
    expect(app.viewMotion).toEqual({ x: 0, y: 0, confidence: 0 });
    expect(app.sendInput).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(1, "pause");

    await app.setPaused(false);

    expect(motion.resume).toHaveBeenCalledTimes(1);
    expect(motion.reset).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(2, "resume");
  });

  it("resumes sensors without restarting an unavailable camera", async () => {
    const { app, motion, actions } = createApp({ cameraEnabled: false });

    await app.setPaused(true);
    await app.setPaused(false);

    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(motion.resume).not.toHaveBeenCalled();
    expect(motion.resumeSensors).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(2, "resume");
  });

  it("does not resume after a background suspension interrupts camera restart", async () => {
    const { app, motion, actions } = createApp();
    const pendingCamera = deferred();
    motion.resume.mockReturnValueOnce(pendingCamera.promise);

    const resume = app.setPaused(false);
    await Promise.resolve();
    app.suspendForBackground();
    pendingCamera.resolve(true);
    await resume;

    expect(motion.reset).not.toHaveBeenCalled();
    expect(actions).not.toHaveBeenCalledWith("resume");
    expect(actions).toHaveBeenCalledWith("pause");
  });

  it("does not continue after a background suspension interrupts visibility recovery", async () => {
    const { app, motion, actions } = createApp();
    const pendingCamera = deferred();
    motion.resume.mockReturnValueOnce(pendingCamera.promise);

    const resume = app.continueAfterVisibility();
    await Promise.resolve();
    app.suspendForBackground();
    pendingCamera.resolve(true);
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
    expect(motion.resume).toHaveBeenCalledTimes(1);
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
});
