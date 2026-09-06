import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const managerSource = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
const doctorSource = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');
const reporterSource = await readFile(new URL('../src/engine/RuntimeFaultReporter.js', import.meta.url), 'utf8');

test('EngineManager records structured warning/error events through one bounded fault reporter', () => {
  assert.match(managerSource, /new RuntimeFaultLedger\(\{ maxEntries: 240, maxGroups: 96 \}\)/);
  assert.match(managerSource, /new RuntimeFaultReporter\(\{/);
  assert.match(managerSource, /ledger:\s*this\.faultLedger/);
  assert.match(managerSource, /getActiveJobId:\s*\(\)\s*=>\s*this\.activeJobId/);
  assert.match(managerSource, /this\.faultReporter\.report\(type, code, detail \|\| \{\}\)/);
  assert.doesNotMatch(managerSource, /this\.faultLedger\.record\(\{/);

  assert.match(reporterSource, /this\.ledger\?\.record\?\.\(/);
  assert.match(reporterSource, /subsystem:/);
  assert.match(reporterSource, /jobId:/);
  assert.match(reporterSource, /source:/);
});

test('BARSA Doctor reports grouped runtime-fault evidence as a first-class health check', () => {
  assert.match(doctorSource, /capture\('runtime-fault-ledger'/);
  assert.match(doctorSource, /runtimeFaults: this\.manager\.faultLedger\?\.snapshot/);
  assert.match(doctorSource, /runtime-fault-history/);
});
