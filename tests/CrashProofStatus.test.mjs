import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofStatus, summarizeProofs } from '../src/engine/CrashProofStatus.js';

test('unproven proof prevents ready state', () => {
  const summary = summarizeProofs(['real-webgpu-loss'], {});
  assert.equal(summary.ready, false);
  assert.equal(summary.unproven, 1);
});

test('only all PASS becomes ready', () => {
  const summary = summarizeProofs(['a', 'b'], { a: { status: ProofStatus.PASS }, b: { status: ProofStatus.PASS } });
  assert.equal(summary.ready, true);
});
