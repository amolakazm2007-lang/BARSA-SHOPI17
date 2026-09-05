import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/engine/AudioEngine.js';

class MockAudioSample {
  constructor(init) {
    this.data = init.data;
    this.format = init.format;
    this.numberOfChannels = init.numberOfChannels;
    this.sampleRate = init.sampleRate;
    this.timestamp = init.timestamp;
    this.numberOfFrames = init.data.length / init.numberOfChannels;
  }

  copyTo(destination) { destination.set(this.data); }
}

test('streaming audio processing is bounded and preserves timestamps', () => {
  const engine = new AudioEngine();
  const processor = engine.createStreamingProcessor({ normalizeLufs: -16, truePeakDb: -2, noiseReduction: 0.2 });
  const data = new Float32Array(960 * 2);
  for (let frame = 0; frame < 960; frame++) {
    const value = Math.sin(2 * Math.PI * 440 * frame / 48000) * 0.9;
    data[frame * 2] = value;
    data[frame * 2 + 1] = value;
  }
  const output = processor.process(new MockAudioSample({ data, format: 'f32', numberOfChannels: 2, sampleRate: 48000, timestamp: 1.25 }));
  const limit = 10 ** (-2 / 20) + 1e-6;
  assert.equal(output.timestamp, 1.25);
  assert.equal(output.numberOfFrames, 960);
  assert.ok(output.data.every((value) => Math.abs(value) <= limit));
  assert.equal(processor.stats().samples, 1);
  assert.equal(processor.stats().frames, 960);
});

