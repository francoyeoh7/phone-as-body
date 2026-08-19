import { describe, expect, it, vi } from "vitest";
import { PointerOwnership } from "../src/controller/PointerOwnership.js";
import { VoiceHoldController } from "../src/controller/VoiceHoldController.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(duration) {
      const target = now + duration;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
  };
}

function pointer(pointerId, x, y, overrides = {}) {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

function createStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] }, track };
}

function createRecorderClass(
  chunks = [new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" })],
  { deferStop = false } = {}
) {
  return class FakeMediaRecorder {
    static instances = [];
    static pendingStops = [];

    static flushStops() {
      for (const finish of this.pendingStops.splice(0)) finish();
    }

    constructor(stream) {
      this.stream = stream;
      this.state = "inactive";
      this.mimeType = "audio/webm;codecs=opus";
      this.start = vi.fn((timeslice) => {
        this.timeslice = timeslice;
        this.state = "recording";
      });
      this.stop = vi.fn(() => {
        if (this.state === "inactive") return;
        this.state = "inactive";
        for (const data of chunks) this.ondataavailable?.({ data });
        const finish = () => this.onstop?.();
        if (deferStop) FakeMediaRecorder.pendingStops.push(finish);
        else finish();
      });
      FakeMediaRecorder.instances.push(this);
    }
  };
}

function createHarness({ permission, chunks, isInRegion, recorderOptions, Blob: BlobImpl, ownership: ownershipOverride } = {}) {
  const clock = createClock();
  const media = createStream();
  const getUserMedia = vi.fn(() => permission ?? Promise.resolve(media.stream));
  const MediaRecorder = createRecorderClass(chunks, recorderOptions);
  const ownership = ownershipOverride ?? {
    generation: 3,
    claimVoice: vi.fn(() => true),
    release: vi.fn(() => true),
  };
  const onActive = vi.fn();
  const onPressState = vi.fn();
  const onClip = vi.fn();
  const pcmStreamer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const pcmStreamerFactory = vi.fn(() => pcmStreamer);
  const onStreamFrame = vi.fn();
  const controller = new VoiceHoldController({
    clock: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getUserMedia,
    MediaRecorder,
    Blob: BlobImpl,
    ownership,
    isInRegion: isInRegion ?? ((event) => event.clientY >= 700),
    onActive,
    onPressState,
    onClip,
    pcmStreamerFactory,
    onStreamFrame,
  });
  return {
    clock,
    controller,
    getUserMedia,
    MediaRecorder,
    ownership,
    onActive,
    onPressState,
    onClip,
    pcmStreamer,
    pcmStreamerFactory,
    onStreamFrame,
    ...media,
  };
}

async function beginRecording(harness, event = pointer(7, 100, 800)) {
  harness.controller.pointerDown(event);
  harness.clock.advance(180);
  await harness.controller.flushPendingPermission();
  return event;
}

describe("VoiceHoldController", () => {
  it("shows immediate press feedback before microphone permission and recording dwell resolve", () => {
    const pending = deferred();
    const harness = createHarness({ permission: pending.promise });

    harness.controller.pointerDown(pointer(7, 100, 800));

    expect(harness.onPressState).toHaveBeenCalledExactlyOnceWith("pressed");
    expect(harness.onActive).not.toHaveBeenCalled();
  });

  it("continues voice capture when a browser rejects pointer capture", () => {
    const pending = deferred();
    const harness = createHarness({ permission: pending.promise });
    const event = pointer(7, 100, 800, {
      currentTarget: {
        setPointerCapture: vi.fn(() => { throw new DOMException("No active pointer", "NotFoundError"); }),
      },
    });

    expect(() => harness.controller.pointerDown(event)).not.toThrow();
    expect(harness.onPressState).toHaveBeenCalledExactlyOnceWith("pressed");
    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("primes phone PCM capture inside pointerdown user activation before permission resolves", () => {
    const pending = deferred();
    const harness = createHarness({ permission: pending.promise });
    harness.pcmStreamer.prime = vi.fn(() => true);

    harness.controller.pointerDown(pointer(7, 100, 800));

    expect(harness.pcmStreamerFactory).toHaveBeenCalledWith({ onFrame: harness.onStreamFrame });
    expect(harness.pcmStreamer.prime).toHaveBeenCalledOnce();
  });

  it("returns the press state to idle when a short press is released", async () => {
    const harness = createHarness();

    harness.controller.pointerDown(pointer(7, 100, 800));
    await harness.controller.pointerUp(pointer(7, 100, 800));

    expect(harness.onPressState).toHaveBeenLastCalledWith("idle");
    expect(harness.pcmStreamer.stop).toHaveBeenCalledOnce();
  });

  it("shows a temporary error state when microphone permission is denied", async () => {
    const harness = createHarness({ permission: Promise.reject(new Error("denied")) });

    harness.controller.pointerDown(pointer(7, 100, 800));
    await harness.controller.flushPendingPermission();

    expect(harness.onPressState).toHaveBeenLastCalledWith("error");
    harness.clock.advance(419);
    expect(harness.onPressState).toHaveBeenLastCalledWith("error");
    harness.clock.advance(1);
    expect(harness.onPressState).toHaveBeenLastCalledWith("idle");
  });

  it("requests audio on pointer down and commits after permission and the 180ms dwell", async () => {
    const pending = deferred();
    const harness = createHarness({ permission: pending.promise });
    const event = pointer(7, 100, 800);

    harness.controller.pointerDown(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(harness.ownership.claimVoice).toHaveBeenCalledWith(7);
    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true });
    harness.clock.advance(180);
    expect(harness.onActive).not.toHaveBeenCalled();

    pending.resolve(harness.stream);
    await harness.controller.flushPendingPermission();

    expect(harness.MediaRecorder.instances[0].start).toHaveBeenCalledWith(250);
    expect(harness.pcmStreamerFactory).toHaveBeenCalledWith({ onFrame: harness.onStreamFrame });
    expect(harness.pcmStreamer.start).toHaveBeenCalledWith(harness.stream);
    expect(harness.onActive).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("stops the realtime PCM stream when recording ends", async () => {
    const harness = createHarness();
    await beginRecording(harness);

    await harness.controller.pointerUp(pointer(7, 100, 800));

    expect(harness.pcmStreamer.stop).toHaveBeenCalledOnce();
  });

  it("does not commit before the dwell even when permission resolves immediately", async () => {
    const harness = createHarness();

    harness.controller.pointerDown(pointer(7, 100, 800));
    await harness.controller.flushPendingPermission();
    harness.clock.advance(179);

    expect(harness.MediaRecorder.instances).toHaveLength(0);
    expect(harness.onActive).not.toHaveBeenCalled();

    harness.clock.advance(1);
    expect(harness.onActive).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("allows normal thumb drift but cancels a deliberate drag before recording", async () => {
    const allowed = createHarness();
    allowed.controller.pointerDown(pointer(7, 100, 800));
    allowed.controller.pointerMove(pointer(7, 124, 800));
    allowed.clock.advance(420);
    await allowed.controller.flushPendingPermission();
    expect(allowed.onActive).toHaveBeenCalledWith(true);

    const cancelled = createHarness();
    cancelled.controller.pointerDown(pointer(8, 100, 800));
    cancelled.controller.pointerMove(pointer(8, 129, 800));
    cancelled.clock.advance(420);
    await cancelled.controller.flushPendingPermission();

    expect(cancelled.onActive).not.toHaveBeenCalled();
    expect(cancelled.track.stop).toHaveBeenCalledOnce();
    expect(cancelled.ownership.release).toHaveBeenCalledWith("voice", 8, 3);
  });

  it("finishes an active captured recording when the thumb drifts outside the button", async () => {
    const harness = createHarness({ isInRegion: (event) => event.clientY >= 700 });
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    };

    await beginRecording(harness, pointer(7, 100, 800, { currentTarget: target }));
    harness.controller.pointerMove(pointer(7, 116, 680, { currentTarget: target }));
    harness.clock.advance(900);
    await harness.controller.pointerUp(pointer(7, 116, 680, { currentTarget: target }));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).toHaveBeenCalledOnce();
    expect(harness.onClip.mock.calls[0][0].durationMs).toBe(900);
  });

  it("discards an early release before the dwell finishes", async () => {
    const harness = createHarness();
    harness.controller.pointerDown(pointer(7, 100, 800));
    await harness.controller.flushPendingPermission();

    await harness.controller.pointerUp(pointer(7, 100, 800));
    harness.clock.advance(420);

    expect(harness.onActive).not.toHaveBeenCalled();
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.pcmStreamer.stop).toHaveBeenCalledOnce();
  });

  it("cancels when an uncaptured held pointer leaves the voice region", async () => {
    const harness = createHarness({ isInRegion: (event) => event.clientY >= 700 });
    harness.controller.pointerDown(pointer(7, 100, 800));
    await harness.controller.flushPendingPermission();

    harness.controller.pointerMove(pointer(7, 100, 699));
    harness.clock.advance(420);

    expect(harness.onActive).not.toHaveBeenCalled();
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.pcmStreamer.stop).toHaveBeenCalledOnce();
  });

  it("releases ownership without becoming active when permission is denied", async () => {
    const denied = Promise.reject(new Error("denied"));
    const harness = createHarness({ permission: denied });

    harness.controller.pointerDown(pointer(7, 100, 800));
    harness.clock.advance(420);
    await harness.controller.flushPendingPermission();

    expect(harness.onActive).not.toHaveBeenCalled();
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.ownership.release).toHaveBeenCalledWith("voice", 7, 3);
  });

  it("emits inactive before a direct binary clip on normal release", async () => {
    const harness = createHarness();
    await beginRecording(harness);
    harness.clock.advance(1300);

    await harness.controller.pointerUp(pointer(7, 100, 800));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onActive.mock.invocationCallOrder[1]).toBeLessThan(harness.onClip.mock.invocationCallOrder[0]);
    expect(harness.onClip).toHaveBeenCalledWith({
      version: 1,
      seq: 0,
      durationMs: 1300,
      mimeType: "audio/webm;codecs=opus",
      data: expect.any(ArrayBuffer),
    });
    expect(harness.onClip.mock.calls[0][0].data.byteLength).toBe(3);
    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.ownership.release).toHaveBeenCalledWith("voice", 7, 3);
  });

  it("still delivers the clip after releasing real pointer ownership", async () => {
    const ownership = new PointerOwnership();
    const harness = createHarness({ ownership });

    await beginRecording(harness);
    await harness.controller.pointerUp(pointer(7, 100, 800));

    expect(ownership.voiceId).toBe(null);
    expect(harness.onClip).toHaveBeenCalledOnce();
    expect(harness.onClip.mock.calls[0][0].data.byteLength).toBe(3);
  });

  it("keeps a captured hold active when mobile Safari reports pointerleave", async () => {
    const harness = createHarness();
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    };

    await beginRecording(harness, pointer(7, 100, 800, { currentTarget: target }));
    harness.controller.pointerLeave(pointer(7, 100, 800, { currentTarget: target }));
    harness.clock.advance(900);
    await harness.controller.pointerUp(pointer(7, 100, 800, { currentTarget: target }));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).toHaveBeenCalledOnce();
    expect(harness.onClip.mock.calls[0][0].durationMs).toBe(900);
  });

  it("keeps recording when mobile Safari drops pointer capture before release", async () => {
    const harness = createHarness();
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
    };
    const base = { currentTarget: target, type: "lostpointercapture" };

    await beginRecording(harness, pointer(7, 100, 800, base));
    harness.controller.pointerCaptureLost(pointer(7, 100, 800, base));
    harness.clock.advance(900);
    await harness.controller.pointerUp(pointer(7, 116, 680, { currentTarget: target }));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).toHaveBeenCalledOnce();
    expect(harness.onClip.mock.calls[0][0].durationMs).toBe(900);
  });

  it("auto-stops and sends the clip after 10 seconds", async () => {
    const harness = createHarness();
    await beginRecording(harness);

    harness.clock.advance(10_000);
    await harness.controller.flushPendingRecording();

    expect(harness.MediaRecorder.instances[0].stop).toHaveBeenCalledOnce();
    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip.mock.calls[0][0].durationMs).toBe(10_000);
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });

  it("discards an assembled clip over 1MiB", async () => {
    const oversized = new Blob([new Uint8Array((1024 * 1024) + 1)], { type: "audio/webm" });
    const harness = createHarness({ chunks: [oversized] });
    await beginRecording(harness);

    await harness.controller.pointerUp(pointer(7, 100, 800));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });

  it("discard-cancels pending permission and ignores its late stream", async () => {
    const pending = deferred();
    const harness = createHarness({ permission: pending.promise });
    harness.controller.pointerDown(pointer(7, 100, 800));
    harness.clock.advance(420);

    await harness.controller.cancel({ discard: true });
    pending.resolve(harness.stream);
    await harness.controller.flushPendingPermission();

    expect(harness.onActive).not.toHaveBeenCalled();
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.ownership.release).toHaveBeenCalledOnce();
  });

  it("notifies inactive exactly once across duplicate cancellation cleanup", async () => {
    const harness = createHarness();
    await beginRecording(harness);

    await harness.controller.cancel({ discard: true });
    await harness.controller.cancel({ discard: true });
    await harness.controller.pointerCancel(pointer(7, 100, 800));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
    expect(harness.ownership.release).toHaveBeenCalledOnce();
  });

  it("lets lifecycle discard cancel a normal stop while recorder onstop is queued", async () => {
    const harness = createHarness({ recorderOptions: { deferStop: true } });
    await beginRecording(harness);

    const stop = harness.controller.pointerUp(pointer(7, 100, 800));
    const cancel = harness.controller.cancel({ discard: true });
    harness.MediaRecorder.flushStops();
    await Promise.all([stop, cancel]);

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });

  it("rechecks lifecycle discard after asynchronous clip conversion", async () => {
    const pendingData = deferred();
    class DeferredBlob {
      constructor(parts, { type } = {}) {
        this.type = type ?? "";
        this.size = parts.reduce((size, part) => size + (part.size ?? part.byteLength ?? 0), 0);
      }

      arrayBuffer() {
        return pendingData.promise;
      }
    }
    const harness = createHarness({ Blob: DeferredBlob });
    await beginRecording(harness);

    const stop = harness.controller.pointerUp(pointer(7, 100, 800));
    const cancel = harness.controller.cancel({ discard: true });
    pendingData.resolve(new Uint8Array([1, 2, 3]).buffer);
    await Promise.all([stop, cancel]);

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });

  it("rejects permission that resolves after pointer ownership generation changes", async () => {
    const pending = deferred();
    const harness = createHarness({ permission: pending.promise });
    harness.controller.pointerDown(pointer(7, 100, 800));
    harness.clock.advance(420);
    harness.ownership.generation += 1;

    pending.resolve(harness.stream);
    await harness.controller.flushPendingPermission();

    expect(harness.onActive).not.toHaveBeenCalled();
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });

  it("rejects dwell commit after pointer ownership generation changes", async () => {
    const harness = createHarness();
    harness.controller.pointerDown(pointer(7, 100, 800));
    await harness.controller.flushPendingPermission();
    harness.ownership.generation += 1;

    harness.clock.advance(420);

    expect(harness.onActive).not.toHaveBeenCalled();
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });

  it("discards pointerup outside the voice region without an intervening move", async () => {
    const harness = createHarness({ isInRegion: (event) => event.clientY >= 700 });
    await beginRecording(harness);

    await harness.controller.pointerUp(pointer(7, 100, 699));

    expect(harness.onActive.mock.calls).toEqual([[true], [false]]);
    expect(harness.onClip).not.toHaveBeenCalled();
    expect(harness.track.stop).toHaveBeenCalledOnce();
  });
});
