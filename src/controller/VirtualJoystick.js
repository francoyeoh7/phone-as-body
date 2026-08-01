import { clampJoystickPoint, normalizeJoystick } from "../shared/joystick.js";

export class VirtualJoystick {
  constructor(element, { radius = 68, onChange }) {
    this.element = element;
    this.radius = radius;
    this.onChange = onChange;
    this.pointerId = null;
    this.origin = { x: 0, y: 0 };
    this.base = element.querySelector(".joystick-base");
    this.thumb = element.querySelector(".joystick-thumb");
    this.handleDown = this.handleDown.bind(this);
    this.handleMove = this.handleMove.bind(this);
    this.handleEnd = this.handleEnd.bind(this);
    this.reset = this.reset.bind(this);
    this.handleVisibility = () => document.hidden && this.reset();

    element.addEventListener("pointerdown", this.handleDown);
    element.addEventListener("pointermove", this.handleMove);
    element.addEventListener("pointerup", this.handleEnd);
    element.addEventListener("pointercancel", this.handleEnd);
    element.addEventListener("lostpointercapture", this.handleEnd);
    window.addEventListener("pagehide", this.reset);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  handleDown(event) {
    if (this.pointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = this.element.getBoundingClientRect();
    this.pointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };
    this.base.style.left = `${event.clientX - bounds.left}px`;
    this.base.style.top = `${event.clientY - bounds.top}px`;
    this.base.classList.add("is-active");
    this.element.setPointerCapture(event.pointerId);
    this.update(event);
  }

  handleMove(event) {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.update(event);
  }

  update(event) {
    const input = {
      dx: event.clientX - this.origin.x,
      dy: event.clientY - this.origin.y,
      radius: this.radius,
    };
    const point = clampJoystickPoint(input);
    this.thumb.style.transform = `translate3d(${point.dx}px, ${point.dy}px, 0)`;
    this.onChange?.(normalizeJoystick(input));
  }

  handleEnd(event) {
    if (event?.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    event?.stopPropagation?.();
    this.reset();
  }

  reset() {
    if (this.pointerId !== null && this.element.hasPointerCapture?.(this.pointerId)) {
      this.element.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.base.classList.remove("is-active");
    this.thumb.style.transform = "translate3d(0, 0, 0)";
    this.onChange?.({ x: 0, y: 0 });
  }

  destroy() {
    this.reset();
    this.element.removeEventListener("pointerdown", this.handleDown);
    this.element.removeEventListener("pointermove", this.handleMove);
    this.element.removeEventListener("pointerup", this.handleEnd);
    this.element.removeEventListener("pointercancel", this.handleEnd);
    this.element.removeEventListener("lostpointercapture", this.handleEnd);
    window.removeEventListener("pagehide", this.reset);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }
}
