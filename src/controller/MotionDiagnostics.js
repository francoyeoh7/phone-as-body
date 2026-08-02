const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export class MotionDiagnostics {
  constructor(element) {
    this.element = element;
    this.physicalDot = element.querySelector(".physical-aim-dot");
    this.outputDot = element.querySelector(".output-aim-dot");
    this.state = {
      physicalYaw: 0,
      physicalPitch: 0,
      outputYaw: 0,
      outputPitch: 0,
      engaged: false,
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
    this.update({ engaged: this.state.engaged || Math.hypot(move.x, move.y) > 0 });
  }

  updateEngagement(engaged) {
    this.update({ engaged: Boolean(engaged) });
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

  render() {
    const state = this.state;
    this.element.dataset.engaged = state.engaged ? "true" : "false";

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
