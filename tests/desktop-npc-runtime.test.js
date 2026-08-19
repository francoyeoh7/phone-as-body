import { describe, expect, it, vi } from "vitest";
import { createDesktopNpcRuntime, transcribeVoiceClip } from "../src/desktop/npc/DesktopNpcRuntime.js";

function createHarness({ fetchImpl = vi.fn() } = {}) {
  const roster = { get: vi.fn(), contextFor: vi.fn() };
  const npcSystem = { roster, actors: new Map(), snapshots: vi.fn(() => []) };
  const camera = { position: { x: 0, y: 1.6, z: 0 } };
  const ui = {
    setSubtitle: vi.fn(),
    setPlayerTranscript: vi.fn(),
    setVoiceRecording: vi.fn(),
    setNpcVoiceStatus: vi.fn(),
  };
  const spatialVoice = {
    updateOcclusion: vi.fn(),
    destroy: vi.fn(),
  };
  const performer = {};
  const coordinator = {
    beginCapture: vi.fn(() => 3),
    cancelCapture: vi.fn(),
    acceptVoiceClip: vi.fn(async () => true),
    acceptVoiceFrame: vi.fn(() => true),
    acceptTranscript: vi.fn(async () => true),
    update: vi.fn(),
    destroy: vi.fn(),
  };
  const spatialVoiceFactory = vi.fn(() => spatialVoice);
  const performerFactory = vi.fn(() => performer);
  const coordinatorFactory = vi.fn(() => coordinator);
  const runtime = createDesktopNpcRuntime({
    npcSystem,
    camera,
    ui,
    staticOccluderRoots: [],
    spatialVoiceFactory,
    performerFactory,
    coordinatorFactory,
    fetchImpl,
  });
  return {
    runtime,
    roster,
    npcSystem,
    camera,
    ui,
    spatialVoice,
    performer,
    coordinator,
    spatialVoiceFactory,
    performerFactory,
    coordinatorFactory,
  };
}

describe("createDesktopNpcRuntime", () => {
  it("wires the village roster, spatial voice, performer, and coordinator", () => {
    const harness = createHarness();

    expect(harness.spatialVoiceFactory).toHaveBeenCalledWith(expect.objectContaining({
      camera: harness.camera,
      npcSystem: harness.npcSystem,
      onSubtitle: expect.any(Function),
    }));
    expect(harness.performerFactory).toHaveBeenCalledWith(expect.objectContaining({ roster: harness.roster }));
    expect(harness.coordinatorFactory).toHaveBeenCalledWith(expect.objectContaining({
      npcSystem: harness.npcSystem,
      spatialVoice: harness.spatialVoice,
      roster: harness.roster,
      performer: harness.performer,
      camera: harness.camera,
      transcriber: expect.any(Function),
    }));
  });

  it("delegates phone voice events and updates acoustic occlusion every frame", async () => {
    const harness = createHarness();
    const clip = { mimeType: "audio/webm", data: new ArrayBuffer(8) };
    const frame = new ArrayBuffer(16);
    const transcript = { transcript: "Mara", confidence: 0.9 };

    expect(harness.runtime.beginCapture()).toBe(3);
    await expect(harness.runtime.acceptVoiceClip(clip)).resolves.toBe(true);
    expect(harness.runtime.acceptVoiceFrame(frame)).toBe(true);
    await expect(harness.runtime.acceptTranscript(transcript)).resolves.toBe(true);
    harness.runtime.update();

    expect(harness.coordinator.beginCapture).toHaveBeenCalledOnce();
    expect(harness.coordinator.acceptVoiceClip).toHaveBeenCalledWith(clip);
    expect(harness.coordinator.acceptVoiceFrame).toHaveBeenCalledWith(frame);
    expect(harness.coordinator.acceptTranscript).toHaveBeenCalledWith(transcript);
    expect(harness.coordinator.update).toHaveBeenCalledOnce();
    expect(harness.spatialVoice.updateOcclusion).toHaveBeenCalledWith(expect.any(Function));
  });

  it("shows a recognized player utterance before routing it to an NPC", async () => {
    const harness = createHarness();

    await harness.runtime.acceptTranscript({ transcript: "玛拉，你能听见吗？", confidence: 0.9 });

    expect(harness.ui.setPlayerTranscript).toHaveBeenCalledWith("玛拉，你能听见吗？", true);
    expect(harness.coordinator.acceptTranscript).toHaveBeenCalledWith({
      transcript: "玛拉，你能听见吗？",
      confidence: 0.9,
    });
  });

  it("shows server transcription text and voice status instead of failing silently", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transcript: "布拉姆", confidence: 0.9, voiceLevel: 0.6 }),
    }));
    const harness = createHarness({ fetchImpl });
    const options = harness.coordinatorFactory.mock.calls[0][0];
    const result = await options.transcriber({ mimeType: "audio/mp4", data: new ArrayBuffer(8) });

    expect(result.transcript).toBe("布拉姆");
    expect(harness.ui.setPlayerTranscript).toHaveBeenCalledWith("布拉姆", true);

    options.onStatus({ message: "没有听清，请再说一次", state: "Idle" });
    expect(harness.ui.setNpcVoiceStatus).toHaveBeenCalledWith(expect.objectContaining({
      message: "没有听清，请再说一次",
    }));
  });

  it("destroys conversation before its camera audio listener", () => {
    const harness = createHarness();

    harness.runtime.destroy();
    harness.runtime.destroy();

    expect(harness.coordinator.destroy).toHaveBeenCalledOnce();
    expect(harness.spatialVoice.destroy).toHaveBeenCalledOnce();
    expect(harness.coordinator.destroy.mock.invocationCallOrder[0])
      .toBeLessThan(harness.spatialVoice.destroy.mock.invocationCallOrder[0]);
  });
});

describe("transcribeVoiceClip", () => {
  it("posts the recorded bytes with their real media type", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transcript: "Bram", confidence: 0.82, voiceLevel: 0.6 }),
    }));
    const data = new Uint8Array([1, 2, 3]).buffer;

    await expect(transcribeVoiceClip({ mimeType: "audio/webm;codecs=opus", data }, { fetchImpl }))
      .resolves.toEqual({ transcript: "Bram", confidence: 0.82, voiceLevel: 0.6 });

    expect(fetchImpl).toHaveBeenCalledWith("/api/npc/transcribe", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "audio/webm;codecs=opus" },
      body: data,
    }));
  });
});
