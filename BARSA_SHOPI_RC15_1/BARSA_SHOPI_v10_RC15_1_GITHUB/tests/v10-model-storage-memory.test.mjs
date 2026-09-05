import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/engine/ModelManager.js', import.meta.url),'utf8');
test('model imports have a bounded 512 MB mobile safety limit',()=>{
  assert.match(src,/MAX_MODEL_BYTES = 512 \* 1024 \* 1024/);
  assert.match(src,/file\.size > MAX_MODEL_BYTES/);
  assert.match(src,/written > MAX_MODEL_BYTES/);
  assert.match(src,/total > MAX_MODEL_BYTES/);
});
test('model downloads recheck storage after Content-Length is known',()=>{
  const occurrences=(src.match(/await this\._ensureDownloadCapacity\(total\)/g)||[]).length;
  assert.ok(occurrences>=2,`expected URL and manual URL capacity checks, got ${occurrences}`);
});
