import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopApp } from "../src/desktop/DesktopApp.js";

function makeApp({ started = true } = {}) {
  const app = Object.assign(Object.create(DesktopApp.prototype), {
    started,
    destroyed: false,
    paused: false,
    pausedByVisibility: false,
    fallbackHolding: false,
    fallbackKeyDown: false,
    player: { setPaused: vi.fn(), resetCrouch: vi.fn() },
    audio: { setPaused: vi.fn() },
    ui: { showPause: vi.fn(), setVoiceRecording: vi.fn(), setSubtitle: vi.fn() },
    inventory: { setHovered: vi.fn() },
  });
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("visibility auto-pause", () => {
  it("auto-pauses when the tab hides and auto-resumes when it returns", () => {
    const fakeDocument = { hidden: true, pointerLockElement: null };
    vi.stubGlobal("document", fakeDocument);
    const app = makeApp();

    app.applyVisibilityChange();
    expect(app.paused).toBe(true);
    expect(app.ui.showPause).toHaveBeenCalledWith(true);

    fakeDocument.hidden = false;
    app.applyVisibilityChange();
    expect(app.paused).toBe(false);
    expect(app.ui.showPause).toHaveBeenLastCalledWith(false);
  });

  it("does not auto-resume a pause the player chose manually", () => {
    const fakeDocument = { hidden: true, pointerLockElement: null };
    vi.stubGlobal("document", fakeDocument);
    const app = makeApp();
    app.paused = true; // manual pause (Escape) before tabbing out

    app.applyVisibilityChange();
    fakeDocument.hidden = false;
    app.applyVisibilityChange();

    expect(app.paused).toBe(true);
  });

  it("ignores visibility changes before the game starts", () => {
    const fakeDocument = { hidden: true, pointerLockElement: null };
    vi.stubGlobal("document", fakeDocument);
    const app = makeApp({ started: false });

    app.applyVisibilityChange();
    expect(app.paused).toBe(false);
    expect(app.player.setPaused).not.toHaveBeenCalled();
  });
});
