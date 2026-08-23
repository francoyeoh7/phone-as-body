// Generic in-game menu panels: player interaction options, pickpocket, the
// crafting station, and the bulletin board all share one overlay shell.
import { RECIPES, MATERIAL_LABELS, canCraft } from "./crafting.js";
import { pickpocketOptions } from "./pickpocket.js";

export class GamePanels {
  constructor({ ui }) {
    this.ui = ui;
    this.onAction = null;
    this.bound = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    const el = this.ui.elements;
    el.optionCancel?.addEventListener?.("click", () => this.close());
  }

  get isOpen() {
    return !this.ui.elements.optionMenu?.hidden;
  }

  // options: [{ id, label, hint, disabled, digit }]
  open({ title, options, onSelect, footer = "", priceInput = false }) {
    const el = this.ui.elements;
    if (!el.optionMenu) return;
    this.onSelect = onSelect;
    this.digitMap = new Map();
    el.optionTarget.textContent = title;
    const priceRow = el.optionPriceRow;
    if (priceRow) {
      priceRow.hidden = !priceInput;
      if (priceInput && el.optionPrice) {
        el.optionPrice.value = "";
        setTimeout(() => el.optionPrice?.focus?.(), 0);
      }
    }
    // Rebuild the button list generically (keep the cancel button).
    const card = el.optionCard ?? el.optionMenu.querySelector(".option-card");
    for (const old of card.querySelectorAll(".option-button:not(.option-cancel)")) old.remove();
    const footerEl = card.querySelector(".option-footer");
    if (footerEl) footerEl.remove();
    const anchor = card.querySelector(".option-cancel");
    for (const option of options) {
      const button = document.createElement("button");
      button.className = "option-button";
      button.disabled = option.disabled === true;
      button.innerHTML = option.digit
        ? `<span><kbd class="digit">${option.digit}</kbd> ${option.label}</span>${option.hint ? `<em>${option.hint}</em>` : ""}`
        : `<span>${option.label}</span>${option.hint ? `<em>${option.hint}</em>` : ""}`;
      button.addEventListener("click", () => this.select(option.id));
      card.insertBefore(button, anchor ?? null);
      if (option.digit) this.digitMap.set(String(option.digit), option.id);
    }
    if (footer) {
      const note = document.createElement("p");
      note.className = "option-footer";
      note.textContent = footer;
      card.insertBefore(note, anchor ?? null);
    }
    el.optionMenu.hidden = false;
    document.exitPointerLock?.();
  }

  select(id) {
    this.close();
    this.onSelect?.(id);
  }

  // Digit keys while a menu is open map to options tagged with a digit.
  handleDigit(key) {
    if (this.isOpen && this.digitMap?.has(key)) {
      this.select(this.digitMap.get(key));
      return true;
    }
    return false;
  }

  close() {
    if (this.ui.elements.optionMenu) this.ui.elements.optionMenu.hidden = true;
    this.onSelect = null;
    this.digitMap = new Map();
  }
}

// --- Option builders (data only, easy to test) ---
export function botOptionMenu({ crouched }) {
  if (crouched) {
    return {
      title: "偷窃",
      options: [
        ...pickpocketOptions().map((option) => ({ id: `pickpocket-${option.id}`, label: option.label, digit: option.key })),
        { id: "cancel", label: "算了" },
      ],
    };
  }
  return {
    title: "与对方互动",
    options: [
      { id: "trade", label: "交易" },
      { id: "contest", label: "比赛" },
      { id: "cancel", label: "取消" },
    ],
  };
}

export function craftMenu(state, playerId) {
  return {
    title: "合成台",
    options: [
      ...RECIPES.map((recipe) => {
        const needs = Object.entries(recipe.materials)
          .map(([material, count]) => `${MATERIAL_LABELS[material]}×${count}`)
          .join(" + ");
        return {
          id: `craft-${recipe.id}`,
          label: recipe.label,
          hint: needs,
          disabled: !canCraft(state, playerId, recipe.id),
        };
      }),
      { id: "cancel", label: "离开" },
    ],
  };
}

export function boardMenu(board, playerId) {
  const open = board.tasks.filter((task) => !task.done && !task.claimedBy);
  const mine = board.tasks.filter((task) => !task.done && task.claimedBy === playerId);
  const listings = board.listings.filter((listing) => !listing.sold && listing.sellerId !== playerId);
  return {
    title: "公告栏",
    options: [
      ...open.map((task) => ({ id: `claim-${task.id}`, label: `[任务] ${task.description}`, hint: `+${task.reward} 金币` })),
      ...mine.map((task) => ({ id: `complete-${task.id}`, label: `[交任务] ${task.description}`, hint: `+${task.reward} 金币` })),
      ...listings.map((listing) => ({ id: `buy-${listing.id}`, label: `[购买] ${listing.label}`, hint: `${listing.price} 金币` })),
      { id: "sell", label: "挂售我的道具" },
      { id: "cancel", label: "离开" },
    ],
  };
}
