import { INVENTORY_DELTA_LIMIT } from "../shared/protocol.js";

const MOVE_INTERVAL_MS = 1000 / 30;

function consumePointer(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function clampDelta(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(INVENTORY_DELTA_LIMIT, Math.max(-INVENTORY_DELTA_LIMIT, value));
}

export class InventoryOrbController {
  constructor(element, {
    ownership,
    canOpen = () => true,
    onClaim,
    onOpen,
    onMove,
    onCommit,
    onCancel,
    onRelease,
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
    this.clock = clock;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.session = null;
  }

  pointerDown(event) {
    consumePointer(event);
    if (this.session || !this.canOpen?.()) return false;
    const displaced = this.ownership?.claimInventory?.(event.pointerId);
    if (displaced === null || displaced === false || displaced === undefined) return false;

    const target = event.currentTarget ?? this.element;
    this.session = {
      pointerId: event.pointerId,
      ownershipGeneration: this.ownership.generation,
      target,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      pendingX: 0,
      pendingY: 0,
      lastFlushAt: this.clock(),
      timer: null,
    };
    target?.setPointerCapture?.(event.pointerId);
    this.onClaim?.(displaced);
    this.onOpen?.();
    return true;
  }

  pointerMove(event) {
    consumePointer(event);
    const session = this.currentSession(event?.pointerId);
    if (!session) return false;
    this.accumulate(session, event);
    this.scheduleFlush(session);
    return true;
  }

  pointerUp(event) {
    consumePointer(event);
    const session = this.currentSession(event?.pointerId);
    if (!session) return false;
    this.accumulate(session, event);
    this.clearFlushTimer(session);
    this.flush(session);
    return this.finish(session, "commit");
  }

  pointerCancel(event) {
    consumePointer(event);
    if (!this.currentSession(event?.pointerId)) return false;
    return this.cancel();
  }

  cancel() {
    const session = this.session;
    if (!session) return false;
    this.clearFlushTimer(session);
    session.pendingX = 0;
    session.pendingY = 0;
    return this.finish(session, "cancel");
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

  accumulate(session, event) {
    const nextX = Number.isFinite(event?.clientX) ? event.clientX : session.lastX;
    const nextY = Number.isFinite(event?.clientY) ? event.clientY : session.lastY;
    session.pendingX += nextX - session.lastX;
    session.pendingY += nextY - session.lastY;
    session.lastX = nextX;
    session.lastY = nextY;
    if (session.target?.style) {
      session.target.style.transform = `translate3d(${nextX - session.startX}px, ${nextY - session.startY}px, 0)`;
    }
  }

  scheduleFlush(session) {
    if (session.timer !== null) return;
    const elapsed = this.clock() - session.lastFlushAt;
    const delay = Math.max(0, MOVE_INTERVAL_MS - elapsed);
    session.timer = this.setTimeout(() => {
      session.timer = null;
      if (this.session !== session) return;
      this.flush(session);
    }, delay);
  }

  clearFlushTimer(session) {
    if (session.timer === null) return;
    this.clearTimeout(session.timer);
    session.timer = null;
  }

  flush(session) {
    const dx = clampDelta(session.pendingX);
    const dy = clampDelta(session.pendingY);
    session.pendingX = 0;
    session.pendingY = 0;
    session.lastFlushAt = this.clock();
    if (dx === 0 && dy === 0) return false;
    this.onMove?.({ dx, dy });
    return true;
  }

  finish(session, phase) {
    if (this.session !== session) return false;
    this.session = null;
    if (session.target?.style) session.target.style.transform = "translate3d(0, 0, 0)";
    if (phase === "commit") this.onCommit?.();
    else this.onCancel?.();
    this.ownership?.release?.("inventory", session.pointerId, session.ownershipGeneration);
    if (session.target?.hasPointerCapture?.(session.pointerId) !== false) {
      session.target?.releasePointerCapture?.(session.pointerId);
    }
    this.onRelease?.(phase);
    return true;
  }
}
