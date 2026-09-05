import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceScope, usingResourceScope } from '../src/engine/ResourceScope.js';

test('ResourceScope releases tracked resources in reverse order', async () => {
  const calls = [];
  const scope = new ResourceScope('test');
  scope.track({ close() { calls.push('a'); } });
  scope.track({ destroy() { calls.push('b'); } });
  await scope.close();
  assert.deepEqual(calls, ['b', 'a']);
  assert.equal(scope.size, 0);
});

test('usingResourceScope releases resources after callback failure', async () => {
  let closed = false;
  await assert.rejects(
    usingResourceScope('failure', async scope => {
      scope.track({ close() { closed = true; } });
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(closed, true);
});

test('ResourceScope reports cleanup failures instead of swallowing them', async () => {
  const scope = new ResourceScope('cleanup-failure');
  scope.track({ close() { throw new Error('release failed'); } });
  await assert.rejects(scope.close(), error => error?.code === 'RESOURCE_RELEASE_FAILED');
});
