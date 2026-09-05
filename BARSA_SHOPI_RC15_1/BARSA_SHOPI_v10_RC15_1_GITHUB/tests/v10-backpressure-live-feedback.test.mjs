import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AdaptiveBackpressure } from '../src/engine/AdaptiveBackpressure.js';

test('AdaptiveBackpressure shrinks on slow durable writes and recovers only after a fast streak', () => {
  const controller = new AdaptiveBackpressure({ maxLimit: 3, minLimit: 1, targetWriteMs: 10 });
  assert.equal(controller.limit, 3);
  controller.observeWrite(30);
  assert.equal(controller.limit, 1);
  for (let i = 0; i < 7; i++) controller.observeWrite(1);
  assert.equal(controller.limit, 1);
  for (let i = 0; i < 30 && controller.limit === 1; i++) controller.observeWrite(1);
  assert.ok(controller.limit >= 2);
});

test('VideoPipeline feeds measured OPFS/MP4 write latency back into backlog controller', () => {
  const source = fs.readFileSync(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
  assert.match(source, /maxWriteBacklog = backpressure\.observeWrite\(elapsedMs\)/);
  assert.match(source, /while \(writeBacklog >= maxWriteBacklog\)/);
});
