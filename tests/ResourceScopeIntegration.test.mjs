import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ResourceScope } from '../src/engine/ResourceScope.js';

const managerSource = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');

test('ResourceScope releases tracked resources in reverse order', async () => {
  const released = [];
  const scope = new ResourceScope('unit');
  scope.track({ close() { released.push('first'); } });
  scope.track({ destroy() { released.push('second'); } });
  await scope.close();
  assert.deepEqual(released, ['second', 'first']);
  assert.equal(scope.size, 0);
});

test('EngineManager gives every render job deterministic resource ownership', () => {
  assert.match(managerSource, /new ResourceScope\(`job:\$\{jobId\}`,\s*\{/);
  assert.match(managerSource, /onFault:\s*\(fault\)\s*=>\s*this\.faultReporter\.warning\(/);
  assert.match(managerSource, /trackResource:\s*\(resource\)\s*=>\s*resourceScope\.track\(resource\)/);
  assert.match(managerSource, /releaseResource:\s*\(resource\)\s*=>\s*resourceScope\.release\(resource\)/);
  assert.match(managerSource, /releaseResourceAsync:\s*\(resource\)\s*=>\s*resourceScope\.releaseAsync\(resource\)/);
  assert.match(managerSource, /await resourceScope\.close\(\)/);
  assert.match(managerSource, /RESOURCE_SCOPE_CLOSE_FAILED/);
});

test('successful jobs close resources before becoming completed', () => {
  const closeIndex = managerSource.indexOf('await resourceScope.close();');
  const completedIndex = managerSource.indexOf("job.state = 'completed';");
  assert.ok(closeIndex >= 0 && completedIndex > closeIndex);
});
