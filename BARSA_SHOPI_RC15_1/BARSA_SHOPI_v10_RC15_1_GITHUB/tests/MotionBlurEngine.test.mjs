import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBlurSampleCount, createBlurWeights, frameDifference } from '../src/engine/MotionBlurEngine.js';

test('motion blur sample count follows internal/output FPS and amount', () => {
  assert.equal(calculateBlurSampleCount(120, 60, 1), 2);
  assert.equal(calculateBlurSampleCount(240, 60, 1.5), 6);
  assert.equal(calculateBlurSampleCount(60, 60, 0), 0);
});

test('all supported blur weighting modes are normalized', () => {
  for (const method of ['equal', 'gaussian_sym', 'vegas', 'pyramid', 'gaussian', 'ascending', 'descending', 'gaussian_reverse']) {
    const weights = createBlurWeights(7, { method, stdDev: 1, mean: 0, bound: [-2, 2] });
    assert.equal(weights.length, 7);
    assert.ok(weights.every((weight) => weight >= 0));
    assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  }
  assert.deepEqual(createBlurWeights(3, { method: 'custom', customWeights: '1,2,1' }), [.25, .5, .25]);
});

test('frame signatures distinguish duplicate and unrelated frames', () => {
  assert.equal(frameDifference(new Uint8Array([10, 20]), new Uint8Array([10, 20])), 0);
  assert.equal(frameDifference(new Uint8Array([0, 0]), new Uint8Array([255, 255])), 1);
});
