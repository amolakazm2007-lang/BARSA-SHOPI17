import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceScope, usingResourceScope } from '../src/engine/ResourceScope.js';

test('ResourceScope disposes tracked resources exactly once in reverse order', async () => {
  const calls = [];
  const scope = new ResourceScope('ownership');
  const a = { close() { calls.push('a'); } };
  const b = { destroy() { calls.push('b'); } };
  scope.track(a);
  scope.track(b);
  await scope.close();
  await scope.close();
  assert.deepEqual(calls, ['b', 'a']);
  assert.equal(scope.size, 0);
});

test('ResourceScope reports cleanup failures and aggregates them', async () => {
  const faults = [];
  const scope = new ResourceScope('faults', { onFault: (fault) => faults.push(fault) });
  scope.track({ close() { throw new Error('close failed'); } });
  await assert.rejects(() => scope.close(), (error) => error.code === 'RESOURCE_RELEASE_FAILED');
  assert.equal(faults.length, 1);
  assert.equal(faults[0].code, 'RESOURCE_RELEASE_FAILED');
  assert.equal(faults[0].details.phase, 'close');
});

test('releaseAsync waits for asynchronous destruction', async () => {
  let released = false;
  const scope = new ResourceScope('async');
  const resource = { async release() { await Promise.resolve(); released = true; } };
  scope.track(resource);
  assert.equal(await scope.releaseAsync(resource), true);
  assert.equal(released, true);
  assert.equal(scope.size, 0);
});

test('usingResourceScope preserves primary failure while attaching cleanup failure', async () => {
  const primary = new Error('processor failed');
  await assert.rejects(
    () => usingResourceScope('dual-failure', async (scope) => {
      scope.track({ close() { throw new Error('cleanup failed'); } });
      throw primary;
    }),
    (error) => error === primary && error.cleanupError?.code === 'RESOURCE_RELEASE_FAILED',
  );
});
