import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlurConfiguration } from '../src/engine/VideoPipeline.js';

test('Blur keeps final and internal frame rates independent', () => {
  const settings = normalizeBlurConfiguration({ enabled: true, outputFps: 60, interpolation: true, interpolationFps: 240, amount: 1.5 }, 60, 60);
  assert.equal(settings.outputFps, 60);
  assert.equal(settings.interpolationFps, 240);
  assert.equal(settings.amount, 1.5);
});

test('Same as Source resolves against source metadata', () => {
  const settings = normalizeBlurConfiguration({ enabled: true, outputFps: 'source', interpolationFps: 'source', interpolationMultiplier: 2 }, 59.94, 30);
  assert.equal(settings.outputFps, 59.94);
  assert.equal(settings.interpolationFps, 119.88);
});
