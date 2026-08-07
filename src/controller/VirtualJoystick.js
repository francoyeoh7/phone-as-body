import { clampJoystickPoint, normalizeJoystickWithDeadZone } from "../shared/joystick.js";

const TAP_MAX_DISTANCE = 10;
const HOLD_TO_ENGAGE_MS = 180;
const DEFAULT_DRAG_THRESHOLD_PX = 14;
const CROUCH_ENTRY_MS = 280;
const CROUCH_MIN_DOWN_PX = 48;
const CROUCH_MAX_HORIZONTAL_RATIO = 0.65;
const CROUCH_HOLD_MS = 180;

export class VirtualJoystick {
  constructor(element, {
    radius = 84,
    onChange,
    onEngagementChange,
    onTap,
    onIgnoreTarget = () => false,
    canStart = () => true,
    onReset,
    isBottomPoint = () => false,
    onCrouchChange,
    clock = () => performance.now(),
    dragThreshold = DEFAULT_DRAG_THRESHOLD_PX,
    movementDeadZone,
  }) {
    this.element = element;
    this.radius = Number.isFinite(radius) && radius > 1 ? radius : 84;
    this.onChange = onChange;
    this.onEngagementChange = onEngagementChange;
    this.onTap = onTap;
    this.onIgnoreTarget = onIgnoreTarget;
    this.canStart = canStart;
    this.onReset = onReset;
    this.isBottomPoint = isBottomPoint;
    this.onCrouchChange = onCrouchChange;
    this.clock = clock;
    const fallbackDragThreshold = Math.min(DEFAULT_DRAG_THRESHOLD_PX, this.radius - 1);
    this.dragThreshold = Number.isFinite(dragThreshold)
      && dragThreshold > 0
      && dragThreshold < this.radius
      ? dragThreshold
      : fallbackDragThreshold;
    this.movementDeadZone = Number.isFinite(movementDeadZone)
      && movementDeadZone >= this.dragThreshold
      && movementDeadZone < this.radius
      ? movementDeadZone
      : this.dragThreshold;
    this.pointerId = null;
    this.mode = "idle";
    this.origin = { x: 0, y: 0 };
    this.startedAt = 0;
    this.multiTouch = false;
    this.tapCancelled = false;
    this.holdTimer = null;
    this.crouchTimer = null;
    this.crouchGeneration = 0;
    this.crouching = false;
    this.startedInBottomRegion = false;
    this.lastPoint = null;
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
    if (!this.canStart(event)) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.mode = "tap-candidate";
    this.origin = { x: event.clientX, y: event.clientY };
    this.startedAt = this.getEventTime();
    this.multiTouch = false;
    this.tapCancelled = false;
    this.crouching = false;
    this.startedInBottomRegion = this.isBottomPoint(this.point(event));
    this.lastPoint = { x: event.clientX, y: event.clientY };
    this.element.setPointerCapture?.(event.pointerId);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.mode === "tap-candidate" && this.pointerId === event.pointerId && !this.multiTouch) {
        this.engageObservation();
      }
    }, HOLD_TO_ENGAGE_MS);
  }

  handleMove(event) {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.lastPoint = { x: event.clientX, y: event.clientY };
    if (this.crouching) return;
    const displacement = this.displacement(event);
    if (displacement.distance > TAP_MAX_DISTANCE) this.tapCancelled = true;
    if ((this.mode === "tap-candidate" || this.mode === "observing")
      && displacement.distance >= this.dragThreshold) {
      this.engageDrag();
    }
    if (this.mode !== "observing" && this.mode !== "dragging") return;
    this.update(event);
    this.updateCrouchCandidate(event, displacement);
  }

  update(event) {
    const input = {
      dx: event.clientX - this.origin.x,
      dy: event.clientY - this.origin.y,
      radius: this.radius,
    };
    const point = clampJoystickPoint(input);
    this.thumb.style.transform = `translate3d(${point.dx}px, ${point.dy}px, 0)`;
    this.onChange?.(normalizeJoystickWithDeadZone(input, this.movementDeadZone));
  }

  engageObservation() {
    if (this.mode !== "tap-candidate") return;
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.mode = "observing";
    this.showBase();
    this.onEngagementChange?.(true);
  }

  engageDrag() {
    if (this.mode === "dragging") return;
    const wasEngaged = this.mode === "observing";
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.mode = "dragging";
    if (!wasEngaged) {
      this.showBase();
      this.onEngagementChange?.(true);
    }
  }

  updateCrouchCandidate(event, displacement) {
    const point = this.point(event);
    if (this.crouchTimer && !this.isBottomPoint(point)) {
      clearTimeout(this.crouchTimer);
      this.crouchTimer = null;
      return;
    }
    if (this.crouchTimer
      || this.startedInBottomRegion
      || !this.isBottomPoint(point)
      || this.getEventTime() - this.startedAt > CROUCH_ENTRY_MS
      || displacement.dy < CROUCH_MIN_DOWN_PX
      || Math.abs(displacement.dx) > CROUCH_MAX_HORIZONTAL_RATIO * displacement.dy) return;

    const pointerId = this.pointerId;
    const generation = this.crouchGeneration;
    this.crouchTimer = setTimeout(() => {
      this.crouchTimer = null;
      if (generation !== this.crouchGeneration
        || pointerId !== this.pointerId
        || this.startedInBottomRegion
        || !this.lastPoint
        || !this.isBottomPoint(this.lastPoint)) return;
      this.crouching = true;
      this.onChange?.({ x: 0, y: 0 });
      this.onCrouchChange?.(true);
    }, CROUCH_HOLD_MS);
  }

  handleEnd(event) {
    if (event?.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    if (this.pointerId === null) return;
    const mode = this.mode;
    const duration = this.getEventTime() - this.startedAt;
    const displacement = event ? this.displacement(event) : { distance: Infinity };
    const canTap = mode === "tap-candidate"
      && !this.multiTouch
      && !this.tapCancelled
      && duration < HOLD_TO_ENGAGE_MS
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
    const wasEngaged = this.mode === "observing" || this.mode === "dragging";
    const wasCrouching = this.crouching;
    const pointerId = this.pointerId;
    this.crouchGeneration += 1;
    this.pointerId = null;
    this.mode = "idle";
    this.multiTouch = false;
    this.tapCancelled = false;
    this.crouching = false;
    this.startedInBottomRegion = false;
    this.lastPoint = null;
    if (pointerId !== null && this.element.hasPointerCapture?.(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    clearTimeout(this.crouchTimer);
    this.crouchTimer = null;
    this.base.classList.remove("is-active");
    this.thumb.style.transform = "translate3d(0, 0, 0)";
    if (wasActive) this.onChange?.({ x: 0, y: 0 });
    if (wasCrouching) this.onCrouchChange?.(false);
    if (wasEngaged) this.onEngagementChange?.(false);
    if (wasActive) this.onReset?.(pointerId);
  }

  point(event) {
    return { x: event.clientX, y: event.clientY };
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
