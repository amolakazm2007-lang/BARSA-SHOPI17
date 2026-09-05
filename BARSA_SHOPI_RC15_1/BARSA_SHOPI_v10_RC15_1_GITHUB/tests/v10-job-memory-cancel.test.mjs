import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');

test('cancelled job cannot be promoted to completed after a late processor result', () => {
  assert.match(src, /const result = await processor\(context\);[\s\S]*job\.controller\.signal\.aborted[\s\S]*throw job\.controller\.signal\.reason/);
  assert.match(src, /job\.state = job\.controller\.signal\.aborted \? 'cancelled' : 'failed'/);
});

test('completed jobs do not retain large processor results', () => {
  assert.match(src, /job\.result = null;[\s\S]*job\.state = 'completed'/);
  assert.match(src, /return result;/);
  assert.doesNotMatch(src, /job\.result = await processor\(context\)/);
});

test('terminal job history is bounded', () => {
  assert.match(src, /_pruneJobHistory\(maxTerminalJobs = 24\)/);
  assert.match(src, /terminal\.slice\(maxTerminalJobs\)/);
  assert.match(src, /this\._pruneJobHistory\(\);/);
});
