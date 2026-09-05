import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v10 long-session media probes stop callbacks after timeout and remove paired listeners',async()=>{
  const perf=await fs.readFile(new URL('../src/engine/PerformanceManager.js',import.meta.url),'utf8');
  const pipeline=await fs.readFile(new URL('../src/engine/VideoPipeline.js',import.meta.url),'utf8');
  for(const source of [perf,pipeline]){
    assert.match(source,/let settled = false/);
    assert.match(source,/if \(settled\) return/);
    assert.match(source,/removeEventListener\(success, onSuccess\)/);
    assert.match(source,/removeEventListener\(failure, onFailure\)/);
  }
});
