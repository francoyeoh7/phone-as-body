import { describe, expect, it, vi } from "vitest";
import { NpcSpatialVoice } from "../src/desktop/npc/NpcSpatialVoice.js";

function makeHarness() {
  const camera = { add: vi.fn(), remove: vi.fn(), position: { x: 0, y: 1.6, z: 0 } };
  const mouths = new Map(["mara", "bram", "elowen"].map((id) => [id, { add: vi.fn(), remove: vi.fn() }]));
  const actors = new Map([...mouths].map(([id, mouth]) => [id, { mouth }]));
  const npcSystem = { actors, mouthFor: (id) => mouths.get(id) };
  const filters = [];
  const listener = {
    context: {
      createBiquadFilter: vi.fn(() => {
        const filter = { type: "", frequency: { value: 0 }, Q: { value: 0 } };
        filters.push(filter);
        return filter;
      }),
      decodeAudioData: vi.fn(async () => ({ decoded: true })),
    },
  };
  const voices = new Map();
  const voiceFactory = vi.fn((id) => {
    const voice = {
      setRefDistance: vi.fn(),
      setMaxDistance: vi.fn(),
      setRolloffFactor: vi.fn(),
      setDistanceModel: vi.fn(),
      setDirectionalCone: vi.fn(),
      setFilter: vi.fn(),
      setVolume: vi.fn(),
      setBuffer: vi.fn(),
      setMediaStreamSource: vi.fn(),
      play: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      isPlaying: false,
    };
    voices.set(id, voice);
    return voice;
  });
  return { camera, npcSystem, listener, voices, filters, voiceFactory };
}

describe("NpcSpatialVoice", () => {
  it("creates one configured positional voice at every NPC mouth", () => {
    const harness = makeHarness();
    new NpcSpatialVoice(harness);
    expect(harness.camera.add).toHaveBeenCalledWith(harness.listener);
    expect(harness.voiceFactory).toHaveBeenCalledTimes(3);
    for (const voice of harness.voices.values()) {
      expect(voice.setRefDistance).toHaveBeenCalledWith(1.6);
      expect(voice.setMaxDistance).toHaveBeenCalledWith(14);
      expect(voice.setRolloffFactor).toHaveBeenCalledWith(1.45);
      expect(voice.setDistanceModel).toHaveBeenCalledWith("inverse");
      expect(voice.setDirectionalCone).toHaveBeenCalledWith(120, 230, 0.35);
    }
  });

  it("plays decoded speech and publishes its world subtitle", async () => {
    const harness = makeHarness();
    const onSubtitle = vi.fn();
    const spatial = new NpcSpatialVoice({ ...harness, onSubtitle });
    const buffer = { duration: 1.2 };
    await expect(spatial.speak("mara", { speech: "我听见了。", buffer })).resolves.toBe(true);
    expect(onSubtitle).toHaveBeenCalledWith({ npcId: "mara", speech: "我听见了。" });
    expect(harness.voices.get("mara").setBuffer).toHaveBeenCalledWith(buffer);
    expect(harness.voices.get("mara").play).toHaveBeenCalledOnce();
  });

  it("discards a decoded clip superseded by a newer generation", async () => {
    let resolveArrayBuffer;
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => new Promise((resolve) => { resolveArrayBuffer = resolve; }),
    }));
    const harness = makeHarness();
    const spatial = new NpcSpatialVoice({ ...harness, fetchImpl });
    const stale = spatial.speak("mara", { speech: "old", audioUrl: "/old.wav" });
    const current = spatial.speak("mara", { speech: "new", buffer: { duration: 1 } });
    await Promise.resolve();
    resolveArrayBuffer(new ArrayBuffer(8));
    await expect(stale).resolves.toBe(false);
    await expect(current).resolves.toBe(true);
    expect(harness.voices.get("mara").play).toHaveBeenCalledTimes(1);
  });

  it("applies occlusion low-pass and gain without muting speech", () => {
    const harness = makeHarness();
    const spatial = new NpcSpatialVoice(harness);
    spatial.setOccluded("bram", true);
    expect(harness.voices.get("bram").setVolume).toHaveBeenLastCalledWith(0.58);
    expect(spatial.entries.get("bram").filter.frequency.value).toBe(1150);
    spatial.setOccluded("bram", false);
    expect(harness.voices.get("bram").setVolume).toHaveBeenLastCalledWith(1);
    expect(spatial.entries.get("bram").filter.frequency.value).toBe(18000);
  });

  it("attaches realtime media at the selected NPC and interrupts immediately", () => {
    const harness = makeHarness();
    const spatial = new NpcSpatialVoice(harness);
    const stream = { id: "remote" };
    expect(spatial.attachMediaStream("elowen", stream)).toBe(true);
    expect(harness.voices.get("elowen").setMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(spatial.interrupt("elowen")).toBe(true);
    expect(harness.voices.get("elowen").stop).toHaveBeenCalled();
  });

  it("disposes voices, filters, and the camera listener", () => {
    const harness = makeHarness();
    const spatial = new NpcSpatialVoice(harness);
    spatial.destroy();
    for (const [id, voice] of harness.voices) {
      expect(voice.disconnect).toHaveBeenCalled();
      expect(harness.npcSystem.mouthFor(id).remove).toHaveBeenCalledWith(voice);
    }
    expect(harness.camera.remove).toHaveBeenCalledWith(harness.listener);
  });
});
