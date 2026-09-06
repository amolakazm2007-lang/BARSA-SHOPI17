import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const files = [
  'src/engine/CrashProofRuntime.js',
  'src/engine/CrashProofFallbackPolicy.js',
  'src/engine/PeriodicResumeVerifier.js',
  'src/engine/WorkerCrashGuard.js',
  'src/engine/WebGLContextGuard.js',
  'src/engine/GPUDeviceLossGuard.js',
  'src/engine/CrashProofAuditLog.js',
  'src/engine/CrashProofQualityLock.js',
  'src/engine/CrashProofReleaseGate.js',
];

test('all crash-proof P0 modules exist', () => {
  for (const file of files) assert.equal(existsSync(file), true, `${file} missing`);
});
