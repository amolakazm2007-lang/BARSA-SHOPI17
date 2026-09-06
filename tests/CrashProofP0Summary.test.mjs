import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P0 crash-proof runtime contains required protections', () => {
  const runtime = readFileSync('src/engine/CrashProofRuntime.js', 'utf8');
  const fallback = readFileSync('src/engine/CrashProofFallbackPolicy.js', 'utf8');
  const resume = readFileSync('src/engine/PeriodicResumeVerifier.js', 'utf8');
  const worker = readFileSync('src/engine/WorkerCrashGuard.js', 'utf8');
  const quality = readFileSync('src/engine/CrashProofQualityLock.js', 'utf8');
  assert.match(runtime, /OPERATION_TIMEOUT/);
  assert.match(runtime, /PIPELINE_STALLED/);
  assert.match(fallback, /WebGPU/);
  assert.match(fallback, /WebGL2/);
  assert.match(fallback, /Canvas2D/);
  assert.match(resume, /CHECKPOINT_CORRUPT/);
  assert.match(worker, /messageerror/);
  assert.match(quality, /QUALITY_LOCK_VIOLATION/);
});
