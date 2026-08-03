import { describe, expect, it, vi } from "vitest";
import {
  FoundPhoneUI,
  nextPhonePage,
  phoneSwipeDirection,
} from "../src/controller/FoundPhoneUI.js";

function createElement() {
  const listeners = new Map();
  const elements = new Map();
  const element = {
    hidden: true,
    dataset: {},
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
    querySelector: vi.fn((selector) => elements.get(selector)),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    dispatch(type, event = {}) {
      listeners.get(type)?.({
        pointerId: 1,
        clientX: 100,
        target: element,
        currentTarget: element,
        ...event,
      });
    },
  };
  for (const selector of ["[data-phone-title]", "[data-phone-body]", "[data-phone-page]"]) {
    elements.set(selector, { textContent: "" });
  }
  return { element, elements };
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
});
