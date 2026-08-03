const SWIPE_THRESHOLD = 42;
const TAP_SLOP = 12;

export const FOUND_PHONE_PAGES = Object.freeze([
  Object.freeze({
    kind: "messages",
    title: "消息",
    body: Object.freeze(["北门外的人不是保安。", "617 已经转移，不要回应敲门。"]),
  }),
  Object.freeze({
    kind: "note",
    title: "维修备忘",
    body: Object.freeze(["恢复供电后，紧急锁需要持续施压四秒。"]),
  }),
  Object.freeze({
    kind: "calls",
    title: "通话记录",
    body: Object.freeze(["617  未接来电  6 次", "语音转写：别让走廊尽头的门打开。"]),
  }),
]);

export function nextPhonePage(page, direction, count) {
  return ((page + direction) % count + count) % count;
}

export function phoneSwipeDirection(endX, startX, threshold = SWIPE_THRESHOLD) {
  const displacement = endX - startX;
  if (Math.abs(displacement) < threshold) return 0;
  return Math.sign(displacement);
}

export class FoundPhoneUI {
  constructor(element) {
    this.element = element;
    this.page = 0;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.movement = { x: 0, y: 0 };
    this.captureHeld = false;
    this.title = element.querySelector("[data-phone-title]");
    this.body = element.querySelector("[data-phone-body]");
    this.pageCount = element.querySelector("[data-phone-page]");
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handlePrevious = () => this.next(-1);
    this.handleNext = () => this.next(1);

    element.addEventListener("pointerdown", this.handlePointerDown);
    element.addEventListener("pointerup", this.handlePointerUp);
    element.addEventListener("pointercancel", this.handlePointerCancel);
    element.querySelector("[data-phone-previous]")?.addEventListener("click", this.handlePrevious);
    element.querySelector("[data-phone-next]")?.addEventListener("click", this.handleNext);
    this.render();
  }

  setActive(active) {
    this.element.hidden = !active;
    if (!active) {
      this.resetPointer();
      this.page = 0;
    }
    this.render();
  }

  next(direction) {
    this.page = nextPhonePage(this.page, direction, FOUND_PHONE_PAGES.length);
    this.render();
  }

  handlePointerDown(event) {
    if (this.pointerId !== null || event.target?.closest?.("button")) return;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.movement = { x: 0, y: 0 };
    if (this.element.setPointerCapture) {
      this.element.setPointerCapture(event.pointerId);
      this.captureHeld = true;
    }
  }

  handlePointerUp(event) {
    if (event.pointerId !== this.pointerId) return;
    this.movement = { x: event.clientX - this.startX, y: event.clientY - this.startY };
    const horizontalSwipe = Math.abs(this.movement.x) >= SWIPE_THRESHOLD
      && Math.abs(this.movement.x) > Math.abs(this.movement.y);
    const isTap = Math.max(Math.abs(this.movement.x), Math.abs(this.movement.y)) <= TAP_SLOP;
    if (horizontalSwipe) this.next(Math.sign(this.movement.x));
    else if (isTap) {
      const bounds = this.element.getBoundingClientRect();
      this.next(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
    }
    this.resetPointer();
  }

  handlePointerCancel(event) {
    if (event.pointerId === this.pointerId) this.resetPointer();
  }

  resetPointer() {
    if (this.captureHeld) this.element.releasePointerCapture?.(this.pointerId);
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.movement = { x: 0, y: 0 };
    this.captureHeld = false;
  }

  pulseBraceImpact() {
    this.element.classList.remove("brace-impact");
    void this.element.offsetWidth;
    this.element.classList.add("brace-impact");
  }

  render() {
    const page = FOUND_PHONE_PAGES[this.page];
    this.element.dataset.phonePage = page.kind;
    this.title.textContent = page.title;
    this.body.textContent = page.body.join("\n");
    this.pageCount.textContent = `${this.page + 1} / ${FOUND_PHONE_PAGES.length}`;
  }

  destroy() {
    this.setActive(false);
    this.element.removeEventListener("pointerdown", this.handlePointerDown);
    this.element.removeEventListener("pointerup", this.handlePointerUp);
    this.element.removeEventListener("pointercancel", this.handlePointerCancel);
    this.element.querySelector("[data-phone-previous]")?.removeEventListener("click", this.handlePrevious);
    this.element.querySelector("[data-phone-next]")?.removeEventListener("click", this.handleNext);
  }
}
