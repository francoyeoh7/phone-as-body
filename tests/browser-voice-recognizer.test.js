import { describe, expect, it, vi } from "vitest";
import { BrowserVoiceRecognizer } from "../src/controller/BrowserVoiceRecognizer.js";

function fakeRecognition() {
  return class FakeRecognition {
    static instances = [];
    constructor() {
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      FakeRecognition.instances.push(this);
    }
  };
}

describe("BrowserVoiceRecognizer", () => {
  it("starts Chinese continuous recognition and forwards interim and final results", () => {
    const Recognition = fakeRecognition();
    const onResult = vi.fn();
    const recognizer = new BrowserVoiceRecognizer({ Recognition, onResult, language: "zh-CN" });

    expect(recognizer.start()).toBe(true);
    const instance = Recognition.instances[0];
    expect(instance.lang).toBe("zh-CN");
    expect(instance.continuous).toBe(true);
    expect(instance.interimResults).toBe(true);
    const interim = [{ transcript: "有人看到", confidence: 0.61 }];
    interim.isFinal = false;
    instance.onresult({ resultIndex: 0, results: [interim] });
    const final = [{ transcript: "有人看到我的PPT吗", confidence: 0.87 }];
    final.isFinal = true;
    instance.onresult({ resultIndex: 0, results: [final] });

    expect(onResult.mock.calls).toEqual([
      [{ transcript: "有人看到", confidence: 0.61, voiceLevel: 0.7, interim: true }],
      [{ transcript: "有人看到我的PPT吗", confidence: 0.87, voiceLevel: 0.7, interim: false }],
    ]);
    expect(recognizer.stop()).toBe(true);
    expect(instance.stop).toHaveBeenCalledOnce();
  });

  it("fails closed when the browser has no speech recognition", () => {
    const recognizer = new BrowserVoiceRecognizer({ Recognition: null });

    expect(recognizer.start()).toBe(false);
    expect(recognizer.stop()).toBe(false);
  });

  it("restarts continuous recognition when mobile Chrome ends a held session", () => {
    const Recognition = fakeRecognition();
    const recognizer = new BrowserVoiceRecognizer({ Recognition });
    recognizer.start();
    const first = Recognition.instances[0];

    first.onend();

    expect(Recognition.instances).toHaveLength(2);
    expect(Recognition.instances[1].start).toHaveBeenCalledOnce();
    recognizer.stop();
  });

  it("combines finalized and changing segments into one live sentence", () => {
    const Recognition = fakeRecognition();
    const onResult = vi.fn();
    const recognizer = new BrowserVoiceRecognizer({ Recognition, onResult });
    recognizer.start();
    const instance = Recognition.instances[0];
    const first = [{ transcript: "有人看到", confidence: 0.5 }];
    first.isFinal = true;
    const second = [{ transcript: "我的PPT吗", confidence: 0.8 }];
    second.isFinal = false;

    instance.onresult({ resultIndex: 1, results: [first, second] });

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      transcript: "有人看到我的PPT吗",
      interim: true,
    }));
  });
});
