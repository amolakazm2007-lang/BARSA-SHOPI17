import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAVSync } from '../src/engine/VideoPipeline.js';

test('A/V sync accepts bounded decoded-audio drift', () => {
  const result = validateAVSync({ expectedVideoDuration: 60, outputDuration: 60, expectAudio: true, nativeAudioStats: { measuredDuration: 60.08 } });
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.driftSeconds) < result.toleranceSeconds);
});

test('A/V sync rejects large decoded-audio drift', () => {
  assert.throws(() => validateAVSync({ expectedVideoDuration: 60, outputDuration: 60, expectAudio: true, nativeAudioStats: { measuredDuration: 61 } }), /Audio sync drift/);
});

test('A/V sync reports indirect validation when exact audio timeline is unavailable', () => {
  const result = validateAVSync({ expectedVideoDuration: 10, outputDuration: 10, expectAudio: true });
  assert.equal(result.mode, 'container-duration-only');
});
