// Trade negotiation state machine. Pure logic — no three.js, no DOM.
// One human bargains with one bot: bid coins on a bot item, the bot accepts,
// rejects, or counters, and the human can accept/reject/re-bid in return.

export function createTradeSession({ botId, botName, botItems, botValues, seed = 1 } = {}) {
  if (!Array.isArray(botItems) || botItems.length === 0) throw new TypeError("bot needs items to trade");
  let rngState = seed >>> 0 || 1;
  const random = () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    botId,
    botName,
    botItems: botItems.map((item) => ({ ...item })),
    botValues: { ...(botValues ?? {}) },
    random,
    pendingBid: null, // { itemId, price, round }
    status: "browsing", // browsing | negotiating | dealt | rejected | closed
    log: [],
  };
}

function botItemValue(session, itemId) {
  return session.botValues[itemId] ?? 50;
}

// The human bids `price` for the bot's item. The bot answers in one step.
export function offerBid(session, itemId, price) {
  if (session.status === "dealt" || session.status === "closed") return { ok: false, reason: "finished" };
  const item = session.botItems.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, reason: "no-item" };
  const value = botItemValue(session, itemId);
  const bid = Math.max(1, Math.round(Number(price) || 0));
  session.status = "negotiating";
  session.pendingBid = { itemId, price: bid, round: 1 };

  // Bot mood: a little deterministic variance keeps counters from feeling scripted.
  const mood = 0.95 + session.random() * 0.15;
  const fair = value * mood;
  let reply;
  if (bid >= fair) {
    reply = { status: "accepted", price: bid };
  } else if (bid >= fair * 0.6) {
    reply = { status: "counter", price: Math.max(bid + 1, Math.round(fair)) };
  } else {
    reply = { status: "rejected" };
  }
  session.log.push({ from: "you", itemId, price: bid });
  session.log.push({ from: session.botId, ...reply });
  if (reply.status === "accepted") session.status = "dealt";
  if (reply.status === "rejected") session.status = "browsing";
  session.pendingBid = reply.status === "counter" ? { itemId, price: bid, counterPrice: reply.price, round: 1 } : null;
  return { ok: true, reply, item };
}

// The bot countered; the human answers.
export function respondToCounter(session, response) {
  if (session.status !== "negotiating" || !session.pendingBid) return { ok: false, reason: "no-counter" };
  const { itemId, counterPrice } = session.pendingBid;
  if (response === "accept") {
    session.log.push({ from: "you", itemId, price: counterPrice, accepted: true });
    session.status = "dealt";
    session.pendingBid = null;
    return { ok: true, dealt: true, itemId, price: counterPrice };
  }
  if (response === "reject") {
    session.log.push({ from: "you", itemId, rejected: true });
    session.status = "browsing";
    session.pendingBid = null;
    return { ok: true, dealt: false };
  }
  return { ok: false, reason: "unknown-response" };
}

// The human re-bids on the same item after a counter.
export function reBid(session, price) {
  if (!session.pendingBid) return offerBid(session, session.log.findLast?.((e) => e.from === "you")?.itemId, price);
  const itemId = session.pendingBid.itemId;
  session.pendingBid = null;
  session.status = "browsing";
  return offerBid(session, itemId, price);
}

export function closeTrade(session) {
  session.status = "closed";
  session.pendingBid = null;
}

// What the bot is currently offering (for the trade window).
export function botOfferList(session) {
  return session.botItems.map((item) => ({
    ...item,
    pendingPrice: session.pendingBid?.itemId === item.id ? session.pendingBid.counterPrice ?? session.pendingBid.price : null,
  }));
}
