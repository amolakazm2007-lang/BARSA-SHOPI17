import test from 'node:test';
import assert from 'node:assert/strict';
import { FFmpegEngine } from '../src/engine/FFmpegEngine.js';

function mockEngine() {
  const engine = new FFmpegEngine();
  engine.loaded = true;
  engine.ffmpeg = { readFile: async () => new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112]) };
  engine._write = async () => {};
  engine._cleanup = async () => {};
  return engine;
}

test('MP4 remux converts IVF to H.264 yuv420p and writes fast-start metadata', async () => {
  const engine = mockEngine();
  let args;
  engine._exec = async (value) => { args = value; };
  const blob = await engine.remux({ video: new Blob(['ivf']), outputFormat: 'mp4', elementaryFormat: 'ivf-vp9', fps: 30, videoCRF: 17, videoPreset: 'medium' });
  assert.equal(blob.type, 'video/mp4');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.deepEqual(args.slice(args.indexOf('-movflags'), args.indexOf('-movflags') + 2), ['-movflags', '+faststart']);
  assert.ok(!args.includes('-c:a'));
});

test('FFmpeg transcode removes audio when the user disables it', async () => {
  const engine = mockEngine();
  let args;
  engine._exec = async (value) => { args = value; };
  await engine.transcode(new Blob(['source']), 'source.webm', { format: 'mp4', includeAudio: false, codec: 'libx264' });
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('-c:a'));
  assert.ok(args.includes('+faststart'));
});
