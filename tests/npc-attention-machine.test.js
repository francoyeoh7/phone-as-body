import { describe, expect, it, vi } from "vitest";
import { ATTENTION_STATES, NpcAttentionMachine } from "../src/shared/npc-attention-machine.js";

describe("NpcAttentionMachine", () => {
  function create() {
    let now = 1_000;
    return {
      machine: new NpcAttentionMachine({ now: () => now, followUpMs: 5_000 }),
      advance(ms) { now += ms; },
    };
  }

  it("requires notice and acknowledgement before awaiting intent", () => {
    const { machine } = create();
    const token = machine.startCapture();
    expect(machine.state).toBe(ATTENTION_STATES.CAPTURING_CALLOUT);
    expect(machine.notice({ npcId: "mara", hearingRadius: 8.5 }, token)).toBe(true);
    expect(machine.state).toBe(ATTENTION_STATES.NPC_NOTICED);
    expect(machine.acknowledged(token)).toBe(true);
    expect(machine.state).toBe(ATTENTION_STATES.AWAITING_INTENT);
  });

  it("never opens conversation from the first callout", () => {
    const { machine } = create();
    const token = machine.startCapture();
    machine.notice({ npcId: "mara", hearingRadius: 8.5, openingUtterance: "help me" }, token);
    expect(machine.state).toBe(ATTENTION_STATES.NPC_NOTICED);
    expect(machine.consumeConversationRequest()).toBeNull();
  });

  it("hands a clear follow-up to conversation exactly once", () => {
    const { machine } = create();
    const token = machine.startCapture();
    machine.notice({ npcId: "bram", hearingRadius: 7 }, token);
    machine.acknowledged(token);
    expect(machine.submitIntent({ kind: "engage", utterance: "请帮我修钥匙" }, token)).toBe(true);
    expect(machine.state).toBe(ATTENTION_STATES.CONVERSATION_REQUESTED);
    expect(machine.consumeConversationRequest()).toEqual({ npcId: "bram", utterance: "请帮我修钥匙", generation: token });
    expect(machine.consumeConversationRequest()).toBeNull();
  });

  it("allows one clarification and times out on the second ambiguity", () => {
    const { machine } = create();
    const token = machine.startCapture();
    machine.notice({ npcId: "elowen", hearingRadius: 8 }, token);
    machine.acknowledged(token);
    machine.submitIntent({ kind: "ambiguous", utterance: "呃" }, token);
    expect(machine.state).toBe(ATTENTION_STATES.CLARIFYING_INTENT);
    expect(machine.clarificationDelivered(token)).toBe(true);
    expect(machine.state).toBe(ATTENTION_STATES.AWAITING_INTENT);
    machine.submitIntent({ kind: "ambiguous", utterance: "嗯" }, token);
    expect(machine.state).toBe(ATTENTION_STATES.TIMED_OUT);
  });

  it("honors cancellation and distance cancellation", () => {
    const first = create().machine;
    let token = first.startCapture();
    first.notice({ npcId: "mara", hearingRadius: 8 }, token);
    first.acknowledged(token);
    first.submitIntent({ kind: "cancel", utterance: "算了" }, token);
    expect(first.state).toBe(ATTENTION_STATES.CANCELLED);

    const second = create().machine;
    token = second.startCapture();
    second.notice({ npcId: "mara", hearingRadius: 8 }, token);
    second.acknowledged(token);
    expect(second.updateDistance(10.01, token)).toBe(true);
    expect(second.state).toBe(ATTENTION_STATES.CANCELLED);
  });

  it("times out the follow-up window", () => {
    const { machine, advance } = create();
    const token = machine.startCapture();
    machine.notice({ npcId: "mara", hearingRadius: 8 }, token);
    machine.acknowledged(token);
    advance(5_001);
    expect(machine.tick()).toBe(true);
    expect(machine.state).toBe(ATTENTION_STATES.TIMED_OUT);
  });

  it("invalidates late async work with generation tokens", () => {
    const { machine } = create();
    const stale = machine.startCapture();
    const current = machine.startCapture();
    expect(current).toBe(stale + 1);
    expect(machine.notice({ npcId: "mara", hearingRadius: 8 }, stale)).toBe(false);
    expect(machine.notice({ npcId: "bram", hearingRadius: 8 }, current)).toBe(true);
    expect(machine.npcId).toBe("bram");
  });

  it("publishes immutable transition snapshots", () => {
    const onChange = vi.fn();
    const machine = new NpcAttentionMachine({ onChange });
    machine.startCapture();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(onChange.mock.calls[0][0])).toBe(true);
  });
});
