import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ATTENTION_STATES } from "../src/shared/npc-attention-machine.js";
import { NpcConversationCoordinator } from "../src/desktop/npc/NpcConversationCoordinator.js";
import { NpcPerformer } from "../src/desktop/npc/NpcPerformer.js";
import { createNpcRoster } from "../src/desktop/npc/npc-roster.js";

function harness({ performer = null, now: suppliedNow = 1_000 } = {}) {
  let now = suppliedNow;
  const roster = createNpcRoster();
  const snapshots = [
    { id: "mara", aliases: roster.get("mara").aliases, position: { x: 0, y: 1.5, z: -4 } },
    { id: "bram", aliases: roster.get("bram").aliases, position: { x: 4, y: 1.5, z: -3 } },
    { id: "elowen", aliases: roster.get("elowen").aliases, position: { x: -5, y: 1.5, z: -2 } },
  ];
  const npcSystem = {
    snapshots: vi.fn(() => snapshots),
    notice: vi.fn(() => true),
    perform: vi.fn(() => true),
  };
  const spatialVoice = {
    speak: vi.fn().mockResolvedValue(true),
    interrupt: vi.fn(() => true),
  };
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  camera.updateMatrixWorld(true);
  const onStatus = vi.fn();
  const onRecording = vi.fn();
  const realtime = {
    connect: vi.fn().mockResolvedValue(true),
    submitOpening: vi.fn().mockResolvedValue(true),
    submitTurn: vi.fn().mockResolvedValue(true),
    acceptVoiceFrame: vi.fn(() => true),
    interrupt: vi.fn(),
    close: vi.fn(),
  };
  const coordinator = new NpcConversationCoordinator({
    npcSystem,
    spatialVoice,
    roster,
    performer: performer ?? new NpcPerformer({ roster }),
    camera,
    now: () => now,
    onStatus,
    onRecording,
    realtimeFactory: () => realtime,
  });
  return {
    coordinator,
    npcSystem,
    spatialVoice,
    onStatus,
    onRecording,
    realtime,
    snapshots,
    advance(ms) { now += ms; },
  };
}

describe("NpcConversationCoordinator", () => {
  it("makes the first named callout notice only, never formal conversation", async () => {
    const { coordinator, npcSystem, spatialVoice, realtime } = harness();
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "玛拉，你好", voiceLevel: 0.6, confidence: 0.9 });
    expect(npcSystem.notice).toHaveBeenCalledWith("mara", expect.any(THREE.Vector3));
    expect(spatialVoice.speak).toHaveBeenCalledWith("mara", expect.objectContaining({ speech: expect.any(String) }));
    expect(coordinator.machine.state).toBe(ATTENTION_STATES.AWAITING_INTENT);
    expect(coordinator.activeNpcId).toBeNull();
    expect(realtime.connect).not.toHaveBeenCalled();
  });

  it("submits a clear follow-up exactly once and enters formal conversation", async () => {
    const { coordinator, realtime } = harness();
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "布拉姆", voiceLevel: 0.6, confidence: 0.95 });
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "请帮我看看钥匙上的划痕", voiceLevel: 0.5, confidence: 0.9 });
    expect(coordinator.machine.state).toBe(ATTENTION_STATES.CONVERSATION_REQUESTED);
    expect(coordinator.activeNpcId).toBe("bram");
    expect(realtime.connect).toHaveBeenCalledTimes(1);
    expect(realtime.submitOpening).toHaveBeenCalledTimes(1);
    expect(realtime.submitOpening).toHaveBeenCalledWith("请帮我看看钥匙上的划痕");
  });

  it("cancels on an authoritative dismissal", async () => {
    const { coordinator, realtime, spatialVoice } = harness();
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "艾洛温你好", voiceLevel: 0.7, confidence: 0.9 });
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "算了，不是叫你", voiceLevel: 0.5, confidence: 1 });
    expect(coordinator.machine.state).toBe(ATTENTION_STATES.CANCELLED);
    expect(realtime.connect).not.toHaveBeenCalled();
    expect(spatialVoice.speak).toHaveBeenLastCalledWith("elowen", expect.objectContaining({ audioUrl: expect.stringContaining("dismiss") }));
  });

  it("clarifies once then times out on a second ambiguous response", async () => {
    const { coordinator } = harness();
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "玛拉", voiceLevel: 0.5, confidence: 0.9 });
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "呃", voiceLevel: 0.5, confidence: 0.9 });
    expect(coordinator.machine.state).toBe(ATTENTION_STATES.AWAITING_INTENT);
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "嗯", voiceLevel: 0.5, confidence: 0.9 });
    expect(coordinator.machine.state).toBe(ATTENTION_STATES.TIMED_OUT);
  });

  it("times out and cancels when the player moves too far away", async () => {
    const first = harness();
    first.coordinator.beginCapture();
    await first.coordinator.acceptTranscript({ transcript: "玛拉", voiceLevel: 0.5, confidence: 0.9 });
    first.advance(5_001);
    first.coordinator.update();
    expect(first.coordinator.machine.state).toBe(ATTENTION_STATES.TIMED_OUT);

    const second = harness();
    second.coordinator.beginCapture();
    await second.coordinator.acceptTranscript({ transcript: "玛拉", voiceLevel: 0.5, confidence: 0.9 });
    second.coordinator.camera.position.set(20, 1.6, 0);
    second.coordinator.update();
    expect(second.coordinator.machine.state).toBe(ATTENTION_STATES.CANCELLED);
  });

  it("interrupts NPC output when a new capture begins", async () => {
    const { coordinator, spatialVoice } = harness();
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "玛拉", voiceLevel: 0.5, confidence: 0.9 });
    coordinator.beginCapture();
    expect(spatialVoice.interrupt).toHaveBeenCalled();
  });

  it("ignores late performer output after a newer callout", async () => {
    let release;
    const remote = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const roster = createNpcRoster();
    const performer = new NpcPerformer({ roster, remote });
    const { coordinator, spatialVoice } = harness({ performer });
    coordinator.roster = roster;
    coordinator.beginCapture();
    const stale = coordinator.acceptTranscript({ transcript: "玛拉", voiceLevel: 0.5, confidence: 0.9 });
    await Promise.resolve();
    coordinator.beginCapture();
    release({ npcId: "mara", speech: "迟到的回应", action: "notice", emotion: "neutral", gesture: "turn" });
    await stale;
    expect(spatialVoice.speak).not.toHaveBeenCalledWith("mara", expect.objectContaining({ speech: "迟到的回应" }));
  });

  it("routes later conversation turns to the active NPC and supports interruption", async () => {
    const { coordinator, realtime } = harness();
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "布拉姆", voiceLevel: 0.6, confidence: 0.9 });
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "我想修钥匙", voiceLevel: 0.5, confidence: 0.9 });
    coordinator.beginCapture();
    expect(realtime.interrupt).toHaveBeenCalled();
    await coordinator.acceptTranscript({ transcript: "还有一把旧锁", voiceLevel: 0.5, confidence: 0.9 });
    expect(realtime.submitTurn).toHaveBeenCalledWith("还有一把旧锁");
  });

  it("forwards live PCM frames only after a realtime conversation is active", async () => {
    const { coordinator, realtime } = harness();
    const frame = new ArrayBuffer(64);

    expect(coordinator.acceptVoiceFrame(frame)).toBe(false);
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "Bram", voiceLevel: 0.6, confidence: 0.9 });
    coordinator.beginCapture();
    await coordinator.acceptTranscript({ transcript: "Please help me repair this lock", voiceLevel: 0.5, confidence: 0.9 });

    expect(coordinator.acceptVoiceFrame(frame)).toBe(true);
    expect(realtime.acceptVoiceFrame).toHaveBeenCalledWith(frame);
  });

  it("returns immediately to local dialogue when realtime setup fails", async () => {
    const h = harness();
    h.realtime.connect.mockRejectedValue(new Error("no key"));
    h.coordinator.beginCapture();
    await h.coordinator.acceptTranscript({ transcript: "玛拉", voiceLevel: 0.6, confidence: 0.9 });
    h.coordinator.beginCapture();
    await h.coordinator.acceptTranscript({ transcript: "我想问昨晚的住客", voiceLevel: 0.5, confidence: 0.9 });
    expect(h.coordinator.activeNpcId).toBe("mara");
    expect(h.spatialVoice.speak).toHaveBeenLastCalledWith("mara", expect.objectContaining({ speech: expect.stringMatching(/昨晚|住客|传闻/) }));
  });
});
