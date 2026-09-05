import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacingMonitor } from '../src/engine/ExportValidator.js';

test('frame pacing accepts rounded CFR timestamps without storing the timeline', () => {
  const monitor = new FramePacingMonitor(60);
  for (let index = 0; index < 600; index++) monitor.observe(Math.round(index * 1_000_000 / 60));
  const result = monitor.finalize();
  assert.equal(result.valid, true);
  assert.equal(result.frames, 600);
  assert.equal(Object.hasOwn(monitor, 'timestamps'), false);
});

test('frame pacing rejects duplicate and missing timestamps', () => {
  const duplicate = new FramePacingMonitor(30);
  duplicate.observe(0);
  duplicate.observe(0);
  assert.throws(() => duplicate.finalize(), /non-monotonic/);

  const missing = new FramePacingMonitor(30);
  missing.observe(0);
  missing.observe(66_667);
  assert.throws(() => missing.finalize(), /missing/);
});
