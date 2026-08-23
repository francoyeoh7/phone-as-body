import {
  createTradeSession,
  offerBid,
  respondToCounter,
  reBid,
  closeTrade,
  botOfferList,
} from "./trade-session.js";

// Bot sellable stock pool (id, label, hidden fair value in coins).
const BOT_STOCK_POOL = [
  { id: "part", label: "任务零件", value: 90 },
  { id: "toolkit", label: "工具包", value: 130 },
  { id: "watch", label: "旧怀表", value: 170 },
  { id: "pouch", label: "钱袋", value: 110 },
];

export function rollBotStock(rng = Math.random, count = 2) {
  const pool = [...BOT_STOCK_POOL];
  const items = [];
  const values = {};
  for (let index = 0; index < count && pool.length > 0; index += 1) {
    const pick = Math.floor(rng() * pool.length);
    const [entry] = pool.splice(pick, 1);
    items.push({ id: `${entry.id}-${index}`, label: entry.label });
    values[`${entry.id}-${index}`] = entry.value;
  }
  return { items, values };
}

export class TradeDirector {
  constructor({ ui, audio, getLocalCoins, spendLocalCoins, getLocalItems, receiveLocalItem }) {
    this.ui = ui;
    this.audio = audio;
    this.getLocalCoins = getLocalCoins;
    this.spendLocalCoins = spendLocalCoins;
    this.getLocalItems = getLocalItems;
    this.receiveLocalItem = receiveLocalItem;
    this.session = null;
    this.selectedItemId = null;
    this.botStock = new Map();
    this.bound = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    const el = this.ui.elements;
    const on = (element, event, handler) => element?.addEventListener?.(event, handler);
    on(el.tradeClose, "click", () => this.closeTrade());
    on(el.tradeBid, "click", () => this.submitBid());
    on(el.tradePrice, "keydown", (event) => {
      if (event.key === "Enter") this.submitBid();
    });
    on(el.tradeAccept, "click", () => this.respond(true));
    on(el.tradeReject, "click", () => this.respond(false));
  }

  stockFor(botId) {
    if (!this.botStock.has(botId)) this.botStock.set(botId, rollBotStock());
    return this.botStock.get(botId);
  }

  openTrade(bot) {
    if (!bot?.alive) return;
    this.activeBot = bot;
    const stock = this.stockFor(bot.id);
    this.session = createTradeSession({
      botId: bot.id,
      botName: bot.name,
      botItems: stock.items,
      botValues: stock.values,
      seed: (Date.now() ^ 0x2545f491) >>> 0,
    });
    this.selectedItemId = null;
    const el = this.ui.elements;
    el.tradeTitle.textContent = `与 ${bot.name} 交易`;
    el.tradeStatus.textContent = "挑一样对方的东西，出个价。";
    el.tradeRespondRow.hidden = true;
    el.tradePrice.value = "";
    this.renderTrade();
    el.tradeOverlay.hidden = false;
    document.exitPointerLock?.();
  }

  renderTrade() {
    const el = this.ui.elements;
    const session = this.session;
    if (!session) return;
    el.tradeMyCoins.textContent = String(this.getLocalCoins());
    // bot's shelf
    el.tradeBotItems.innerHTML = "";
    for (const item of botOfferList(session)) {
      const button = document.createElement("button");
      button.className = "trade-item";
      if (item.id === this.selectedItemId) button.classList.add("selected");
      button.disabled = session.status === "dealt";
      button.innerHTML = `<span>${item.label}</span><span class="item-price">${item.pendingPrice != null ? `报价 ${item.pendingPrice}` : ""}</span>`;
      button.addEventListener("click", () => {
        this.selectedItemId = item.id;
        el.tradeBidLabel.textContent = `出价买【${item.label}】`;
        this.renderTrade();
      });
      el.tradeBotItems.appendChild(button);
    }
    // my backpack (display only; you sell nothing here)
    el.tradeMyItems.innerHTML = "";
    const myItems = this.getLocalItems?.() ?? [];
    if (myItems.length === 0) {
      el.tradeMyItems.innerHTML = `<div class="trade-item" style="cursor:default;opacity:.6">背包空空</div>`;
    }
    for (const item of myItems) {
      const row = document.createElement("div");
      row.className = "trade-item";
      row.style.cursor = "default";
      row.innerHTML = `<span>${item.label ?? item.id}</span>`;
      el.tradeMyItems.appendChild(row);
    }
  }

  submitBid() {
    const session = this.session;
    const el = this.ui.elements;
    if (!session || session.status === "dealt") return;
    if (!this.selectedItemId) {
      el.tradeStatus.textContent = "先点选一样对方的东西。";
      return;
    }
    const price = Number(el.tradePrice.value);
    if (!Number.isFinite(price) || price <= 0) {
      el.tradeStatus.textContent = "填个正数金币。";
      return;
    }
    if (price > this.getLocalCoins()) {
      el.tradeStatus.textContent = "你没那么多金币。";
      return;
    }
    const { reply, item } = offerBid(session, this.selectedItemId, price);
    this.audio?.cue?.("ui-tick");
    if (reply.status === "accepted") {
      this.deal(item.id, reply.price);
    } else if (reply.status === "counter") {
      el.tradeStatus.textContent = `${session.botName} 嫌少，回价 ${reply.price} 金币。`;
      el.tradeCounterLabel.textContent = `对方要价 ${reply.price}`;
      el.tradeRespondRow.hidden = false;
    } else {
      el.tradeStatus.textContent = `${session.botName} 摇头拒绝了。可以换个价再试。`;
    }
    this.renderTrade();
  }

  respond(accept) {
    const session = this.session;
    const el = this.ui.elements;
    if (!session) return;
    const result = respondToCounter(session, accept ? "accept" : "reject");
    el.tradeRespondRow.hidden = true;
    if (result.dealt) {
      this.deal(result.itemId, result.price);
    } else {
      el.tradeStatus.textContent = "你拒绝了回价，交易告吹。";
      el.tradeBidLabel.textContent = "未选中物品";
    }
    this.renderTrade();
  }

  deal(itemId, price) {
    const session = this.session;
    const el = this.ui.elements;
    const item = session.botItems.find((entry) => entry.id === itemId);
    if (!this.spendLocalCoins(price)) {
      el.tradeStatus.textContent = "金币不够，交易失败。";
      return;
    }
    // Item transfers: bot loses it, I gain it.
    session.botItems = session.botItems.filter((entry) => entry.id !== itemId);
    this.receiveLocalItem?.(itemId, item?.label);
    el.tradeStatus.textContent = `成交！你用 ${price} 金币买到了${item ? `【${item.label}】` : "它"}。`;
    this.audio?.cue?.("objective");
    this.renderTrade();
  }

  closeTrade() {
    if (this.session) closeTrade(this.session);
    this.session = null;
    this.selectedItemId = null;
    this.ui.elements.tradeOverlay.hidden = true;
  }

  get isOpen() {
    return !this.ui.elements.tradeOverlay?.hidden;
  }
}
