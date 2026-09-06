import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeFaultLedger } from '../src/engine/RuntimeFaultLedger.js';
import { RuntimeFaultReporter, inferRuntimeSubsystem } from '../src/engine/RuntimeFaultReporter.js';

test('RuntimeFaultReporter records normalized warnings in the ledger', () => {
  const ledger = new RuntimeFaultLedger();
  const target = new EventTarget();
  const reporter = new RuntimeFaultReporter({ ledger, eventTarget: target, source: 'test', getActiveJobId: () => 'job-1' });
  let event = null;
  target.addEventListener('warning', (e) => { event = e.detail; });

  const detail = reporter.warning('ENCODER_QUEUE_STALL', { message: 'encoder stopped dequeuing', recoverable: true });
  const snapshot = ledger.snapshot();

  assert.equal(detail.subsystem, 'webcodecs');
  assert.equal(detail.jobId, 'job-1');
  assert.equal(snapshot.totalEvents, 1);
  assert.equal(snapshot.groups[0].code, 'ENCODER_QUEUE_STALL');
  assert.equal(event.code, 'ENCODER_QUEUE_STALL');
});

test('RuntimeFaultReporter serializes Error objects without leaking mutable instances', () => {
  const ledger = new RuntimeFaultLedger();
  const reporter = new RuntimeFaultReporter({ ledger });
  const error = new Error('boom');
  error.code = 'ORT_TIMEOUT';
  error.recoverable = true;

  const detail = reporter.error('ORT_INFERENCE_TIMEOUT', { error });
  assert.equal(detail.error.message, 'boom');
  assert.equal(detail.error.code, 'ORT_TIMEOUT');
  assert.equal(detail.subsystem, 'ai');
  assert.equal(detail.severity, 'error');
});

test('RuntimeFaultReporter never throws when telemetry sinks fail', () => {
  const ledger = { record() { throw new Error('ledger offline'); } };
  const target = { dispatchEvent() { throw new Error('event target offline'); } };
  const reporter = new RuntimeFaultReporter({ ledger, eventTarget: target });

  assert.doesNotThrow(() => reporter.warning('GPU_DEVICE_LOST'));
  assert.equal(reporter.snapshot().reportingFailures, 2);
});

test('inferRuntimeSubsystem maps lifecycle failures explicitly', () => {
  assert.equal(inferRuntimeSubsystem('RESOURCE_RELEASE_FAILED'), 'lifecycle');
  assert.equal(inferRuntimeSubsystem('WORKER_MESSAGEERROR'), 'worker');
  assert.equal(inferRuntimeSubsystem('OPFS_WRITE_FAILED'), 'storage');
});
