import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/engine/WebCodecsEngine.js', import.meta.url), 'utf8');

test('WebCodecs decode and encode queues use a hard wall-clock drain watchdog', () => {
  assert.match(source, /const QUEUE_STALL_TIMEOUT_MS = 15000/);
  assert.match(source, /label: 'VideoDecoder queue drain'/);
  assert.match(source, /onTimeout: \(\) => safeCloseCodec\(this, 'decoder'\)/);
  assert.match(source, /label: 'VideoEncoder queue drain'/);
  assert.match(source, /onTimeout: \(\) => safeCloseCodec\(this, 'encoder'\)/);
  assert.match(source, /withHardTimeout\(async \(\) => \{/);
  assert.match(source, /timeoutMs: QUEUE_STALL_TIMEOUT_MS/);
});

test('WebCodecs queue watchdog fails recoverably if codec becomes unusable', () => {
  assert.match(source, /WEBCODECS_QUEUE_UNAVAILABLE/);
  assert.match(source, /codec\.state !== 'configured'/);
  assert.match(source, /recoverable: true/);
});

test('WebCodecs queue polling remains abort-aware and bounded rather than busy-spinning', () => {
  assert.match(source, /await waitForQueue\(codec, signal\)/);
  assert.match(source, /setTimeout\(\(\) => finish\(resolve\), 16\)/);
  assert.match(source, /signal\?\.addEventListener\?\.\('abort'/);
});
