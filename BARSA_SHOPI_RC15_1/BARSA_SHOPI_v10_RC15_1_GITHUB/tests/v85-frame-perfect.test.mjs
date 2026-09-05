import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameIntegrityMonitor } from '../src/engine/FrameIntegrityMonitor.js';

test('v8.5 frame integrity accepts complete CFR sequence with zero missing frames', () => {
  const m = new FrameIntegrityMonitor({ sourceFps: 60, targetFps: 60 });
  const d = 1_000_000 / 60;
  for (let i = 0; i < 120; i++) {
    m.observeDecoded(Math.round(i*d), Math.round(d));
    m.observeProcessed();
    m.observeEncoded(Math.round(i*d));
  }
  const r = m.finalize({ outputDurationUs: 120*d });
  assert.equal(r.decodedFrames, 120);
  assert.equal(r.encodedFrames, 120);
  assert.equal(r.outputMissing, 0);
});

test('v8.5 frame integrity rejects a skipped output timestamp', () => {
  const m = new FrameIntegrityMonitor({ sourceFps: 60, targetFps: 60 });
  const d = 1_000_000 / 60;
  for (let i = 0; i < 4; i++) { m.observeDecoded(Math.round(i*d), Math.round(d)); m.observeProcessed(); }
  m.observeEncoded(0);
  m.observeEncoded(Math.round(d));
  m.observeEncoded(Math.round(3*d));
  assert.throws(() => m.finalize(), /missing/);
});

test('v8.5 strict mode rejects non-monotonic decoded source order', () => {
  const m = new FrameIntegrityMonitor({ sourceFps: 30, targetFps: 30 });
  m.observeDecoded(0, 33333); m.observeProcessed();
  m.observeDecoded(33333, 33333); m.observeProcessed();
  m.observeDecoded(20000, 33333); m.observeProcessed();
  m.observeEncoded(0); m.observeEncoded(33333); m.observeEncoded(66667);
  assert.throws(() => m.finalize(), /Source frame order/);
});

test('v8.5 frame integrity rejects encoder/output accounting mismatch before mux', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8'));
  assert.match(source, /writer\.frameIndex !== encodedFrames/);
  assert.match(source, /Frame-perfect decoder unavailable/);
  assert.match(source, /allowIrregularRatio: 0/);
});

test('v8.5 All Engine Boost includes Quality V2 and Face V2 stages', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8'));
  for (const token of ['microTexture:.72','structureRecovery:.78',"'fl-microcontrast':.38","'fl-toneprotect':.72",'frameIntegrity:{strict:true}']) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});
