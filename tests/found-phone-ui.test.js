import { describe, expect, it, vi } from "vitest";
import {
  FoundPhoneUI,
  nextPhonePage,
  phoneSwipeDirection,
} from "../src/controller/FoundPhoneUI.js";

function createElement() {
  const listeners = new Map();
  const elements = new Map();
  const captured = new Set();
  const createButton = () => {
    const buttonListeners = new Map();
    return {
      addEventListener: vi.fn((type, listener) => buttonListeners.set(type, listener)),
      removeEventListener: vi.fn((type) => buttonListeners.delete(type)),
      click() {
        buttonListeners.get("click")?.({ target: { closest: () => button } });
      },
    };
  };
  const element = {
    hidden: true,
    dataset: {},
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
    querySelector: vi.fn((selector) => elements.get(selector)),
    getBoundingClientRect: () => ({ left: 0, width: 300 }),
    setPointerCapture: vi.fn((pointerId) => captured.add(pointerId)),
    releasePointerCapture: vi.fn((pointerId) => captured.delete(pointerId)),
    dispatch(type, event = {}) {
      listeners.get(type)?.({
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        target: element,
        currentTarget: element,
        ...event,
      });
    },
  };
  for (const selector of ["[data-phone-title]", "[data-phone-body]", "[data-phone-page]"]) {
    elements.set(selector, { textContent: "" });
  }
  elements.set("[data-phone-previous]", createButton());
  elements.set("[data-phone-next]", createButton());
  return { element, elements, captured };
}

describe("found phone pager", () => {
  it("wraps navigation in either direction", () => {
    expect(nextPhonePage(0, -1, 3)).toBe(2);
    expect(nextPhonePage(2, 1, 3)).toBe(0);
  });

  it("classifies horizontal swipes with a 42px threshold", () => {
    expect(phoneSwipeDirection(180, 90, 42)).toBe(1);
    expect(phoneSwipeDirection(90, 180, 42)).toBe(-1);
    expect(phoneSwipeDirection(100, 120, 42)).toBe(0);
  });

  it("hides the overlay and resets to its first page when deactivated", () => {
    const { element, elements } = createElement();
    const phone = new FoundPhoneUI(element);

    phone.setActive(true);
    phone.next(1);
    phone.setActive(false);

    expect(element.hidden).toBe(true);
    expect(phone.page).toBe(0);
    expect(elements.get("[data-phone-page]").textContent).toBe("1 / 3");
    phone.destroy();
  });

  it("ignores a pointerup left over from before deactivation", () => {
    const { element } = createElement();
    const phone = new FoundPhoneUI(element);

    phone.setActive(true);
    element.dispatch("pointerdown", { pointerId: 7, clientX: 100 });
    phone.setActive(false);
    phone.setActive(true);
    element.dispatch("pointerup", { pointerId: 7, clientX: 180 });

    expect(phone.page).toBe(0);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(7);
    phone.destroy();
  });

  it("navigates with horizontal swipes, half-screen taps, and arrow buttons", () => {
    const { element, elements } = createElement();
    const phone = new FoundPhoneUI(element);
    phone.setActive(true);

    element.dispatch("pointerdown", { pointerId: 4, clientX: 90, clientY: 120 });
    element.dispatch("pointerup", { pointerId: 4, clientX: 150, clientY: 124 });
    expect(phone.page).toBe(1);

    element.dispatch("pointerdown", { pointerId: 5, clientX: 250, clientY: 120 });
    element.dispatch("pointerup", { pointerId: 5, clientX: 252, clientY: 124 });
    expect(phone.page).toBe(2);

    elements.get("[data-phone-previous]").click();
    expect(phone.page).toBe(1);
    phone.destroy();
  });

  it("ignores vertical and diagonal drags instead of treating them as taps", () => {
    const { element } = createElement();
    const phone = new FoundPhoneUI(element);
    phone.setActive(true);

    element.dispatch("pointerdown", { pointerId: 6, clientX: 100, clientY: 100 });
    element.dispatch("pointerup", { pointerId: 6, clientX: 106, clientY: 170 });
    expect(phone.page).toBe(0);

    element.dispatch("pointerdown", { pointerId: 7, clientX: 100, clientY: 100 });
    element.dispatch("pointerup", { pointerId: 7, clientX: 150, clientY: 170 });
    expect(phone.page).toBe(0);
    phone.destroy();
  });

  it("cleans pointer state on cancellation and rejects a stale pointerup after close and reopen", () => {
    const { element, captured } = createElement();
    const phone = new FoundPhoneUI(element);
    phone.setActive(true);

    element.dispatch("pointerdown", { pointerId: 8, clientX: 100, clientY: 100 });
    element.dispatch("pointercancel", { pointerId: 8 });
    expect(captured.has(8)).toBe(false);
    expect(phone.pointerId).toBeNull();
    expect(phone.startX).toBe(0);
    expect(phone.startY).toBe(0);
    expect(phone.movement).toEqual({ x: 0, y: 0 });

    element.dispatch("pointerdown", { pointerId: 9, clientX: 100, clientY: 100 });
    phone.setActive(false);
    phone.setActive(true);
    element.dispatch("pointerup", { pointerId: 9, clientX: 250, clientY: 100 });

    expect(captured.has(9)).toBe(false);
    expect(phone.page).toBe(0);
    phone.destroy();
  });
});
