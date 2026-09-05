export class AudioEngine extends EventTarget {
  constructor({ sampleRate = 48000 } = {}) {
    super();
    this.sampleRate = sampleRate;
    this.context = null;
  }

  async decode(input) {
    const bytes = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const context = this.context || new AudioContext({ sampleRate: this.sampleRate });
    this.context = context;
    return context.decodeAudioData(bytes.slice(0));
  }

  async process(buffer, {
    sampleRate = this.sampleRate,
    highpassHz = 70,
    lowpassHz = 16000,
    noiseGateDb = -48,
    normalizePeakDb = -1,
    gainDb = 0,
  } = {}) {
    const length = Math.ceil(buffer.duration * sampleRate);
    const offline = new OfflineAudioContext(buffer.numberOfChannels, length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    const highpass = offline.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = Math.max(10, highpassHz);
    const lowpass = offline.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = Math.min(sampleRate / 2 - 100, lowpassHz);
    const gain = offline.createGain();
    gain.gain.value = dbToGain(gainDb);
    source.connect(highpass).connect(lowpass).connect(gain).connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    applyNoiseGate(rendered, noiseGateDb);
    normalize(rendered, normalizePeakDb);
    this.dispatchEvent(new CustomEvent('processed', {
      detail: { duration: rendered.duration, sampleRate: rendered.sampleRate, channels: rendered.numberOfChannels },
    }));
    return rendered;
  }

  async resample(buffer, sampleRate = this.sampleRate) {
    return this.process(buffer, {
      sampleRate,
      highpassHz: 10,
      lowpassHz: sampleRate / 2 - 100,
      noiseGateDb: -120,
      normalizePeakDb: 0,
    });
  }

  toInterleavedFloat32(buffer) {
    const output = new Float32Array(buffer.length * buffer.numberOfChannels);
    for (let frame = 0; frame < buffer.length; frame++) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        output[frame * buffer.numberOfChannels + channel] = buffer.getChannelData(channel)[frame];
      }
    }
    return output;
  }

  buildFFmpegFilter(options = {}) {
    const {
      highpassHz = 70,
      lowpassHz = 16000,
      noiseReduction = 0.18,
      normalizeLufs = -16,
      truePeakDb = -1.5,
      gainDb = 0,
    } = options;
    const filters = [
      `highpass=f=${Math.max(10, highpassHz)}`,
      `lowpass=f=${Math.max(highpassHz + 100, lowpassHz)}`,
    ];
    if (noiseReduction > 0) filters.push(`afftdn=nr=${Math.round(6 + noiseReduction * 24)}:nf=-50`);
    if (gainDb) filters.push(`volume=${gainDb}dB`);
    filters.push(`loudnorm=I=${normalizeLufs}:TP=${truePeakDb}:LRA=11`);
    return filters.join(',');
  }

  /**
   * Creates a bounded, stateful processor for decoded audio chunks. Unlike
   * OfflineAudioContext this never holds the full soundtrack in RAM, making it
   * suitable for long mobile exports. Loudness is an adaptive approximation
   * because an exact two-pass EBU R128 scan would require reading the track
   * twice; final peaks are nevertheless hard-limited.
   *
   * @param {object} options
   * @returns {{process:(sample:object)=>object, stats:()=>object, reset:()=>void}}
   */
  createStreamingProcessor(options = {}) {
    const state = createStreamingAudioState(options);
    return {
      process: (sample) => processStreamingSample(sample, state),
      stats: () => ({
        samples: state.samples,
        frames: state.frames,
        clippedSamples: state.clippedSamples,
        peak: state.peak,
        averageRms: state.blocks ? Math.sqrt(state.rmsSquares / state.blocks) : 0,
        gain: state.gain,
      }),
      reset: () => resetStreamingAudioState(state),
    };
  }

  destroy() {
    this.context?.close().catch(() => {});
    this.context = null;
  }
}

function applyNoiseGate(buffer, thresholdDb, attackMs = 5, releaseMs = 80) {
  const threshold = dbToGain(thresholdDb);
  const attack = Math.max(1, Math.round(buffer.sampleRate * attackMs / 1000));
  const release = Math.max(1, Math.round(buffer.sampleRate * releaseMs / 1000));
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let envelope = 1;
    for (let index = 0; index < data.length; index++) {
      const target = Math.abs(data[index]) >= threshold ? 1 : 0;
      envelope += (target - envelope) / (target ? attack : release);
      data[index] *= envelope;
    }
  }
}

function normalize(buffer, peakDb) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) peak = Math.max(peak, Math.abs(data[index]));
  }
  if (!peak) return;
  const gain = dbToGain(peakDb) / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] = Math.max(-1, Math.min(1, data[index] * gain));
  }
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

/** @param {object} options */
function createStreamingAudioState(options = {}) {
  return {
    highpassHz: clamp(Number(options.highpassHz ?? 70), 10, 1000),
    lowpassHz: clamp(Number(options.lowpassHz ?? 16000), 1000, 22000),
    noiseGate: dbToGain(Number(options.noiseGateDb ?? -48)),
    targetRms: dbToGain(Number(options.normalizeLufs ?? -16)),
    limiter: dbToGain(Number(options.truePeakDb ?? -1.5)),
    userGain: dbToGain(Number(options.gainDb ?? 0)),
    noiseReduction: clamp(Number(options.noiseReduction ?? 0.18), 0, 1),
    channels: [],
    gain: 1,
    samples: 0,
    frames: 0,
    clippedSamples: 0,
    peak: 0,
    rmsSquares: 0,
    blocks: 0,
  };
}

function resetStreamingAudioState(state) {
  state.channels.length = 0;
  state.gain = 1;
  state.samples = 0;
  state.frames = 0;
  state.clippedSamples = 0;
  state.peak = 0;
  state.rmsSquares = 0;
  state.blocks = 0;
}

function processStreamingSample(sample, state) {
  if (!sample || typeof sample.copyTo !== 'function' || !sample.numberOfChannels) {
    throw new TypeError('Streaming audio processor requires a decoded AudioSample');
  }
  const channels = sample.numberOfChannels;
  const frames = sample.numberOfFrames;
  const input = new Float32Array(frames * channels);
  sample.copyTo(input, { planeIndex: 0, format: 'f32' });
  const output = new Float32Array(input.length);
  const rate = sample.sampleRate;
  const highpassAlpha = 1 / (1 + 2 * Math.PI * state.highpassHz / rate);
  const lowpassAlpha = 1 - Math.exp(-2 * Math.PI * Math.min(state.lowpassHz, rate * 0.48) / rate);
  const attack = 1 - Math.exp(-1 / (rate * 0.006));
  const release = 1 - Math.exp(-1 / (rate * 0.09));
  while (state.channels.length < channels) state.channels.push({ previousInput: 0, highpass: 0, lowpass: 0, gate: 1 });

  let sumSquares = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const index = frame * channels + channel;
      const filter = state.channels[channel];
      const value = Number.isFinite(input[index]) ? input[index] : 0;
      filter.highpass = highpassAlpha * (filter.highpass + value - filter.previousInput);
      filter.previousInput = value;
      filter.lowpass += lowpassAlpha * (filter.highpass - filter.lowpass);
      const magnitude = Math.abs(filter.lowpass);
      const open = magnitude >= state.noiseGate ? 1 : 1 - state.noiseReduction;
      filter.gate += (open - filter.gate) * (open > filter.gate ? attack : release);
      const filtered = filter.lowpass * filter.gate;
      output[index] = filtered;
      sumSquares += filtered * filtered;
    }
  }

  const blockRms = Math.sqrt(sumSquares / Math.max(1, output.length));
  const desiredGain = blockRms > state.noiseGate
    ? clamp(state.targetRms / Math.max(blockRms, 1e-6), 0.35, 4)
    : state.gain;
  // Gain reductions react quickly; boosts are deliberately slow to avoid
  // pumping room noise between phrases.
  state.gain += (desiredGain - state.gain) * (desiredGain < state.gain ? 0.28 : 0.035);
  const appliedGain = state.gain * state.userGain;
  for (let index = 0; index < output.length; index++) {
    const gained = output[index] * appliedGain;
    if (Math.abs(gained) > state.limiter) state.clippedSamples++;
    output[index] = clamp(gained, -state.limiter, state.limiter);
    state.peak = Math.max(state.peak, Math.abs(output[index]));
  }

  state.samples++;
  state.frames += frames;
  state.rmsSquares += blockRms * blockRms;
  state.blocks++;
  return new sample.constructor({
    data: output,
    format: 'f32',
    numberOfChannels: channels,
    sampleRate: rate,
    timestamp: sample.timestamp,
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export const __audioTest = {
  createStreamingAudioState,
  processStreamingSample,
};
