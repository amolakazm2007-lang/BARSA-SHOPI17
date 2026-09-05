import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v10 apply-stack preview has race protection and full media cleanup',async()=>{
  const source=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(source,/workingPreviewToken=0/);
  assert.match(source,/const token=\+\+workingPreviewToken/);
  assert.match(source,/if\(token!==workingPreviewToken\|\|sourceURL!==nextURL\)return/);
  assert.match(source,/video\.onplay=null;video\.onpause=null;video\.onseeked=null/);
  assert.match(source,/workingPreviewToken\+\+;preflightToken\+\+/);
});

test('v10 pressure notifications are throttled to avoid toast storms',async()=>{
  const source=await fs.readFile(new URL('../src/engine/PerformanceManager.js',import.meta.url),'utf8');
  assert.match(source,/now - this\._lastPressureEmitAt >= 5000/);
});
