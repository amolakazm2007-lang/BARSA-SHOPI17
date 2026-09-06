import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');

test('EngineManager owns one centralized RuntimeFaultReporter', () => {
  assert.match(source, /import \{ RuntimeFaultReporter \} from '\.\/RuntimeFaultReporter\.js';/);
  assert.match(source, /this\.faultReporter = new RuntimeFaultReporter\(/);
  assert.match(source, /ledger: this\.faultLedger/);
  assert.match(source, /eventTarget: this/);
});

test('ResourceScope is wired directly into the centralized reporter', () => {
  assert.match(source, /new ResourceScope\(`job:\$\{jobId\}`,[\s\S]*onFault:/);
  assert.match(source, /this\.faultReporter\.warning\(fault\.code/);
  assert.match(source, /releaseResourceAsync:/);
});

test('warning and error events no longer duplicate ledger logic in EngineManager', () => {
  const emitBody = source.match(/_emit\(type, detail\) \{([\s\S]*?)\n  \}\n\}/)?.[1] || '';
  assert.match(emitBody, /this\.faultReporter\.report\(type, code, detail \|\| \{\}\)/);
  assert.doesNotMatch(emitBody, /faultLedger\.record/);
});
