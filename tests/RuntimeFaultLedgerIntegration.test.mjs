import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const managerSource = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
const doctorSource = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');

test('EngineManager records structured warning/error events in a bounded fault ledger', () => {
  assert.match(managerSource, /new RuntimeFaultLedger\(\{ maxEntries: 240, maxGroups: 96 \}\)/);
  assert.match(managerSource, /this\.faultLedger\.record\(\{/);
  assert.match(managerSource, /subsystem: detail\?\.subsystem \|\| inferFaultSubsystem\(code\)/);
  assert.match(managerSource, /jobId: detail\?\.jobId \|\| this\.activeJobId \|\| null/);
  assert.match(managerSource, /source: 'EngineManager'/);
});

test('BARSA Doctor reports grouped runtime-fault evidence as a first-class health check', () => {
  assert.match(doctorSource, /capture\('runtime-fault-ledger'/);
  assert.match(doctorSource, /runtimeFaults: this\.manager\.faultLedger\?\.snapshot/);
  assert.match(doctorSource, /runtime-fault-history/);
});
