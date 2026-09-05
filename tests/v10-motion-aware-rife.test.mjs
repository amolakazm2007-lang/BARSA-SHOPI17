import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneChangeScore } from '../src/engine/SceneChangeDetector.js';

test('identical frames score zero so RIFE can safely skip static pairs', () => {
  const a = new Uint8ClampedArray(4 * 16).fill(128);
  for (let i = 3; i < a.length; i += 4) a[i] = 255;
  const b = new Uint8ClampedArray(a);
  assert.equal(sceneChangeScore(a, b), 0);
});

test('large luminance changes exceed the static-skip floor', () => {
  const a = new Uint8ClampedArray(4 * 16);
  const b = new Uint8ClampedArray(4 * 16);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = a[i+1] = a[i+2] = 10; a[i+3] = 255;
    b[i] = b[i+1] = b[i+2] = 220; b[i+3] = 255;
  }
  assert.ok(sceneChangeScore(a, b) > 0.0035);
});
