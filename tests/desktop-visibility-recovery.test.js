import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopApp } from "../src/desktop/DesktopApp.js";

function createEventTarget() {
  return {
    hidden: false,
    pointerLockElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    exitPointerLock: vi.fn(),
  };
}

function createApp() {
  const fakeWindow = createEventTarget();
  fakeWindow.matchMedia = vi.fn(() => ({ matches: false }));
  const fakeDocument = createEventTarget();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("location", { search: "", href: "https://game.test/" });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const app = new DesktopApp({});
  app.started = true;
  app.destroyed = false;
  app.paused = false;
  app.setPaused = vi.fn();
  return { app, fakeDocument };
}

describe("DesktopApp visibility pause recovery", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("pauses when the tab becomes hidden", () => {
    const { app, fakeDocument } = createApp();
    fakeDocument.hidden = true;
    app.handleVisibilityChange();
    expect(app.setPaused).toHaveBeenCalledWith(true);
  });

  it("auto-resumes on return when the phone is still connected", () => {
    const { app, fakeDocument } = createApp();
    app.paused = true;
    app.phone = { connected: true };
    fakeDocument.hidden = false;
    app.handleVisibilityChange();
    expect(app.setPaused).toHaveBeenCalledWith(false, false);
  });

  it("does not auto-resume when the phone is disconnected", () => {
    const { app, fakeDocument } = createApp();
    app.paused = true;
    app.phone = { connected: false };
    fakeDocument.hidden = false;
    app.handleVisibilityChange();
    expect(app.setPaused).not.toHaveBeenCalled();
  });

  it("resumes when the pause overlay is clicked", () => {
    const { app } = createApp();
    app.paused = true;
    app.handlePauseOverlayClick();
    expect(app.setPaused).toHaveBeenCalledWith(false, false);
  });

  it("ignores overlay clicks while running", () => {
    const { app } = createApp();
    app.paused = false;
    app.handlePauseOverlayClick();
    expect(app.setPaused).not.toHaveBeenCalled();
  });
});
