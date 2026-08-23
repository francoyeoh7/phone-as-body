import { describe, expect, it } from "vitest";
import {
  createTradeSession,
  offerBid,
  respondToCounter,
  reBid,
  closeTrade,
  botOfferList,
} from "../src/desktop/game/trade-session.js";
import { rollBotStock } from "../src/desktop/game/TradeDirector.js";

function makeSession() {
  return createTradeSession({
    botId: "bot-1",
    botName: "猎手",
    botItems: [{ id: "watch-0", label: "旧怀表" }],
    botValues: { "watch-0": 100 },
    seed: 7,
  });
}

describe("trade session", () => {
  it("requires bot stock and rejects empty shelves", () => {
    expect(() => createTradeSession({ botId: "b", botName: "b", botItems: [] })).toThrow(TypeError);
  });

  it("accepts a bid at or above fair value", () => {
    const session = makeSession();
    const { reply } = offerBid(session, "watch-0", 150);
    expect(reply.status).toBe("accepted");
    expect(session.status).toBe("dealt");
  });

  it("rejects an insulting lowball", () => {
    const session = makeSession();
    const { reply } = offerBid(session, "watch-0", 10);
    expect(reply.status).toBe("rejected");
    expect(session.status).toBe("browsing");
    expect(session.pendingBid).toBeNull();
  });

  it("counters a near-fair bid and the human can accept the counter", () => {
    const session = makeSession();
    const { reply } = offerBid(session, "watch-0", 70);
    expect(reply.status).toBe("counter");
    expect(reply.price).toBeGreaterThan(70);
    expect(session.status).toBe("negotiating");

    const result = respondToCounter(session, "accept");
    expect(result.dealt).toBe(true);
    expect(result.price).toBe(reply.price);
    expect(session.status).toBe("dealt");
  });

  it("lets the human reject a counter and walk away", () => {
    const session = makeSession();
    offerBid(session, "watch-0", 70);
    const result = respondToCounter(session, "reject");
    expect(result.dealt).toBe(false);
    expect(session.status).toBe("browsing");
  });

  it("supports re-bidding after a counter until a deal", () => {
    const session = makeSession();
    offerBid(session, "watch-0", 60);
    const again = reBid(session, 200);
    expect(again.ok).toBe(true);
    expect(again.reply.status).toBe("accepted");
    expect(session.status).toBe("dealt");
  });

  it("blocks bids after the session is dealt or closed", () => {
    const session = makeSession();
    offerBid(session, "watch-0", 150);
    expect(offerBid(session, "watch-0", 150).ok).toBe(false);
    closeTrade(session);
    expect(offerBid(session, "watch-0", 150).ok).toBe(false);
  });

  it("lists the bot shelf with pending prices", () => {
    const session = makeSession();
    offerBid(session, "watch-0", 70);
    const list = botOfferList(session);
    expect(list[0].pendingPrice).toBeGreaterThan(70);
  });

  it("rolls deterministic bot stock", () => {
    const a = rollBotStock(() => 0.1);
    const b = rollBotStock(() => 0.1);
    expect(a).toEqual(b);
    expect(a.items.length).toBeGreaterThan(0);
  });
});
