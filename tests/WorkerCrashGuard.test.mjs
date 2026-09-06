import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerCrashGuard } from '../src/engine/WorkerCrashGuard.js';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
}

class FakeWorker extends EventTarget {
  constructor() { super(); this.terminated = false; }
  terminate() { this.terminated = true; }
}

test('worker timeout terminates worker and uses fallback', async () => {
  let worker;
  const guard = new WorkerCrashGuard({
    workerFactory: () => (worker = new FakeWorker()),
    timeoutMs: 1000,
    logger: { error() {} },
  });
  guard.timeoutMs = 20;
  const result = await guard.run({
    id: 1,
    post() {},
    wait: new Promise(() => {}),
    label: 'hung worker',
    fallback: (error) => ({ fallback: true, code: error.code }),
  });
  assert.equal(result.fallback, true);
  assert.equal(result.code, 'OPERATION_TIMEOUT');
  assert.equal(worker.terminated, true);
});

test('messageerror crashes generation without bringing down caller', async () => {
  const worker = new FakeWorker();
  const guard = new WorkerCrashGuard({ workerFactory: () => worker, logger: { error() {} } });
  guard.ensure();
  worker.dispatchEvent(new MessageEvent('messageerror', { data: { broken: true } }));
  assert.equal(worker.terminated, true);
  assert.equal(guard.worker, null);
});
