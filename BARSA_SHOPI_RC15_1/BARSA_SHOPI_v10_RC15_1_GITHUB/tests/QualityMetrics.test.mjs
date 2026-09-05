import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImageData, summarizeMetrics } from '../src/engine/QualityMetricsEngine.js';

function solid(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { data, width, height };
}

test('quality metrics detect fully clipped output', () => {
  const metric = analyzeImageData(solid(8, 8, 255));
  assert.equal(metric.clippingRatio, 1);
  const summary = summarizeMetrics([metric]);
  assert.ok(summary.score < 60);
  assert.ok(summary.warnings.some((warning) => warning.includes('قصّ')));
});

test('quality metrics keep a neutral midtone frame clean', () => {
  const summary = summarizeMetrics([analyzeImageData(solid(8, 8, 128))]);
  assert.equal(summary.score, 100);
  assert.deepEqual(summary.warnings, []);
});

