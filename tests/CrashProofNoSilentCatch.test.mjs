import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modules = [
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

test('crash-proof modules contain no empty catch blocks or empty catch callbacks', () => {
  for (const file of modules) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/catch\s*\([^)]*\)\s*\{\s*\}/.test(source), false, `${file} has empty catch block`);
    assert.equal(/\.catch\s*\(\s*\(.*?\)\s*=>\s*\{\s*\}\s*\)/s.test(source), false, `${file} has silent catch callback`);
  }
});
