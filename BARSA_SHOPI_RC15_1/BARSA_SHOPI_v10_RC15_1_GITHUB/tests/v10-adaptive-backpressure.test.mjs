import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveBackpressure } from '../src/engine/AdaptiveBackpressure.js';

test('slow durable writes collapse backlog before RAM can grow', () => {
  const bp = new AdaptiveBackpressure({ maxLimit: 3, targetWriteMs: 10 });
  for (let i = 0; i < 5; i++) bp.observeWrite(30);
  assert.equal(bp.limit, 1);
});

test('sustained fast writes recover bounded throughput slowly', () => {
  const bp = new AdaptiveBackpressure({ maxLimit: 3, targetWriteMs: 10 });
  for (let i = 0; i < 5; i++) bp.observeWrite(30);
  assert.equal(bp.limit, 1);
  for (let i = 0; i < 30; i++) bp.observeWrite(1);
  assert.ok(bp.limit >= 2 && bp.limit <= 3);
});
