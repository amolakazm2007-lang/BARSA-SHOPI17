import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFinalQualityLock, safeRecoveryPlan } from '../src/engine/CrashProofQualityLock.js';

test('critical recovery reduces only working pressure, never final quality', () => {
  const final = { width: 3840, height: 2160, fps: 60, bitrate: 50_000_000, expectedFrames: 600 };
  const plan = safeRecoveryPlan({ final, pressure: 'critical', queueDepth: 4, concurrency: 4, previewScale: 1 });
  assert.equal(plan.queueDepth, 1);
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.qualityLocked, true);
  assertFinalQualityLock(final, plan.final);
});

test('quality lock rejects resolution/FPS/bitrate/frame-count degradation', () => {
  const before = { width: 1920, height: 1080, fps: 60, bitrate: 20_000_000, expectedFrames: 120 };
  assert.throws(() => assertFinalQualityLock(before, { ...before, fps: 30 }), (error) => error.code === 'QUALITY_LOCK_VIOLATION');
});
