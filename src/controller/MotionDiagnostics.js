const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const fixed = (value, digits = 1) => finite(value).toFixed(digits);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export class MotionDiagnostics {
  constructor(element) {
    this.element = element;
    this.fields = new Map(
      [...element.querySelectorAll("[data-telemetry]")]
        .map((node) => [node.dataset.telemetry, node]),
    );
    this.physicalDot = element.querySelector(".physical-aim-dot");
    this.outputDot = element.querySelector(".output-aim-dot");
    this.state = {
      alpha: 0,
      beta: 0,
      gamma: 0,
      sensorHz: 0,
      physicalYaw: 0,
      physicalPitch: 0,
      outputYaw: 0,
      outputPitch: 0,
      roll: 0,
      transitionScale: 0,
      joystickX: 0,
      joystickY: 0,
      sendHz: 0,
      serverRttMs: null,
      appliedRttMs: null,
      transport: "connecting",
      cameraYaw: 0,
      cameraPitch: 0,
    };
    this.frame = null;
    this.render();
  }

  updateSensor(sample) {
    this.update(sample);
  }

  updateMotion(sample) {
    this.update({
      physicalYaw: sample.physicalYaw,
      physicalPitch: sample.physicalPitch,
      outputYaw: sample.yaw,
      outputPitch: sample.pitch,
      roll: sample.roll,
      transitionScale: sample.transitionScale,
    });
  }

  updateJoystick(move) {
    this.update({ joystickX: move.x, joystickY: move.y });
  }

  updateNetwork(sample) {
    this.update(sample);
  }

  update(values) {
    this.state = { ...this.state, ...values };
    if (this.frame !== null) return;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 16));
    this.frame = schedule(() => {
      this.frame = null;
      this.render();
    });
  }

  setField(name, value) {
    const field = this.fields.get(name);
    if (field) field.textContent = value;
  }

  render() {
    const state = this.state;
    this.setField("raw", `${fixed(state.alpha)} / ${fixed(state.beta)} / ${fixed(state.gamma)}`);
    this.setField("aim", `${fixed(state.physicalYaw)} / ${fixed(state.physicalPitch)}`);
    this.setField("output", `${fixed(state.outputYaw)} / ${fixed(state.outputPitch)}`);
    this.setField("roll", `${fixed(state.roll)} / ${Math.round(finite(state.transitionScale) * 100)}%`);
    this.setField("joystick", `${fixed(state.joystickX, 2)} / ${fixed(state.joystickY, 2)}`);
    this.setField("rates", `${Math.round(finite(state.sensorHz))} / ${Math.round(finite(state.sendHz))} Hz`);
    this.setField("network", state.transport === "webrtc"
      ? "webrtc · direct"
      : `${state.transport} · ${state.serverRttMs === null ? "--" : Math.round(state.serverRttMs)} ms`);
    this.setField("applied", `${state.appliedRttMs === null ? "--" : Math.round(state.appliedRttMs)} ms`);
    this.setField("camera", `${fixed(state.cameraYaw)} / ${fixed(state.cameraPitch)}`);

    const physicalX = clamp(finite(state.physicalYaw) / 25, -1, 1) * 29;
    const physicalY = clamp(finite(state.physicalPitch) / 25, -1, 1) * -29;
    const outputX = clamp(finite(state.outputYaw) / 100, -1, 1) * 29;
    const outputY = clamp(finite(state.outputPitch) / 100, -1, 1) * -29;
    if (this.physicalDot) this.physicalDot.style.transform = `translate3d(${physicalX}px, ${physicalY}px, 0)`;
    if (this.outputDot) this.outputDot.style.transform = `translate3d(${outputX}px, ${outputY}px, 0)`;
  }

  destroy() {
    if (this.frame === null) return;
    const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
    cancel(this.frame);
    this.frame = null;
  }
}
