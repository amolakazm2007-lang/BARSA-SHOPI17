import test from 'node:test';
import assert from 'node:assert/strict';
import { FFmpegEngine } from '../src/engine/FFmpegEngine.js';

test('FFmpeg remux retries exactly once after a hard execution timeout', async () => {
  const engine = new FFmpegEngine();
  let attempts = 0;
  let reloads = 0;
  const params = { video: new Uint8Array([1, 2, 3]), outputFormat: 'mp4' };
  engine.lastLoadOptions = { multiThread: false };
  engine._remuxOnce = async (received) => {
    attempts++;
    assert.equal(received, params);
    if (attempts === 1) throw Object.assign(new Error('hung'), { code: 'OPERATION_TIMEOUT' });
    return 'recovered';
  };
  engine.load = async (options) => {
    reloads++;
    assert.equal(options.multiThread, false);
  };
  assert.equal(await engine.remux(params), 'recovered');
  assert.equal(attempts, 2);
  assert.equal(reloads, 1);
});

test('FFmpeg remux does not retry non-timeout failures', async () => {
  const engine = new FFmpegEngine();
  let attempts = 0;
  let reloads = 0;
  engine._remuxOnce = async () => {
    attempts++;
    throw Object.assign(new Error('bad input'), { code: 'FFMPEG_EXEC_FAILED' });
  };
  engine.load = async () => { reloads++; };
  await assert.rejects(() => engine.remux({}), /bad input/);
  assert.equal(attempts, 1);
  assert.equal(reloads, 0);
});

test('FFmpeg remux stops after the single replacement-instance retry', async () => {
  const engine = new FFmpegEngine();
  let attempts = 0;
  let reloads = 0;
  engine._remuxOnce = async () => {
    attempts++;
    throw Object.assign(new Error('still hung'), { code: 'OPERATION_TIMEOUT' });
  };
  engine.load = async () => { reloads++; };
  await assert.rejects(() => engine.remux({}), /still hung/);
  assert.equal(attempts, 2);
  assert.equal(reloads, 1);
});
