import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryGovernor } from '../src/engine/MemoryGovernor.js';
import { RuntimeHealthGuard } from '../src/engine/RuntimeHealthGuard.js';
import { BoundedAsyncQueue } from '../src/engine/BoundedAsyncQueue.js';

test('RuntimeHealthGuard blocks new heavy AI at critical pressure without lowering final quality', () => {
  const performance = { telemetry: { jsHeapUsedMB: 950, jsHeapLimitMB: 1000, gpuAllocatedMB: 100, gpuBudgetMB: 1000 } };
  const guard = new RuntimeHealthGuard({ memoryGovernor: new MemoryGovernor({ minBudgetMB: 64, maxBudgetMB: 1024 }), performance });
  const decision = guard.evaluate({ capabilities: { deviceMemoryGB: 8 }, workloadMB: 256, heavyAi: true });
  assert.equal(decision.state, 'critical');
  assert.equal(decision.allowNewHeavyAiWork, false);
  assert.equal(decision.concurrencyCap, 1);
  assert.equal(decision.queueCap, 1);
  assert.equal(decision.previewEnabled, false);
  assert.equal(decision.checkpointNow, true);
  assert.equal(decision.qualityLocked, true);
});

test('RuntimeHealthGuard keeps healthy work enabled', () => {
  const performance = { telemetry: { jsHeapUsedMB: 200, jsHeapLimitMB: 1000, gpuAllocatedMB: 100, gpuBudgetMB: 1000 } };
  const guard = new RuntimeHealthGuard({ memoryGovernor: new MemoryGovernor({ minBudgetMB: 64, maxBudgetMB: 1024 }), performance });
  const decision = guard.evaluate({ capabilities: { deviceMemoryGB: 8 }, workloadMB: 64, heavyAi: true });
  assert.equal(decision.allowNewHeavyAiWork, true);
  assert.equal(decision.qualityLocked, true);
});

test('BoundedAsyncQueue applies backpressure and preserves FIFO order', async () => {
  const q = new BoundedAsyncQueue(1);
  await q.push('a');
  let secondFinished = false;
  const second = q.push('b').then(() => { secondFinished = true; });
  await Promise.resolve();
  assert.equal(secondFinished, false);
  assert.equal(await q.pop(), 'a');
  await second;
  assert.equal(secondFinished, true);
  assert.equal(await q.pop(), 'b');
});

test('BoundedAsyncQueue aborts blocked producers', async () => {
  const q = new BoundedAsyncQueue(1);
  await q.push('a');
  const controller = new AbortController();
  const pending = q.push('b', { signal: controller.signal });
  controller.abort(new DOMException('cancel', 'AbortError'));
  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.equal(q.size, 1);
});
