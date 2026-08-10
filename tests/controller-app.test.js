import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ControllerApp, controllerShellMarkup } from "../src/controller/ControllerApp.js";

describe("controller gameplay chrome", () => {
  it("keeps only settings visible at the top and replaces the inventory orb with an edge surface", () => {
    const markup = controllerShellMarkup("617042");

    expect(markup).toContain('id="settings"');
    expect(markup).toContain('id="inventory-edge"');
    expect(markup).not.toContain('class="controller-header"');
    expect(markup).not.toContain('id="inventory-orb"');
    expect(markup).not.toContain('id="connection-label"');
    expect(markup).not.toContain('class="room-code"');
  });
});

function createApp({ motionEnabled = true } = {}) {
  const actions = vi.fn();
  const sendVoiceClip = vi.fn();
  const motion = {
    requestPermission: vi.fn(async () => ({ motionGranted: true })),
    engage: vi.fn(() => true),
    disengage: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(async () => true),
    resumeSensors: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
  };
  const cameraMotion = {
    start: vi.fn(async () => ({ cameraGranted: true })),
    setFocused: vi.fn(),
    setMode: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(() => true),
    destroy: vi.fn(),
  };
  const app = Object.assign(Object.create(ControllerApp.prototype), {
    motion,
    cameraMotion,
    handTracker: { setTask: vi.fn(), suspend: vi.fn(), resume: vi.fn(), destroy: vi.fn() },
    haptics: { start: vi.fn(), stop: vi.fn() },
    foundPhoneUI: { element: { hidden: true }, setActive: vi.fn(), destroy: vi.fn() },
    hapticsActive: true,
    foreground: true,
    connectionState: "joined",
    destroyed: false,
    cameraEnabled: false,
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
    pointerOwners: { cancelAll: vi.fn(), generation: 0 },
    inventoryOrb: { cancel: vi.fn() },
    voiceHold: { cancel: vi.fn(() => Promise.resolve()) },
    viewEngaged: false,
    playSurface: { dataset: {} },
    status: { dataset: {} },
    connectionLabel: { textContent: "" },
    joystick: { reset: vi.fn() },
    socket: {
      sendAction: actions,
      sendVoiceClip,
      markApplied: vi.fn(),
      clearPendingViewDelta: vi.fn(),
      setInput: vi.fn(),
    },
    diagnostics: {
      updateMotion: vi.fn(),
      updateNetwork: vi.fn(),
      updateJoystick: vi.fn(),
      updateEngagement: vi.fn(),
    },
    sendInput: vi.fn(),
    ensureAudioContext: vi.fn(),
    destroy: vi.fn(),
  });
  return { app, motion, cameraMotion, haptics: app.haptics, actions, sendVoiceClip };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("controller app lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { vibrate: vi.fn() });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cancels every transient control and pending timer through one path", () => {
    vi.useFakeTimers();
    const { app } = createApp();
    const delayedCalibration = vi.fn();
    const delayedBrace = vi.fn();
    app.crouching = true;
    app.viewEngaged = true;
    app.gameplayClaimGeneration = 4;
    app.calibrationTimer = window.setTimeout(delayedCalibration, 50);
    app.braceFallbackTimer = window.setTimeout(delayedBrace, 50);
    app.playSurface.classList = { remove: vi.fn() };

    app.cancelTransientControls("test");
    vi.advanceTimersByTime(100);

    expect(app.inventoryOrb.cancel).toHaveBeenCalledOnce();
    expect(app.voiceHold.cancel).toHaveBeenCalledExactlyOnceWith({ discard: true });
    expect(app.pointerOwners.cancelAll).toHaveBeenCalledOnce();
    expect(app.move).toEqual({ x: 0, y: 0 });
    expect(app.crouching).toBe(false);
    expect(app.viewEngaged).toBe(false);
    expect(app.viewDelta).toEqual({ yaw: 0, pitch: 0 });
    expect(app.gameplayClaimGeneration).toBeNull();
    expect(app.joystick.reset).toHaveBeenCalledOnce();
    expect(app.motion.disengage).toHaveBeenCalledOnce();
    expect(app.socket.clearPendingViewDelta).toHaveBeenCalledOnce();
    expect(app.sendInput).toHaveBeenCalledWith({ includeViewDelta: true, immediate: true });
    expect(delayedCalibration).not.toHaveBeenCalled();
    expect(delayedBrace).not.toHaveBeenCalled();
    expect(app.calibrationTimer).toBeNull();
    expect(app.braceFallbackTimer).toBeNull();
    vi.useRealTimers();
  });

  it.each(["disconnected", "replaced", "session-ended"])("routes %s through transient cleanup", (state) => {
    const { app } = createApp();
    app.cancelTransientControls = vi.fn();

    app.updateConnection(state);

    expect(app.cancelTransientControls).toHaveBeenCalledExactlyOnceWith(`connection:${state}`);
  });

  it("routes reorientation and camera capture loss through transient cleanup", () => {
    const { app } = createApp();
    app.cancelTransientControls = vi.fn();

    app.handleMotionState("reorienting");
    app.handleCameraState("capture-error");

    expect(app.cancelTransientControls.mock.calls).toEqual([
      ["motion:reorienting"],
      ["camera:capture-error"],
    ]);
  });

  it("suspends motion on manual pause and recalibrates sensors on resume", async () => {
    const { app, motion, cameraMotion, actions } = createApp();

    await app.setPaused(true);

    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(cameraMotion.suspend).toHaveBeenCalledTimes(1);
    expect(app.move).toEqual({ x: 0, y: 0 });
    expect(app.viewDelta).toEqual({ yaw: 0, pitch: 0 });
    expect(app.sendInput).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenNthCalledWith(1, "pause");

    await app.setPaused(false);

    expect(motion.resumeSensors).toHaveBeenCalledTimes(1);
    expect(cameraMotion.resume).toHaveBeenCalledTimes(1);
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
    const { app, motion, cameraMotion, haptics, actions } = createApp();

    app.suspendForBackground();

    expect(actions).not.toHaveBeenCalledWith("resume");
    expect(actions).toHaveBeenCalledWith("pause");
    expect(motion.suspend).toHaveBeenCalledTimes(1);
    expect(cameraMotion.suspend).toHaveBeenCalledTimes(1);
    expect(haptics.stop).toHaveBeenCalledTimes(1);
    expect(app.pointerOwners.cancelAll).toHaveBeenCalledOnce();
    expect(app.voiceHold.cancel).toHaveBeenCalledExactlyOnceWith({ discard: true });
  });

  it("forwards committed voice state and direct binary clips to the socket", () => {
    const { app, actions, sendVoiceClip } = createApp();
    const clip = {
      version: 1,
      seq: 0,
      durationMs: 900,
      mimeType: "audio/webm",
      data: new Uint8Array([1, 2, 3]).buffer,
    };

    app.handleVoiceActive(true);
    app.handleVoiceActive(false);
    app.handleVoiceClip(clip);

    expect(actions.mock.calls).toEqual([
      ["voice-recording", { active: true }],
      ["voice-recording", { active: false }],
    ]);
    expect(sendVoiceClip).toHaveBeenCalledExactlyOnceWith(clip);
  });

  it.each(["disconnected", "replaced"])("discard-cancels voice when the controller is %s", (state) => {
    const { app } = createApp();

    app.updateConnection(state);

    expect(app.inventoryOrb.cancel).toHaveBeenCalledOnce();
    expect(app.voiceHold.cancel).toHaveBeenCalledExactlyOnceWith({ discard: true });
  });

  it("clears crouch before background input cleanup", () => {
    const { app } = createApp();
    app.crouching = true;

    app.suspendForBackground();

    expect(app.crouching).toBe(false);
  });

  it("requests the rear camera together with motion permission", async () => {
    const { app, motion, cameraMotion, actions } = createApp({ motionEnabled: false });

    await app.enableSensors();

    expect(motion.requestPermission).toHaveBeenCalledTimes(1);
    expect(cameraMotion.start).toHaveBeenCalledTimes(1);
    expect(app.handTracker.setTask).toHaveBeenCalledExactlyOnceWith({ active: true });
    expect(app.motionEnabled).toBe(true);
    expect(app.cameraEnabled).toBe(true);
  });

  it("blocks gameplay and hand tracking until gyroscope permission is granted", async () => {
    const { app, motion, cameraMotion, actions } = createApp({ motionEnabled: false });
    motion.requestPermission.mockResolvedValue({ motionGranted: false });

    await app.enableSensors();

    expect(app.motionEnabled).toBe(false);
    expect(app.permissionPanel.hidden).toBe(false);
    expect(app.permissionTitle.textContent).toContain("陀螺仪");
    expect(app.enableMotion.textContent).toBe("重新授权");
    expect(cameraMotion.suspend).toHaveBeenCalledOnce();
    expect(app.handTracker.suspend).toHaveBeenCalledOnce();
    expect(app.handTracker.setTask).not.toHaveBeenCalled();
    expect(actions).toHaveBeenCalledWith("pause");
    expect(actions).not.toHaveBeenCalledWith("resume");
  });

  it("keeps the desktop paused when an unapproved gyroscope session reconnects", () => {
    const { app, actions } = createApp({ motionEnabled: false });
    app.connectionState = "disconnected";
    app.hapticsActive = true;

    app.updateConnection("joined");

    expect(app.hapticsActive).toBe(false);
    expect(actions).toHaveBeenCalledExactlyOnceWith("pause");
  });

  it("uses full-screen hold only as an explicit door fallback when hand tracking is unavailable", () => {
    const { app, actions, motion } = createApp();
    app.cameraEnabled = true;
    app.handTaskContext = "door-defense";
    app.handTrackingState = "fallback";

    app.handleJoystickEngagement(true);
    app.handleJoystickEngagement(false);

    expect(actions).toHaveBeenNthCalledWith(1, "task-hold", {
      context: "door-defense",
      active: true,
    });
    expect(actions).toHaveBeenNthCalledWith(2, "task-hold", {
      context: "door-defense",
      active: false,
    });
    expect(motion.engage).not.toHaveBeenCalled();
  });

  it("clears crouch when the joystick is repurposed as a door fallback hold", () => {
    const { app } = createApp();
    app.crouching = true;
    app.cameraEnabled = true;
    app.handTaskContext = "door-defense";
    app.handTrackingState = "fallback";

    app.handleJoystickEngagement(true);

    expect(app.crouching).toBe(false);
    expect(app.sendInput).toHaveBeenCalledWith({ immediate: true });
  });

  it("clears crouch when hand tracking enters door fallback and keeps it clear after recovery", () => {
    const { app } = createApp();
    app.cameraEnabled = true;
    app.handTaskContext = "door-defense";
    app.handTrackingState = "tracked";
    app.crouching = true;
    app.move = { x: 0, y: 0 };

    app.handleHandTrackingState("fallback");

    expect(app.crouching).toBe(false);
    expect(app.sendInput).toHaveBeenCalledTimes(1);
    expect(app.sendInput).toHaveBeenCalledWith({ immediate: true });

    app.handleHandTrackingState("tracked");

    expect(app.crouching).toBe(false);
    expect(app.sendInput).toHaveBeenCalledTimes(1);
  });

  it("keeps motion controls available when camera permission is denied", async () => {
    const { app, cameraMotion } = createApp({ motionEnabled: false });
    cameraMotion.start.mockResolvedValue({ cameraGranted: false });

    await app.enableSensors();

    expect(app.motionEnabled).toBe(true);
    expect(app.cameraEnabled).toBe(false);
    expect(app.permissionCopy.textContent).toContain("后置摄像头未启用");
  });

  it("describes rear-camera fallback when camera access becomes unavailable", () => {
    const { app } = createApp();

    app.handleCameraState("denied");

    expect(app.permissionCopy.textContent).toContain("后置摄像头不可用");
  });

  it("does not continue after a background suspension interrupts visibility recovery", async () => {
    const { app, motion, cameraMotion, actions } = createApp();
    const pendingRecovery = deferred();
    motion.resume.mockReturnValueOnce(pendingRecovery.promise);

    const resume = app.continueAfterVisibility();
    await Promise.resolve();
    app.suspendForBackground();
    pendingRecovery.resolve(true);
    await resume;

    expect(motion.reset).not.toHaveBeenCalled();
    expect(cameraMotion.resume).not.toHaveBeenCalled();
    expect(actions).not.toHaveBeenCalledWith("resume");
    expect(app.requiresContinue).toBe(false);
  });

  it("ignores sensor permission results that arrive after controller destruction", async () => {
    const { app, motion, cameraMotion, actions } = createApp({ motionEnabled: false });
    const motionPermission = deferred();
    const cameraPermission = deferred();
    motion.requestPermission.mockReturnValueOnce(motionPermission.promise);
    cameraMotion.start.mockReturnValueOnce(cameraPermission.promise);
    const timer = vi.spyOn(window, "setTimeout");

    const enabling = app.enableSensors();
    app.destroyed = true;
    app.lifecycleGeneration += 1;
    motionPermission.resolve({ motionGranted: true });
    cameraPermission.resolve({ cameraGranted: true });
    await enabling;

    expect(app.motionEnabled).toBe(false);
    expect(app.cameraEnabled).toBe(false);
    expect(timer).not.toHaveBeenCalled();
  });

  it("allows sensor permission retry when initial permissions finish after backgrounding", async () => {
    const { app, motion, cameraMotion, actions } = createApp({ motionEnabled: false });
    const motionPermission = deferred();
    const cameraPermission = deferred();
    motion.requestPermission.mockReturnValueOnce(motionPermission.promise);
    cameraMotion.start.mockReturnValueOnce(cameraPermission.promise);

    const enabling = app.enableSensors();
    app.suspendForBackground();
    motionPermission.resolve({ motionGranted: true });
    cameraPermission.resolve({ cameraGranted: true });
    await enabling;

    expect(app.motionEnabled).toBe(false);
    expect(app.cameraEnabled).toBe(false);
    expect(app.permissionPanel.hidden).toBe(false);
    expect(app.enableMotion.disabled).toBe(false);
    expect(actions).not.toHaveBeenCalledWith("resume");

    await app.enableSensors();

    expect(motion.requestPermission).toHaveBeenCalledTimes(2);
    expect(cameraMotion.start).toHaveBeenCalledTimes(2);
    expect(cameraMotion.resume).toHaveBeenCalledTimes(1);
    expect(app.motionEnabled).toBe(true);
    expect(app.cameraEnabled).toBe(true);
    expect(app.foreground).toBe(true);
    expect(app.hapticsActive).toBe(true);
    expect(actions).toHaveBeenCalledWith("resume");
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

  it("keeps the persistent tracker alive when desktop task context changes", async () => {
    const { app } = createApp();

    app.handleDesktopEvent({ type: "hand-task", active: true, context: "door-defense" });
    await app.setPaused(true);
    await app.setPaused(false);

    expect(app.handTracker.setTask).not.toHaveBeenCalled();
    expect(app.playSurface.dataset.handTask).toBe("door-defense");
    expect(app.handTracker.suspend).toHaveBeenCalledOnce();
    expect(app.handTracker.resume).toHaveBeenCalledOnce();
  });

  it("focuses camera motion analysis only while a desktop target is selected", () => {
    const { app, cameraMotion } = createApp();

    app.handleDesktopEvent({ type: "target-focus", id: "fuse" });
    app.handleDesktopEvent({ type: "target-focus", id: null });

    expect(cameraMotion.setFocused).toHaveBeenNthCalledWith(1, true);
    expect(cameraMotion.setFocused).toHaveBeenNthCalledWith(2, false);
  });

  it("never turns pixel-difference camera motion into an interaction", () => {
    const { app, actions } = createApp();

    app.handleCameraMotion();

    expect(actions).not.toHaveBeenCalledWith("interact");
  });

  it("keeps legacy pixel-presence events from reaching gameplay", () => {
    const { app, cameraMotion, actions } = createApp();

    app.handleDesktopEvent({ type: "gesture-mode", mode: "presence", context: "door-defense", baseline: "fresh" });
    app.handleCameraPresence({ ready: true, active: true, context: "door-defense" });

    expect(cameraMotion.setMode).toHaveBeenCalledWith({ mode: "pulse", context: null, baseline: "fresh" });
    expect(actions).not.toHaveBeenCalledWith("gesture-presence", expect.anything());
  });

  it("starts brace haptics from desktop events and stops them when paused", async () => {
    const { app, haptics } = createApp();

    app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });
    await app.setPaused(true);
    app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });
    app.handleDesktopEvent({ type: "haptics", active: false, pattern: "brace" });

    expect(haptics.start).toHaveBeenCalledOnce();
    expect(haptics.stop).toHaveBeenCalled();
  });

  it("opens the found phone UI from a desktop event and stops brace haptics", () => {
    const { app, haptics } = createApp();

    app.handleDesktopEvent({ type: "found-phone-ui", active: true });

    expect(app.foundPhoneUI.setActive).toHaveBeenCalledWith(true);
    expect(haptics.stop).toHaveBeenCalledOnce();
  });

  it("forwards found phone UI deactivation so the overlay hides, resets, and stops haptics", () => {
    const { app, haptics } = createApp();

    app.handleDesktopEvent({ type: "found-phone-ui", active: false });

    expect(app.foundPhoneUI.setActive).toHaveBeenCalledWith(false);
    expect(haptics.stop).toHaveBeenCalledOnce();
  });

  it.each([
    ["paused", (app) => { app.paused = true; }],
    ["backgrounded", (app) => { app.foreground = false; }],
    ["disconnected", (app) => { app.connectionState = "disconnected"; }],
    ["destroyed", (app) => { app.destroyed = true; }],
    ["awaiting visibility continuation", (app) => { app.requiresContinue = true; }],
  ])("keeps the found phone UI closed for a late desktop event while %s", (_state, updateLifecycle) => {
    const { app, haptics } = createApp();
    updateLifecycle(app);

    app.handleDesktopEvent({ type: "found-phone-ui", active: true });

    expect(app.foundPhoneUI.setActive).toHaveBeenCalledWith(false);
    expect(haptics.stop).toHaveBeenCalledOnce();
  });

  it("always closes the found phone UI for an inactive desktop event", () => {
    const { app } = createApp();
    app.paused = true;

    app.handleDesktopEvent({ type: "found-phone-ui", active: false });

    expect(app.foundPhoneUI.setActive).toHaveBeenCalledWith(false);
  });

  it.each([
    ["manual pause", (app) => app.setPaused(true)],
    ["background", (app) => app.suspendForBackground()],
  ])("closes the found phone UI during %s cleanup", async (_name, cleanup) => {
    const { app } = createApp();

    await cleanup(app);

    expect(app.foundPhoneUI.setActive).toHaveBeenCalledWith(false);
  });

  it("closes the found phone UI when destroyed", () => {
    vi.stubGlobal("document", { removeEventListener: vi.fn() });
    vi.stubGlobal("window", { clearTimeout: vi.fn(), removeEventListener: vi.fn() });
    const { app } = createApp();
    app.joystick.destroy = vi.fn();
    app.diagnostics.destroy = vi.fn();
    app.socket.destroy = vi.fn();
    app.destroy = ControllerApp.prototype.destroy.bind(app);

    app.destroy();

    expect(app.foundPhoneUI.setActive).toHaveBeenCalledWith(false);
    expect(app.voiceHold.cancel).toHaveBeenCalledExactlyOnceWith({ discard: true });
  });

  it("stops haptics when the peer disconnects", () => {
    const { app, haptics, cameraMotion } = createApp();

    app.updateConnection("disconnected");
    app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });

    expect(haptics.stop).toHaveBeenCalledOnce();
    expect(haptics.start).not.toHaveBeenCalled();
    expect(cameraMotion.setMode).toHaveBeenCalledWith({
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
  });

  it("provides visible and audio feedback when physical vibration is unavailable", () => {
    const { app } = createApp();
    const classes = new Set();
    app.playSurface = {
      classList: {
        add: vi.fn((name) => classes.add(name)),
        remove: vi.fn((name) => classes.delete(name)),
      },
    };
    const oscillator = {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { setValueAtTime: vi.fn() },
      type: "",
    };
    const gain = {
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
    app.audioContext = {
      currentTime: 1,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
    };

    app.pulseBraceFallback();

    expect(app.playSurface.classList.add).toHaveBeenCalledWith("brace-impact");
    expect(oscillator.start).toHaveBeenCalledWith(1);
    expect(oscillator.stop).toHaveBeenCalledWith(1.08);
  });

  it("does not restart haptics after background cleanup", () => {
    const { app, haptics } = createApp();

    app.suspendForBackground();
    app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });

    expect(haptics.start).not.toHaveBeenCalled();
  });

  it("does not restart haptics when the connection rejoins in the background", () => {
    const { app, haptics } = createApp();

    app.suspendForBackground();
    app.updateConnection("joined");
    app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });

    expect(haptics.start).not.toHaveBeenCalled();
  });

  it("stops haptics when the controller is destroyed", () => {
    vi.stubGlobal("document", { removeEventListener: vi.fn() });
    vi.stubGlobal("window", { clearTimeout: vi.fn(), removeEventListener: vi.fn() });
    const haptics = { start: vi.fn(), stop: vi.fn() };
    const app = Object.assign(Object.create(ControllerApp.prototype), {
      lifecycleGeneration: 0,
      calibrationTimer: null,
      haptics,
      foundPhoneUI: { element: { hidden: true }, setActive: vi.fn(), destroy: vi.fn() },
      hapticsActive: true,
      foreground: true,
      connectionState: "joined",
      destroyed: false,
      joystick: { destroy: vi.fn() },
      motion: { destroy: vi.fn() },
      cameraMotion: { destroy: vi.fn() },
      diagnostics: { destroy: vi.fn() },
      socket: { destroy: vi.fn() },
      audioContext: { close: vi.fn() },
      handleVisibility: vi.fn(),
      handlePageHide: vi.fn(),
      handlePageShow: vi.fn(),
    });

    app.destroy();
    app.handleDesktopEvent({ type: "haptics", active: true, pattern: "brace" });

    expect(haptics.stop).toHaveBeenCalledOnce();
    expect(haptics.start).not.toHaveBeenCalled();
  });

  it("shows each motion sample and sends its output immediately", () => {
    const { app } = createApp();
    const sample = { yaw: 12, pitch: -4, physicalYaw: 3, physicalPitch: -1 };

    app.handleMotionSample(sample);

    expect(app.viewDelta).toBe(sample);
    expect(app.diagnostics.updateMotion).toHaveBeenCalledWith(sample);
    expect(app.sendInput).toHaveBeenCalledWith({ includeViewDelta: true, immediate: true });
  });

  it("uses joystick contact as the motion clutch", () => {
    const { app, motion } = createApp();

    expect(app.handleJoystickEngagement).toBeTypeOf("function");
    app.handleJoystickEngagement(true);
    expect(motion.engage).toHaveBeenCalledTimes(1);
    expect(app.diagnostics.updateEngagement).toHaveBeenLastCalledWith(true);

    app.handleJoystickEngagement(false);
    expect(motion.disengage).toHaveBeenCalledTimes(1);
    expect(app.diagnostics.updateEngagement).toHaveBeenLastCalledWith(false);
    expect(app.socket.clearPendingViewDelta).toHaveBeenCalledTimes(1);
    expect(app.sendInput).toHaveBeenLastCalledWith({ includeViewDelta: true, immediate: true });
  });

  it("does not keep the clutch active while the phone is reorienting", () => {
    const { app } = createApp();

    app.viewEngaged = true;
    app.handleMotionState("reorienting");

    expect(app.viewEngaged).toBe(false);
    expect(app.joystick.reset).toHaveBeenCalledTimes(1);
    expect(app.socket.clearPendingViewDelta).toHaveBeenCalledTimes(1);
    expect(app.sendInput).toHaveBeenLastCalledWith({ includeViewDelta: true, immediate: true });
  });

  it("passes immediate input through to the controller socket", () => {
    const setInput = vi.fn();
    const app = Object.assign(Object.create(ControllerApp.prototype), {
      move: { x: 0.2, y: 0.8 },
      viewDelta: { yaw: 9, pitch: 2 },
      viewEngaged: true,
      crouching: true,
      socket: { setInput },
    });

    app.sendInput({ includeViewDelta: true, immediate: true });

    expect(setInput).toHaveBeenCalledWith({
      move: { x: 0.2, y: 0.8 },
      viewDelta: { yaw: 9, pitch: 2 },
      clutch: true,
      crouch: true,
    }, { immediate: true });
  });

  it("sends an immediate crouch snapshot and neutral movement on crouch entry", () => {
    const { app } = createApp();
    app.crouching = false;

    app.handleCrouchChange(true);

    expect(app.crouching).toBe(true);
    expect(app.move).toEqual({ x: 0, y: 0 });
    expect(app.sendInput).toHaveBeenCalledWith({ immediate: true });
  });
});

describe("controller inventory modal", () => {
  it("opens only during active gameplay outside semantic tasks and phone inspection", () => {
    const { app } = createApp();

    expect(app.canOpenInventory()).toBe(true);

    for (const blocked of [
      { motionEnabled: false },
      { foreground: false },
      { paused: true },
      { requiresContinue: true },
      { destroyed: true },
      { connectionState: "disconnected" },
      { handTaskContext: "door-defense" },
    ]) {
      const original = Object.fromEntries(Object.keys(blocked).map((key) => [key, app[key]]));
      Object.assign(app, blocked);
      expect(app.canOpenInventory()).toBe(false);
      Object.assign(app, original);
    }

    app.foundPhoneUI.element.hidden = false;
    expect(app.canOpenInventory()).toBe(false);
  });

  it("cancels voice and neutralizes joystick movement, crouch, and clutch before open", () => {
    const { app } = createApp();
    const order = [];
    app.move = { x: 0.7, y: -0.4 };
    app.crouching = true;
    app.viewEngaged = true;
    app.viewDelta = { yaw: 12, pitch: -6 };
    app.voiceHold.cancel.mockImplementation(() => {
      order.push("voice");
      return Promise.resolve();
    });
    app.joystick.reset.mockImplementation(() => order.push("joystick"));
    app.socket.sendAction.mockImplementation((action) => order.push(action === "inventory-pointer" ? "open" : action));

    app.handleInventoryClaim();
    app.sendInventoryPointer("open");

    expect(order).toEqual(["voice", "joystick", "open"]);
    expect(app.move).toEqual({ x: 0, y: 0 });
    expect(app.crouching).toBe(false);
    expect(app.viewEngaged).toBe(false);
    expect(app.viewDelta).toEqual({ yaw: 0, pitch: 0 });
    expect(app.socket.clearPendingViewDelta).toHaveBeenCalledOnce();
    expect(app.sendInput).toHaveBeenCalledWith({ includeViewDelta: true, immediate: true });
    expect(app.socket.sendAction).toHaveBeenCalledWith("inventory-pointer", { phase: "open" });
  });

  it("cancels the inventory gesture before invalidating all ownership", () => {
    const { app } = createApp();
    const order = [];
    app.inventoryOrb = { cancel: vi.fn(() => order.push("inventory")) };
    app.voiceHold.cancel.mockImplementation(() => order.push("voice"));
    app.pointerOwners.cancelAll.mockImplementation(() => order.push("owners"));

    app.cancelPointerOwnership();

    expect(order).toEqual(["inventory", "voice", "owners"]);
  });
});
