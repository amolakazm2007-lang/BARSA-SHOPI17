import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_CRASH_PROOF_PROOFS, evaluateCrashProofRelease } from '../src/engine/CrashProofReleaseGate.js';

test('release gate refuses incomplete crash-proof evidence', () => {
  assert.throws(() => evaluateCrashProofRelease({ 'hard-timeout': true }), (error) => error.code === 'CRASH_PROOF_GATE_FAILED');
});

test('release gate passes only with every required proof', () => {
  const proofs = Object.fromEntries(REQUIRED_CRASH_PROOF_PROOFS.map((name) => [name, true]));
  assert.equal(evaluateCrashProofRelease(proofs).ok, true);
});
