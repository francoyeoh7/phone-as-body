const DEFAULTS = Object.freeze({
  edgeX: 0.82,
  swipeDistance: 0.18,
  swipeWindowMs: 900,
  horizontalDominance: 1.15,
  cursorWidth: 360,
  cursorHeight: 72,
  maxCursorDelta: 64,
  cancelRightward: 0.05,
  lossGraceMs: 240,
  dwellMs: 280,
  hoverDeadZone: 0.012,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finiteCenter(sample) {
  const center = sample?.pose?.center ?? sample?.gesturePose?.center ?? sample?.center;
  if (!Array.isArray(center) || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null;
  return { x: clamp(center[0], 0, 1), y: clamp(center[1], 0, 1) };
}

function isTracked(sample) {
  return sample?.state === "tracked" && finiteCenter(sample) !== null;
}

export class HandInventoryGesture {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
    this.getHoveredId = typeof options.getHoveredId === "function" ? options.getHoveredId : () => null;
    this.reset();
  }

  reset() {
    this.phase = "idle";
    this.candidate = null;
    this.lastPoint = null;
    this.lastSeenAt = null;
    this.hoveredId = null;
    this.hoverSince = null;
  }

  isCapturing() {
    return this.phase === "candidate" || this.phase === "open";
  }

  update(sample, now = 0, { canOpen = () => true, inventoryOpen = false } = {}) {
    const time = Number.isFinite(now) ? now : 0;
    const point = finiteCenter(sample);
    if (!isTracked(sample) || !point) {
      if (this.isCapturing() && Number.isFinite(this.lastSeenAt)
        && time - this.lastSeenAt >= this.options.lossGraceMs) {
        this.reset();
        this.emit({ type: "cancel", reason: "lost" });
      }
      return [];
    }

    this.lastSeenAt = time;
    if (inventoryOpen) {
      if (this.phase === "idle" || this.phase === "candidate") {
        this.phase = "open";
        this.candidate = null;
        this.lastPoint = point;
        this.hoveredId = null;
        this.hoverSince = null;
      }
    } else if (this.phase === "open") {
      this.reset();
      return [];
    }

    if (this.phase === "idle") {
      if (point.x >= this.options.edgeX && canOpen?.() !== false) {
        this.phase = "candidate";
        this.candidate = { start: point, startedAt: time };
        this.lastPoint = point;
      }
      return [];
    }

    if (this.phase === "candidate") {
      const candidate = this.candidate;
      const elapsed = time - candidate.startedAt;
      const leftward = candidate.start.x - point.x;
      const vertical = Math.abs(point.y - candidate.start.y);
      if (elapsed > this.options.swipeWindowMs) {
        this.reset();
        if (point.x >= this.options.edgeX && canOpen?.() !== false) {
          this.phase = "candidate";
          this.candidate = { start: point, startedAt: time };
          this.lastPoint = point;
        }
        return [];
      }
      if (leftward >= this.options.swipeDistance
        && leftward >= vertical * this.options.horizontalDominance) {
        this.phase = "open";
        this.lastPoint = point;
        this.candidate = null;
        this.hoveredId = null;
        this.hoverSince = null;
        const events = [this.emit({
          type: "open",
          entryY: clamp(candidate.start.y, 0, 1),
        })];
        const move = this.cursorDelta(point, candidate.start);
        if (move) events.push(this.emit({ type: "move", ...move }));
        return events.filter(Boolean);
      }
      this.lastPoint = point;
      return [];
    }

    if (this.phase !== "open") return [];
    const previous = this.lastPoint ?? point;
    const rightward = point.x - previous.x;
    if (rightward >= this.options.cancelRightward) {
      this.reset();
      return [this.emit({ type: "cancel", reason: "rightward" })];
    }
    const move = this.cursorDelta(point, previous);
    this.lastPoint = point;
    const events = [];
    if (move) events.push(this.emit({ type: "move", ...move }));

    const hoveredId = this.getHoveredId?.() ?? null;
    const movement = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (hoveredId && movement <= this.options.hoverDeadZone) {
      if (hoveredId !== this.hoveredId) {
        this.hoveredId = hoveredId;
        this.hoverSince = time;
      } else if (Number.isFinite(this.hoverSince) && time - this.hoverSince >= this.options.dwellMs) {
        this.reset();
        events.push(this.emit({ type: "commit", id: hoveredId }));
      }
    } else if (!hoveredId) {
      this.hoveredId = null;
      this.hoverSince = null;
    } else if (movement > this.options.hoverDeadZone) {
      this.hoveredId = hoveredId;
      this.hoverSince = time;
    }
    return events.filter(Boolean);
  }

  cursorDelta(next, previous) {
    const dx = clamp((next.x - previous.x) * this.options.cursorWidth,
      -this.options.maxCursorDelta, this.options.maxCursorDelta);
    const dy = clamp((next.y - previous.y) * this.options.cursorHeight,
      -this.options.maxCursorDelta, this.options.maxCursorDelta);
    if (dx === 0 && dy === 0) return null;
    return { dx, dy };
  }

  emit(event) {
    this.onEvent(event);
    return event;
  }
}

export { DEFAULTS as HAND_INVENTORY_GESTURE_DEFAULTS };
