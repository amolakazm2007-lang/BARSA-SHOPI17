import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityLockFingerprint, assertQualityLockFingerprint } from '../src/engine/RenderFingerprint.js';
import { readFile } from 'node:fs/promises';

test('quality lock fingerprint accepts identical final render semantics', async () => {
  const input = { settings: { upscaleModelId: 'u1', rifeModelId: 'r1', faceModelId: 'f1', outputFormat: 'mp4', effects: { sharpen: 0.2 } }, width: 3840, height: 2160, fps: 60, bitrate: 50_000_000, models: { upscale: 'u1', rife: 'r1', face: 'f1' } };
  const a = await createQualityLockFingerprint(input);
  const b = await createQualityLockFingerprint(input);
  assert.equal(assertQualityLockFingerprint(a, b, { phase: 'commit' }), true);
});

test('quality lock fingerprint blocks model, resolution, FPS or bitrate mutation', async () => {
  const base = { settings: { upscaleModelId: 'u1', outputFormat: 'mp4' }, width: 3840, height: 2160, fps: 60, bitrate: 50_000_000, models: { upscale: 'u1', rife: null, face: null } };
  const expected = await createQualityLockFingerprint(base);
  for (const changed of [
    { ...base, width: 1920 },
    { ...base, fps: 30 },
    { ...base, bitrate: 12_000_000 },
    { ...base, settings: { ...base.settings, upscaleModelId: 'u2' }, models: { ...base.models, upscale: 'u2' } },
  ]) {
    const actual = await createQualityLockFingerprint(changed);
    assert.throws(() => assertQualityLockFingerprint(expected, actual, { phase: 'resume' }), (error) => error?.code === 'QUALITY_LOCK_VIOLATION' && error?.recoverable === false);
  }
});

test('VideoPipeline verifies quality lock at resume and before final commit', async () => {
  const source = await readFile(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
  assert.match(source, /assertQualityLockFingerprint\(resumeCheckpoint\.qualityLockFingerprint, qualityLockFingerprint, \{ phase: 'resume' \}\)/);
  assert.match(source, /assertQualityLockFingerprint\(qualityLockFingerprint, finalQualityLockFingerprint, \{ phase: 'commit' \}\)/);
  assert.match(source, /qualityLockFingerprint: finalQualityLockFingerprint/);
});
