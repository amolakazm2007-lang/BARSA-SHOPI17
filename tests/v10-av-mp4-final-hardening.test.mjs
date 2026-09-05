import test from 'node:test';
import assert from 'node:assert/strict';
import { streamAudioTrack, validateAVSync } from '../src/engine/VideoPipeline.js';
import { NativeMP4Muxer } from '../src/engine/NativeMP4Muxer.js';
import { readFile } from 'node:fs/promises';

class Sample {
  constructor(timestamp, duration = 0.02) {
    this.timestamp = timestamp;
    this.duration = duration;
    this.numberOfFrames = Math.round(duration * 48000);
    this.sampleRate = 48000;
    this.closed = false;
  }
  close() { this.closed = true; }
}

test('native audio timeline uses Mediabunny seconds, not WebCodecs microseconds', async () => {
  const samples = [new Sample(2.0), new Sample(2.02), new Sample(2.04)];
  const mediaSession = { async *audioSamples() { for (const sample of samples) yield sample; } };
  const muxer = { async addAudioSample() {} };
  const timeline = await streamAudioTrack(mediaSession, muxer, null);
  assert.equal(timeline.inputChunks, 3);
  assert.ok(Math.abs(timeline.measuredDuration - 0.06) < 1e-9);
  assert.ok(samples.every((sample) => sample.closed));
});

test('native audio rejects backwards timestamps so pipeline can fall back safely', async () => {
  const samples = [new Sample(1.0), new Sample(0.9)];
  const mediaSession = { async *audioSamples() { for (const sample of samples) yield sample; } };
  await assert.rejects(() => streamAudioTrack(mediaSession, { async addAudioSample() {} }, null), /not monotonic/);
  assert.ok(samples.every((sample) => sample.closed));
});

test('native audio rejects empty decoded track', async () => {
  const mediaSession = { async *audioSamples() {} };
  await assert.rejects(() => streamAudioTrack(mediaSession, { async addAudioSample() {} }, null), /no decodable samples/);
});

test('A/V validation accepts correctly measured second-based audio duration', () => {
  const result = validateAVSync({ expectedVideoDuration: 60, outputDuration: 60, nativeAudioStats: { measuredDuration: 60.04 }, expectAudio: true });
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.driftSeconds - 0.04) < 1e-9);
});

test('native mux lifecycle is finalization-safe and releases OPFS scratch output', async () => {
  const muxer = new NativeMP4Muxer({ width: 1920, height: 1080, fps: 30, codec: 'avc1.42E01E' });
  let removed = 0;
  muxer.started = true;
  muxer.output = { finalize: async () => {}, state: 'started' };
  muxer.opfsOutput = {
    getFile: async () => new Blob([new Uint8Array(128)], { type: 'video/mp4' }),
    remove: async () => { removed++; },
  };
  const blob = await muxer.finalize();
  assert.equal(blob.size, 128);
  assert.equal(muxer.finalized, true);
  assert.equal(muxer.started, false);
  await assert.rejects(() => muxer.finalize(), /already finalized/);
  await muxer.releaseOutputFile();
  assert.equal(removed, 1);
  await muxer.releaseOutputFile();
  assert.equal(removed, 1);
});

test('FFmpeg progress callbacks are throttled in source to protect UI thread', async () => {
  const source = await readFile(new URL('../src/engine/FFmpegEngine.js', import.meta.url), 'utf8');
  assert.match(source, /now - lastProgressEmit < 100/);
});

test('validated native MP4 output removes its OPFS scratch file', async () => {
  const source = await readFile(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
  assert.match(source, /await nativeMp4\?\.releaseOutputFile\?\.\(\)/);
});

test('successful exports remove resumable OPFS session artifacts immediately', async () => {
  const source = await readFile(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
  const cleanupCalls = source.match(/await storage\.deleteSession\(jobId\)\.catch\(\(\) => \{\}\)/g) || [];
  assert.ok(cleanupCalls.length >= 2, `expected cleanup in native and FFmpeg completion paths, got ${cleanupCalls.length}`);
});

test('MP4 metadata validation removes both event listeners on any terminal outcome', async () => {
  const source = await readFile(new URL('../src/engine/ExportValidator.js', import.meta.url), 'utf8');
  assert.match(source, /removeEventListener\('loadedmetadata', onLoaded\)/);
  assert.match(source, /removeEventListener\('error', onError\)/);
  assert.match(source, /if \(settled\) return/);
});
