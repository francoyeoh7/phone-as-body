import { clampJoystickPoint, normalizeJoystick } from "../shared/joystick.js";

const TAP_MAX_MS = 240;
const TAP_MAX_DISTANCE = 10;
const HOLD_TO_ENGAGE_MS = 180;

export class VirtualJoystick {
  constructor(element, {
    radius = 84,
    onChange,
    onEngagementChange,
    onTap,
    onIgnoreTarget = () => false,
    clock = () => performance.now(),
  }) {
    this.element = element;
    this.radius = radius;
    this.onChange = onChange;
    this.onEngagementChange = onEngagementChange;
    this.onTap = onTap;
    this.onIgnoreTarget = onIgnoreTarget;
    this.clock = clock;
    this.pointerId = null;
    this.mode = "idle";
    this.origin = { x: 0, y: 0 };
    this.startedAt = 0;
    this.multiTouch = false;
    this.holdTimer = null;
    this.base = element.querySelector(".joystick-base");
    this.thumb = element.querySelector(".joystick-thumb");
    this.handleDown = this.handleDown.bind(this);
    this.handleMove = this.handleMove.bind(this);
    this.handleEnd = this.handleEnd.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    this.reset = this.reset.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);

    element.addEventListener("pointerdown", this.handleDown);
    element.addEventListener("pointermove", this.handleMove);
    element.addEventListener("pointerup", this.handleEnd);
    element.addEventListener("pointercancel", this.handleCancel);
    element.addEventListener("lostpointercapture", this.handleCancel);
    window.addEventListener("pagehide", this.reset);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  handleVisibility() {
    if (document.hidden) this.reset();
  }

  handleDown(event) {
    if (this.pointerId !== null) {
      this.multiTouch = true;
      return;
    }
    if (this.onIgnoreTarget(event.target)) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.mode = "tap-candidate";
    this.origin = { x: event.clientX, y: event.clientY };
    this.startedAt = this.getEventTime();
    this.multiTouch = false;
    this.element.setPointerCapture?.(event.pointerId);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.mode === "tap-candidate" && this.pointerId === event.pointerId && !this.multiTouch) {
        this.engageDrag();
      }
    }, HOLD_TO_ENGAGE_MS);
  }

  handleMove(event) {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    const displacement = this.displacement(event);
    if (this.mode === "tap-candidate" && displacement.distance > TAP_MAX_DISTANCE) {
      this.engageDrag();
    }
    if (this.mode !== "dragging") return;
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

  engageDrag() {
    if (this.mode === "dragging") return;
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.mode = "dragging";
    this.showBase();
    this.onEngagementChange?.(true);
  }

  handleEnd(event) {
    if (event?.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    if (this.pointerId === null) return;
    const mode = this.mode;
    const duration = this.getEventTime() - this.startedAt;
    const displacement = event ? this.displacement(event) : { distance: Infinity };
    const canTap = mode === "tap-candidate"
      && !this.multiTouch
      && duration <= TAP_MAX_MS
      && displacement.distance <= TAP_MAX_DISTANCE;
    this.reset();
    if (canTap) this.onTap?.();
  }

  handleCancel(event) {
    if (event?.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    this.reset();
  }

  displacement(event) {
    const dx = event.clientX - this.origin.x;
    const dy = event.clientY - this.origin.y;
    return { dx, dy, distance: Math.hypot(dx, dy) };
  }

  getEventTime() {
    return this.clock();
  }

  showBase() {
    const bounds = this.element.getBoundingClientRect();
    this.base.style.left = `${this.origin.x - bounds.left}px`;
    this.base.style.top = `${this.origin.y - bounds.top}px`;
    this.base.classList.add("is-active");
  }

  reset() {
    const wasActive = this.pointerId !== null;
    const wasDragging = this.mode === "dragging";
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.mode = "idle";
    this.multiTouch = false;
    if (pointerId !== null && this.element.hasPointerCapture?.(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.base.classList.remove("is-active");
    this.thumb.style.transform = "translate3d(0, 0, 0)";
    if (wasActive) this.onChange?.({ x: 0, y: 0 });
    if (wasDragging) this.onEngagementChange?.(false);
  }

  destroy() {
    this.reset();
    this.element.removeEventListener("pointerdown", this.handleDown);
    this.element.removeEventListener("pointermove", this.handleMove);
    this.element.removeEventListener("pointerup", this.handleEnd);
    this.element.removeEventListener("pointercancel", this.handleCancel);
    this.element.removeEventListener("lostpointercapture", this.handleCancel);
    window.removeEventListener("pagehide", this.reset);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }
}
