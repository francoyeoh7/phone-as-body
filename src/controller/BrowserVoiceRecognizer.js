export class BrowserVoiceRecognizer {
  constructor({
    Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition,
    onResult,
    onError,
    language = "zh-CN",
  } = {}) {
    this.Recognition = Recognition;
    this.onResult = onResult;
    this.onError = onError;
    this.language = language;
    this.instance = null;
    this.active = false;
  }

  start() {
    if (this.instance || !this.Recognition) return false;
    this.active = true;
    return this.startInstance();
  }

  startInstance() {
    const instance = new this.Recognition();
    instance.lang = this.language;
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    instance.onresult = (event) => {
      const results = event.results ?? [];
      const segments = [];
      let confidence = 0.5;
      let interim = false;
      for (let index = 0; index < results.length; index += 1) {
        const speechResult = results[index];
        const alternative = speechResult?.[0];
        const transcript = String(alternative?.transcript ?? "").trim();
        if (!transcript) continue;
        segments.push(transcript);
        confidence = Number(alternative?.confidence) || confidence;
        interim ||= speechResult?.isFinal !== true;
      }
      const transcript = segments.join("").trim();
      if (transcript) this.onResult?.({ transcript, confidence, voiceLevel: 0.7, interim });
    };
    instance.onerror = (event) => {
      if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(event?.error)) this.active = false;
      this.onError?.(event);
    };
    instance.onend = () => {
      if (this.instance !== instance) return;
      this.instance = null;
      if (this.active) this.startInstance();
    };
    // Reserve the instance before calling start() so a re-entrant lifecycle
    // callback cannot create a second recognizer for the same press.
    this.instance = instance;
    try {
      instance.start();
      return true;
    } catch (error) {
      if (this.instance === instance) this.instance = null;
      this.active = false;
      this.onError?.(error);
      return false;
    }
  }

  stop() {
    this.active = false;
    const instance = this.instance;
    if (!instance) return false;
    this.instance = null;
    try { instance.stop?.(); } catch { /* browser already ended */ }
    return true;
  }

  cancel() {
    this.active = false;
    const instance = this.instance;
    if (!instance) return false;
    this.instance = null;
    try { instance.abort?.(); } catch { /* browser already ended */ }
    return true;
  }
}
