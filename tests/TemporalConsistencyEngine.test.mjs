import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateExposureCorrection,
  calculateTemporalBlend,
  meanAbsoluteDifference,
} from '../src/engine/TemporalConsistencyEngine.js';

test('temporal denoise blends static frames but rejects motion and scene cuts', () => {
  assert.ok(calculateTemporalBlend(0.005, 1) > 0.35);
  assert.ok(calculateTemporalBlend(0.09, 1) < 0.2);
  assert.equal(calculateTemporalBlend(0.3, 1), 0);
  assert.equal(calculateTemporalBlend(0.005, 0), 0);
});

test('anti-flicker correction is bounded and disabled on strong motion', () => {
  assert.equal(calculateExposureCorrection(0.4, 0.5, 1, 0.15), 1);
  assert.equal(calculateExposureCorrection(0.4, 0.8, 1, 0.01), 1.08);
  assert.equal(calculateExposureCorrection(0.8, 0.4, 1, 0.01), 0.92);
  assert.equal(calculateExposureCorrection(0.4, 0.8, 0, 0.01), 1);
});

test('sample difference uses normalized luma rather than RGB byte distance', () => {
  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
  assert.equal(meanAbsoluteDifference(black, black), 0);
  assert.ok(Math.abs(meanAbsoluteDifference(black, white) - 1) < 0.001);
  assert.equal(meanAbsoluteDifference(black, new Uint8ClampedArray(4)), 1);
});
