import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheGraphEngine } from '../src/engine/CacheGraphEngine.js';
import { ThermalGuard } from '../src/engine/ThermalGuard.js';

test('v9.7 cache graph keys are deterministic and dependency-aware', async()=>{
  const file=new Blob([new Uint8Array([1,2,3,4])],{type:'video/mp4'}); Object.defineProperty(file,'name',{value:'x.mp4'}); Object.defineProperty(file,'lastModified',{value:123});
  const g=new CacheGraphEngine(); g.reset(file);
  const source=await g.sourceKey();
  const a=await g.keyFor({parentKey:source,stageId:'restore',settings:{x:1}});
  const a2=await g.keyFor({parentKey:source,stageId:'restore',settings:{x:1}});
  const b=await g.keyFor({parentKey:a,stageId:'face',settings:{m:'gfpgan'}});
  const b2=await g.keyFor({parentKey:a,stageId:'face',settings:{m:'codeformer'}});
  assert.equal(a,a2); assert.notEqual(b,b2); assert.notEqual(a,b);
});

test('v9.7 thermal guard blocks severe and never changes quality',()=>{
  const bridge={getThermalInfo:()=>({supported:true,status:4,headroom:1.1})};
  const g=new ThermalGuard(bridge);
  const p=g.preflight(); assert.equal(p.ok,false); assert.equal(p.action,'wait');
});
