import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, defaultRetryable, retryTransient, withTimeout } from '../src/engine/OperationGuard.js';

test('withTimeout aborts cooperative stalled operations', async () => {
  await assert.rejects(
    withTimeout(signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), { timeoutMs: 10, label: 'stalled-op' }),
    error => error?.name === 'TimeoutError',
  );
});

test('withTimeout rejects even when a legacy operation ignores AbortSignal', async () => {
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), { timeoutMs: 10, label: 'legacy-stall' }),
    error => error?.name === 'TimeoutError',
  );
});

test('retryTransient retries network-like failures and then succeeds', async () => {
  let calls = 0;
  const value = await retryTransient(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('network down');
    return 'ok';
  }, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('model integrity failures are never retried', () => {
  assert.equal(defaultRetryable({ code: 'MODEL_SHA_MISMATCH' }), false);
});

test('CircuitBreaker opens after repeated failures and recovers after cooldown', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10 });
  await assert.rejects(breaker.execute(async () => { throw new Error('x'); }));
  await assert.rejects(breaker.execute(async () => { throw new Error('x'); }));
  await assert.rejects(breaker.execute(async () => 'never'), error => error?.code === 'CIRCUIT_OPEN');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(await breaker.execute(async () => 'ok'), 'ok');
  assert.equal(breaker.state, 'closed');
});
