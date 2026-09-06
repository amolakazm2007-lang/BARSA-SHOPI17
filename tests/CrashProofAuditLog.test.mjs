import test from 'node:test';
import assert from 'node:assert/strict';
import { CrashProofAuditLog } from '../src/engine/CrashProofAuditLog.js';

test('structured audit log preserves visible failure records', () => {
  const sink = { error() {}, warn() {}, info() {} };
  const log = new CrashProofAuditLog({ sink, maxEntries: 50 });
  log.error('GPU_DEVICE_LOST', 'GPU failed', { backend: 'webgpu' });
  const [entry] = log.snapshot();
  assert.equal(entry.level, 'error');
  assert.equal(entry.code, 'GPU_DEVICE_LOST');
  assert.equal(entry.details.backend, 'webgpu');
});
