import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');

test('BARSA Doctor does not contain silent catch handlers', () => {
  assert.doesNotMatch(source, /catch\s*\{\s*\}/);
  assert.doesNotMatch(source, /\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  assert.doesNotMatch(source, /\.catch\(\s*\(\)\s*=>\s*null\s*\)/);
});

test('BARSA Doctor routes diagnostic and repair failures through RuntimeFaultReporter', () => {
  assert.match(source, /this\.manager\?\.faultReporter/);
  assert.match(source, /DOCTOR_CHECK_FAILED/);
  assert.match(source, /DOCTOR_RESUME_DISCOVERY_FAILED/);
  assert.match(source, /DOCTOR_PERFORMANCE_SAMPLE_FAILED/);
  assert.match(source, /DOCTOR_MODEL_STATUS_FAILED/);
  assert.match(source, /DOCTOR_REPAIR_FAILED/);
  assert.match(source, /DOCTOR_REPORT_PERSIST_FAILED/);
  assert.match(source, /DOCTOR_REPAIR_GATE_STATE_FAILED/);
  assert.match(source, /DOCTOR_REPAIR_STATE_PERSIST_FAILED/);
  assert.match(source, /DOCTOR_STORAGE_VERIFY_FAILED/);
  assert.match(source, /DOCTOR_MEMORY_VERIFY_SAMPLE_FAILED/);
  assert.match(source, /DOCTOR_MODEL_VERIFY_STATUS_FAILED/);
});

test('BARSA Doctor reports source and subsystem evidence', () => {
  assert.match(source, /source: 'BarsaDoctor'/);
  assert.match(source, /subsystem: details\.subsystem \|\| 'doctor'/);
  assert.match(source, /recoverable: details\.recoverable \?\? true/);
});
