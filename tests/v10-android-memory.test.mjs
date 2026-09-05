import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v10 Android forwards OS memory pressure to the web runtime',async()=>{
  const java=await readFile(new URL('../android/app/src/main/java/com/barsa/shopi/MainActivity.java',import.meta.url),'utf8');
  const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(java,/onTrimMemory\(int level\)/);
  assert.match(java,/barsa-memory-pressure/);
  assert.match(main,/addEventListener\('barsa-memory-pressure'/);
  assert.match(main,/previewEngine\?\.pause\(\)/);
});
