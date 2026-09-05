import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('v10 reset invalidates stale async work and clears UI timers', () => {
  const fn = main.match(/function resetInterface\(\)\{[^\n]+\}/)?.[0] || '';
  assert.match(fn, /sourceSelectionToken\+\+/);
  assert.match(fn, /preflightToken\+\+/);
  for (const timer of ['interactiveRefreshTimer','preparedStateTimer','previewSeekTimer']) {
    assert.match(fn, new RegExp(`clearTimeout\\(${timer}\\)`));
    assert.match(fn, new RegExp(`${timer}=null`));
  }
});

test('v10 reset releases media handlers and reloads video elements', () => {
  const fn = main.match(/function resetInterface\(\)\{[^\n]+\}/)?.[0] || '';
  assert.match(fn, /sourceVideo\.onplay=null/);
  assert.match(fn, /sourceVideo\.onpause=null/);
  assert.match(fn, /sourceVideo\.onseeked=null/);
  assert.match(fn, /sourceVideo\.load\?\.\(\)/);
  assert.match(fn, /resultVideo\.load\?\.\(\)/);
});
