import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeFaultLedger } from '../src/engine/RuntimeFaultLedger.js';

test('runtime fault ledger groups repeated subsystem faults and keeps a bounded event history', () => {
  const ledger = new RuntimeFaultLedger({ maxEntries: 20, maxGroups: 10 });
  for (let i = 0; i < 30; i++) {
    ledger.record({ code: 'ENCODER_STALLED', subsystem: 'webcodecs', severity: 'error', jobId: `job-${i}`, recoverable: true, message: 'encoder did not dequeue' });
  }
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.totalEvents, 30);
  assert.equal(snapshot.retainedEvents, 20);
  assert.equal(snapshot.activeGroups, 1);
  assert.equal(snapshot.errorGroups, 1);
  assert.equal(snapshot.groups[0].count, 30);
  assert.equal(snapshot.groups[0].code, 'ENCODER_STALLED');
  assert.equal(snapshot.groups[0].subsystem, 'webcodecs');
});

test('runtime fault ledger can mark a grouped fault resolved without deleting evidence', () => {
  const ledger = new RuntimeFaultLedger();
  ledger.record({ code: 'GPU_DEVICE_LOST', subsystem: 'gpu', severity: 'error' });
  assert.equal(ledger.resolve({ code: 'GPU_DEVICE_LOST', subsystem: 'gpu' }), true);
  assert.equal(ledger.snapshot().activeGroups, 0);
  assert.equal(ledger.snapshot({ includeResolved: true }).groups.length, 1);
  assert.equal(ledger.snapshot({ includeResolved: true }).retainedEvents, 1);
});

test('runtime fault ledger keeps structured details isolated from later caller mutation', () => {
  const ledger = new RuntimeFaultLedger();
  const details = { queue: { size: 4 } };
  ledger.record({ code: 'QUEUE_PRESSURE', subsystem: 'render', details });
  details.queue.size = 999;
  assert.equal(ledger.snapshot().recent[0].details.queue.size, 4);
});
