import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const managerSource = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');

test('EngineManager wires RuntimeHealthGuard into every job context', () => {
  assert.match(managerSource, /new RuntimeHealthGuard\(/);
  assert.match(managerSource, /runtimeDecision = this\.runtimeGuard\.evaluate/);
  assert.match(managerSource, /allowNewHeavyAiWork/);
  assert.match(managerSource, /RecoverableResourcePressureError/);
  assert.match(managerSource, /qualityLocked/);
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
