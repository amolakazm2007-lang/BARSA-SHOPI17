import test from 'node:test';
import assert from 'node:assert/strict';
import { PeriodicResumeVerifier } from '../src/engine/PeriodicResumeVerifier.js';

test('verifies checkpoint every fixed frame interval', async () => {
  const calls = [];
  const verifier = new PeriodicResumeVerifier({
    storage: {
      async getCheckpoint() { calls.push('checkpoint'); return { durableEncodedFrames: 10 }; },
      async verifySessionIntegrity() { calls.push('integrity'); return { ok: true }; },
    },
    sessionId: 'job-1',
    everyFrames: 10,
    logger: { info() {} },
  });
  assert.equal((await verifier.verify(9)).skipped, true);
  const result = await verifier.verify(10);
  assert.equal(result.skipped, false);
  assert.deepEqual(calls, ['checkpoint', 'integrity']);
});

test('rejects non-durable checkpoint instead of pretending resume is safe', async () => {
  const verifier = new PeriodicResumeVerifier({
    storage: { async getCheckpoint() { return { durableEncodedFrames: 8 }; } },
    sessionId: 'job-2',
    everyFrames: 10,
    logger: { info() {} },
  });
  await assert.rejects(verifier.verify(10), (error) => error.code === 'CHECKPOINT_NOT_DURABLE');
});

test('rejects corrupt resume integrity result', async () => {
  const verifier = new PeriodicResumeVerifier({
    storage: {
      async getCheckpoint() { return { durableEncodedFrames: 20 }; },
      async verifySessionIntegrity() { return { ok: false }; },
    },
    sessionId: 'job-3',
    everyFrames: 10,
    logger: { info() {} },
  });
  await assert.rejects(verifier.verify(20), (error) => error.code === 'CHECKPOINT_CORRUPT');
});
