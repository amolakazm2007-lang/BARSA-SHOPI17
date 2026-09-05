import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneChangeScore } from '../src/engine/SceneChangeDetector.js';

function solid(value, pixels = 256) {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
  return data;
}

test('scene detector identifies a hard cut', () => {
  assert.ok(sceneChangeScore(solid(0), solid(255)) > 0.9);
});

test('scene detector ignores a small exposure drift', () => {
  assert.ok(sceneChangeScore(solid(110), solid(120)) < 0.12);
});

test('scene detector validates matching buffers', () => {
  assert.throws(() => sceneChangeScore(solid(0, 2), solid(0, 3)), /equal/);
});
