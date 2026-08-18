import { INVENTORY_DELTA_LIMIT } from "../shared/protocol.js";

const MOVE_INTERVAL_MS = 1000 / 30;
const ACTIVATION_DISTANCE_PX = 44;
const ACTIVATION_WINDOW_MS = 260;
const HORIZONTAL_DOMINANCE = 1.25;
// The desktop bar is capped at 360px and its 5px cursor radius leaves a
// 350px usable horizontal span. Small phones need a proportional boost so a
// full-width finger swipe still reaches that span.
const INVENTORY_CURSOR_TRAVEL_PX = 350;

function consumePointer(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function clampDelta(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(INVENTORY_DELTA_LIMIT, Math.max(-INVENTORY_DELTA_LIMIT, value));
}

function roundDelta(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

export class InventoryEdgeController {
  constructor(element, {
    ownership,
    canOpen = () => true,
    onClaim,
    onOpen,
    onMove,
    onCommit,
    onCancel,
    onRelease,
    viewport = () => ({ width: window.innerWidth, height: window.innerHeight }),
    clock = () => performance.now(),
    setTimeout = (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout = (timer) => window.clearTimeout(timer),
  } = {}) {
    this.element = element;
    this.ownership = ownership;
    this.canOpen = canOpen;
    this.onClaim = onClaim;
    this.onOpen = onOpen;
    this.onMove = onMove;
    this.onCommit = onCommit;
    this.onCancel = onCancel;
    this.onRelease = onRelease;
    this.viewport = viewport;
    this.clock = clock;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.session = null;
  }

  pointerDown(event) {
    if (this.session || !this.isInEdge(event) || !this.canOpen?.()) return false;
    consumePointer(event);
    const displaced = this.ownership?.claimInventory?.(event.pointerId);
    if (displaced === null || displaced === false || displaced === undefined) return false;

    const target = event.currentTarget ?? this.element;
    const startX = Number.isFinite(event.clientX) ? event.clientX : 0;
    this.session = {
      pointerId: event.pointerId,
      ownershipGeneration: this.ownership.generation,
      target,
      startX,
      startY: event.clientY,
      startedAt: this.clock(),
      lastX: event.clientX,
      lastY: event.clientY,
      pendingX: 0,
      pendingY: 0,
      lastFlushAt: this.clock(),
      timer: null,
      activated: false,
      horizontalScale: startX > 0
        ? Math.max(1, INVENTORY_CURSOR_TRAVEL_PX / startX)
        : 1,
    };
    try {
      target?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is optional on a few mobile WebKit versions. The
      // session can still finish through pointerup/pointercancel.
    }
    this.onClaim?.(displaced);
    return true;
  }

  pointerMove(event) {
    const session = this.currentSession(event?.pointerId);
    if (!session) return false;
    consumePointer(event);
    const nextX = Number.isFinite(event.clientX) ? event.clientX : session.lastX;
    const nextY = Number.isFinite(event.clientY) ? event.clientY : session.lastY;

    if (!session.activated) {
      const leftward = session.startX - nextX;
      const vertical = Math.abs(nextY - session.startY);
      const elapsed = this.clock() - session.startedAt;
      if (elapsed <= ACTIVATION_WINDOW_MS
        && leftward >= ACTIVATION_DISTANCE_PX
        && leftward >= vertical * HORIZONTAL_DOMINANCE) {
        session.activated = true;
        const height = this.viewport()?.height;
        this.onOpen?.({ entryY: clampUnit(session.startY / (height > 0 ? height : 1)) });
        this.emitMovement(
          (nextX - session.startX) * session.horizontalScale,
          nextY - session.startY,
        );
        session.lastFlushAt = this.clock();
      }
      session.lastX = nextX;
      session.lastY = nextY;
      return session.activated;
    }

    this.accumulate(session, nextX, nextY);
    this.scheduleFlush(session);
    return true;
  }

  pointerUp(event) {
    const session = this.currentSession(event?.pointerId);
    if (!session) return false;
    consumePointer(event);
    if (session.activated) {
      this.accumulate(session, event.clientX, event.clientY);
      this.clearFlushTimer(session);
      this.flush(session);
    }
    return this.finish(session, session.activated ? "commit" : "candidate");
  }

  pointerCancel(event) {
    if (!this.currentSession(event?.pointerId)) return false;
    consumePointer(event);
    return this.cancel();
  }

  pointerCaptureLost(event) {
    consumePointer(event);
    if (!this.currentSession(event?.pointerId)) return false;
    // Mobile browsers can transiently drop capture while a finger remains
    // down. pointerup/pointercancel are the authoritative end signals.
    return true;
  }

  cancel() {
    const session = this.session;
    if (!session) return false;
    this.clearFlushTimer(session);
    session.pendingX = 0;
    session.pendingY = 0;
    return this.finish(session, session.activated ? "cancel" : "candidate");
  }

  isInEdge(event) {
    const bounds = this.element?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    return event.clientX >= bounds.left && event.clientX <= bounds.left + bounds.width
      && event.clientY >= bounds.top && event.clientY <= bounds.top + bounds.height;
  }

  currentSession(pointerId) {
    const session = this.session;
    if (!session || session.pointerId !== pointerId) return null;
    if (this.ownership?.generation !== session.ownershipGeneration
      || this.ownership?.inventoryId !== session.pointerId) {
      this.cancel();
      return null;
    }
    return session;
  }

  accumulate(session, nextX, nextY) {
    const x = Number.isFinite(nextX) ? nextX : session.lastX;
    const y = Number.isFinite(nextY) ? nextY : session.lastY;
    session.pendingX += x - session.lastX;
    session.pendingY += y - session.lastY;
    session.lastX = x;
    session.lastY = y;
  }

  scheduleFlush(session) {
    if (session.timer !== null) return;
    const elapsed = this.clock() - session.lastFlushAt;
    session.timer = this.setTimeout(() => {
      session.timer = null;
      if (this.session === session) this.flush(session);
    }, Math.max(0, MOVE_INTERVAL_MS - elapsed));
  }

  clearFlushTimer(session) {
    if (session.timer === null) return;
    this.clearTimeout(session.timer);
    session.timer = null;
  }

  flush(session) {
    const dx = session.pendingX * session.horizontalScale;
    const dy = session.pendingY;
    session.pendingX = 0;
    session.pendingY = 0;
    session.lastFlushAt = this.clock();
    return this.emitMovement(dx, dy);
  }

  emitMovement(dx, dy) {
    const safeX = roundDelta(Number.isFinite(dx) ? dx : 0);
    const safeY = roundDelta(Number.isFinite(dy) ? dy : 0);
    const largestAxis = Math.max(Math.abs(safeX), Math.abs(safeY));
    if (largestAxis === 0) return false;

    // Keep every wire packet within the protocol limit without discarding
    // distance when a browser coalesces many pointer samples into one event.
    const parts = Math.max(1, Math.ceil(largestAxis / INVENTORY_DELTA_LIMIT));
    let sentX = 0;
    let sentY = 0;
    for (let index = 1; index <= parts; index += 1) {
      const nextX = safeX * (index / parts);
      const nextY = safeY * (index / parts);
      const partX = clampDelta(nextX - sentX);
      const partY = clampDelta(nextY - sentY);
      sentX += partX;
      sentY += partY;
      if (partX !== 0 || partY !== 0) this.onMove?.({ dx: partX, dy: partY });
    }
    return true;
  }

  finish(session, phase) {
    if (this.session !== session) return false;
    this.session = null;
    if (phase === "commit") this.onCommit?.();
    if (phase === "cancel") this.onCancel?.();
    this.ownership?.release?.("inventory", session.pointerId, session.ownershipGeneration);
    if (session.target?.hasPointerCapture?.(session.pointerId) !== false) {
      try {
        session.target?.releasePointerCapture?.(session.pointerId);
      } catch {
        // Capture may already have been released by the browser.
      }
    }
    this.onRelease?.(phase);
    return true;
  }
}
