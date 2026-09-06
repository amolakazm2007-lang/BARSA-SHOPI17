import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const managerSource = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
const guardSource = await readFile(new URL('../src/engine/RuntimeHealthGuard.js', import.meta.url), 'utf8');
const doctorSource = await readFile(new URL('../src/engine/DoctorControlPlane.js', import.meta.url), 'utf8');

test('EngineManager routes RuntimeHealthGuard through BARSA Doctor control plane for every job', () => {
  assert.match(managerSource, /new RuntimeHealthGuard\(/);
  assert.match(managerSource, /new DoctorControlPlane\(\{/);
  assert.match(managerSource, /runtimeGuard:\s*this\.runtimeGuard/);
  assert.match(managerSource, /doctorDecision = this\.doctorControlPlane\.assessRuntime/);
  assert.match(managerSource, /runtimeDecision = doctorDecision\.runtimeDecision/);
  assert.match(managerSource, /doctorDecision,/);
  assert.match(managerSource, /doctorControlPlane:\s*this\.doctorControlPlane/);
  assert.match(managerSource, /runtimeGuard:\s*this\.runtimeGuard/);
  assert.match(managerSource, /runtimeDecision,/);
  assert.match(managerSource, /allowNewHeavyAiWork/);
  assert.match(managerSource, /RecoverableResourcePressureError/);
  assert.match(guardSource, /qualityLocked:\s*true/);
  assert.match(doctorSource, /qualityLocked:\s*true/);
  assert.match(doctorSource, /finalQualityMutationAllowed:\s*false/);
});

test('EngineManager exposes bounded queues capped by runtime decision', () => {
  assert.match(managerSource, /new BoundedAsyncQueue/);
  assert.match(managerSource, /createBoundedQueue/);
  assert.match(managerSource, /runtimeDecision\.queueCap/);
});

test('EngineManager startup maintenance no longer silently swallows storage errors', () => {
  assert.match(managerSource, /_bestEffort\('prune-terminal-sessions'/);
  assert.match(managerSource, /BEST_EFFORT_OPERATION_FAILED/);
  assert.doesNotMatch(managerSource, /pruneTerminalSessions\([^\n]*\)\.catch\(\(\) => \{\}\)/);
});
