import test from 'node:test';
import assert from 'node:assert/strict';
import { DoctorControlPlane } from '../src/engine/DoctorControlPlane.js';

function makePlane(runtimeDecision, telemetry = {}, storage = null) {
  return new DoctorControlPlane({
    runtimeGuard: { evaluate: () => Object.freeze({ ...runtimeDecision }) },
    performance: { telemetry },
    storage,
  });
}

test('Doctor control plane never changes final quality while throttling pressure', () => {
  const plane = makePlane({
    state: 'critical', allowNewHeavyAiWork: false, concurrencyCap: 1, queueCap: 1,
    previewEnabled: false, checkpointNow: true, heapRatio: 0.96, gpuRatio: 0.81,
    reason: 'RESOURCE_PRESSURE_CRITICAL',
  }, { thermalStatus: 5 });
  const decision = plane.assessRuntime({ workloadMB: 900, heavyAi: true, jobId: 'job-1' });
  assert.equal(decision.gate.allowNewHeavyAiWork, false);
  assert.equal(decision.gate.checkpointBeforeHeavyWork, true);
  assert.equal(decision.throttle.concurrencyCap, 1);
  assert.equal(decision.throttle.queueCap, 1);
  assert.equal(decision.throttle.previewEnabled, false);
  assert.equal(decision.throttle.finalResolutionLocked, true);
  assert.equal(decision.throttle.finalFpsLocked, true);
  assert.equal(decision.throttle.finalBitrateLocked, true);
  assert.equal(decision.throttle.finalModelLocked, true);
  assert.equal(decision.commit.finalQualityMutationAllowed, false);
  assert.equal(decision.qualityLocked, true);
});

test('Doctor control plane permits healthy work and keeps bounded policy', () => {
  const plane = makePlane({
    state: 'normal', allowNewHeavyAiWork: true, concurrencyCap: 3, queueCap: 4,
    previewEnabled: true, checkpointNow: false, heapRatio: 0.21, gpuRatio: 0.18,
    reason: 'HEALTHY',
  });
  const decision = plane.assessRuntime({ workloadMB: 120, heavyAi: true });
  assert.equal(decision.gate.allowNewWork, true);
  assert.equal(decision.gate.allowNewHeavyAiWork, true);
  assert.equal(decision.throttle.concurrencyCap, 3);
  assert.equal(decision.throttle.queueCap, 4);
  assert.equal(decision.throttle.previewFpsCap, 12);
  assert.equal(decision.commit.outcome, 'COMMIT_POLICY');
});

test('Doctor quality-lock verifier detects forbidden final-output mutation', () => {
  const plane = makePlane({ state: 'normal', allowNewHeavyAiWork: true, concurrencyCap: 1, queueCap: 1 });
  const valid = plane.verifyQualityLock(
    { width: 3840, height: 2160, fps: 60, bitrateK: 50000, upscaleModel: 'model-a' },
    { width: 3840, height: 2160, fps: 60, bitrateK: 50000, upscaleModel: 'model-a' },
  );
  assert.equal(valid.valid, true);

  const invalid = plane.verifyQualityLock(
    { width: 3840, height: 2160, fps: 60, bitrateK: 50000, upscaleModel: 'model-a' },
    { width: 1920, height: 1080, fps: 30, bitrateK: 12000, upscaleModel: 'model-b' },
  );
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.violations.map((row) => row.field), ['width', 'height', 'fps', 'bitrateK', 'upscaleModel']);
});

test('Doctor storage gate blocks new heavy work only at critical durable-storage pressure', () => {
  const runtime = {
    state: 'normal', allowNewHeavyAiWork: true, concurrencyCap: 2, queueCap: 3,
    previewEnabled: true, checkpointNow: false, heapRatio: 0.2, gpuRatio: 0.2, reason: 'HEALTHY',
  };
  const plane = makePlane(runtime, {}, { lastUsage: { usageBytes: 950, quotaBytes: 1000 } });
  const decision = plane.assessRuntime({ heavyAi: true });
  assert.equal(decision.observe.storagePressure, 'critical');
  assert.equal(decision.gate.allowNewWork, false);
  assert.equal(decision.gate.reason, 'STORAGE_PRESSURE_CRITICAL');
  assert.ok(decision.repair.actions.includes('STORAGE_RECONCILE_SAFE_CACHE'));
});
