import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePreviewInterval } from '../src/engine/RealtimePreviewEngine.js';

test('v10 preview throttles large mobile canvases without affecting final render settings',()=>{
  assert.equal(Math.round(1000/choosePreviewInterval(1_600_000)),18);
  assert.equal(Math.round(1000/choosePreviewInterval(1_000_000)),24);
  assert.equal(Math.round(1000/choosePreviewInterval(400_000)),30);
});

test('v10 interaction code debounces preview, preflight and prepared-state recalculation',async()=>{
  const fs=await import('node:fs/promises');
  const source=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(source,/scheduleInteractiveRefresh\(\{delay:120\}\)/);
  assert.match(source,/schedulePreparedStateRefresh\(160\)/);
  assert.doesNotMatch(source,/toFixed\(2\);updatePreview\(\);updatePreflightEstimate\(\)/);
});

test('v10 memory governor throttles progressively and recovers after pressure clears',async()=>{
  const { computePressureAdaptation }=await import('../src/engine/PerformanceManager.js');
  const high=computePressureAdaptation({tileSize:384,batchSize:2,baselineTileSize:384,baselineBatchSize:2,gpuRatio:.84,heapRatio:.2,pressureState:'normal'});
  assert.equal(high.pressureState,'high');
  assert.ok(high.tileSize<384 && high.tileSize>=96);
  assert.equal(high.batchSize,1);
  assert.equal(high.emitPressure,true);
  let state=high;
  for(let i=0;i<20;i++) state=computePressureAdaptation({tileSize:state.tileSize,batchSize:state.batchSize,baselineTileSize:384,baselineBatchSize:2,gpuRatio:.3,heapRatio:.4,pressureState:state.pressureState});
  assert.equal(state.tileSize,384);
  assert.equal(state.batchSize,2);
  assert.equal(state.pressureState,'normal');
});


test('v10 performance manager propagates both throttle and recovery settings to tile engine',async()=>{
  const fs=await import('node:fs/promises');
  const source=await fs.readFile(new URL('../src/engine/PerformanceManager.js',import.meta.url),'utf8');
  assert.match(source,/adapted\.tileSize !== previousTileSize \|\| adapted\.batchSize !== previousBatchSize/);
  assert.match(source,/engineManager\?\.engines\?\.tiles\?\.configure\(this\.getAdaptiveSettings\(\)\)/);
});
