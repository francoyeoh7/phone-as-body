function createNoiseBuffer(context, seconds = 2) {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    previous = previous * 0.985 + white * 0.015;
    data[index] = previous;
  }
  return buffer;
}

export function createGameAudio() {
  let context = null;
  let master = null;
  let ambience = null;
  let hum = null;
  let footstepClock = 0;

  function start() {
    if (context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.62;
    master.connect(context.destination);

    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 310;
    noiseFilter.Q.value = 0.7;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.15;
    ambience = context.createBufferSource();
    ambience.buffer = createNoiseBuffer(context, 3);
    ambience.loop = true;
    ambience.connect(noiseFilter).connect(noiseGain).connect(master);
    ambience.start();

    hum = context.createOscillator();
    const humGain = context.createGain();
    hum.type = "sine";
    hum.frequency.value = 49;
    humGain.gain.value = 0.025;
    hum.connect(humGain).connect(master);
    hum.start();
  }

  function tone({ frequency = 120, endFrequency = frequency, duration = 0.2, gain = 0.14, type = "sine", delay = 0 }) {
    if (!context) return;
    const now = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.025, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  function noiseBurst(duration = 0.25, gain = 0.2, frequency = 520) {
    if (!context) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const now = context.currentTime;
    source.buffer = createNoiseBuffer(context, Math.max(0.3, duration));
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start(now);
    source.stop(now + duration);
  }

  function cue(name) {
    if (!context) return;
    if (name === "pickup") {
      tone({ frequency: 340, endFrequency: 560, duration: 0.18, gain: 0.1, type: "triangle" });
      tone({ frequency: 510, endFrequency: 720, duration: 0.2, gain: 0.07, delay: 0.08 });
    }
    if (name === "locked") tone({ frequency: 92, endFrequency: 68, duration: 0.16, gain: 0.13, type: "square" });
    if (name === "power") {
      noiseBurst(0.8, 0.28, 930);
      tone({ frequency: 45, endFrequency: 96, duration: 1.2, gain: 0.2, type: "sawtooth" });
    }
    if (name === "stinger") {
      noiseBurst(0.34, 0.38, 1480);
      tone({ frequency: 74, endFrequency: 32, duration: 0.7, gain: 0.28, type: "sawtooth" });
    }
    if (name === "elevator") {
      tone({ frequency: 94, endFrequency: 47, duration: 1.6, gain: 0.2, type: "triangle" });
      tone({ frequency: 330, endFrequency: 330, duration: 0.45, gain: 0.08, delay: 0.7 });
    }
    if (name === "thunder") noiseBurst(1.6, 0.23, 92);
    if (name === "flashlight") tone({ frequency: 690, endFrequency: 420, duration: 0.055, gain: 0.045, type: "square" });
  }

  function update(delta, movementSpeed) {
    if (!context || movementSpeed < 0.45) {
      footstepClock = 0;
      return;
    }
    footstepClock -= delta;
    if (footstepClock <= 0) {
      noiseBurst(0.09, 0.06 + Math.min(0.06, movementSpeed * 0.012), 130);
      tone({ frequency: 58, endFrequency: 42, duration: 0.1, gain: 0.045, type: "triangle" });
      footstepClock = Math.max(0.31, 0.58 - movementSpeed * 0.055);
    }
  }

  return {
    start,
    cue,
    update,
    setPaused(paused) {
      if (!master || !context) return;
      master.gain.setTargetAtTime(paused ? 0.08 : 0.62, context.currentTime, 0.08);
    },
    dispose() {
      ambience?.stop();
      hum?.stop();
      context?.close();
    },
  };
}
