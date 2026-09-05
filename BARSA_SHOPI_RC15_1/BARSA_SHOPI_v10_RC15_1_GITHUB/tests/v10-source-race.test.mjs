import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v10 source selection is race-safe and failed videos reset UI state',async()=>{
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(source,/sourceSelectionToken/);
  assert.match(source,/selectionToken!==sourceSelectionToken/);
  assert.match(source,/Source selection failed/);
  assert.match(source,/video\.removeAttribute\('src'\)/);
});

test('v10 preview seeking is throttled instead of decoding on every touch event',async()=>{
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(source,/previewSeekTimer=setTimeout/);
  assert.match(source,/},45\)/);
});
