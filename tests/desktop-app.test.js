import { describe, expect, it, vi } from "vitest";
import { DesktopApp } from "../src/desktop/DesktopApp.js";

describe("desktop control feedback", () => {
  it("reports each applied input sequence and resulting camera angles once", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      lastFeedbackSequence: -1,
      phone: { send: vi.fn() },
      player: { cameraYaw: Math.PI / 2, cameraPitch: -Math.PI / 12 },
    });

    app.sendControlFeedback({ seq: 4 });
    app.sendControlFeedback({ seq: 4 });

    expect(app.phone.send).toHaveBeenCalledTimes(1);
    expect(app.phone.send).toHaveBeenCalledWith({
      type: "control-feedback",
      seq: 4,
      cameraYaw: 90,
      cameraPitch: -15,
    });
  });

  it("forwards focused interaction targets to the phone and reticle", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      currentTargetId: null,
      phone: { send: vi.fn() },
      ui: { setTargetFocused: vi.fn() },
    });

    app.handleTargetFocus({ id: "fuse", focused: true });
    app.handleTargetFocus({ id: null, focused: false });

    expect(app.phone.send).toHaveBeenNthCalledWith(1, { type: "target-focus", id: "fuse" });
    expect(app.phone.send).toHaveBeenNthCalledWith(2, { type: "target-focus", id: null });
    expect(app.ui.setTargetFocused).toHaveBeenNthCalledWith(1, true);
    expect(app.ui.setTargetFocused).toHaveBeenNthCalledWith(2, false);
  });
});
