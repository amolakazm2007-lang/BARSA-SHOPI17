import test from 'node:test';
import assert from 'node:assert/strict';
import { DevicePerformancePassport } from '../src/engine/DevicePerformancePassport.js';
import { MemoryGovernor } from '../src/engine/MemoryGovernor.js';
import { StorageGovernor } from '../src/engine/StorageGovernor.js';
import { DynamicRenderFabric } from '../src/engine/DynamicRenderFabric.js';
import { createQualityLockFingerprint } from '../src/engine/RenderFingerprint.js';
import { BarsaDoctor } from '../src/engine/BarsaDoctor.js';

class MemoryStore {
  constructor(){ this.map=new Map(); }
  getItem(k){ return this.map.get(k) ?? null; }
  setItem(k,v){ this.map.set(k,String(v)); }
}

const safetyPlan={ tier:'NORMAL', loadScore:4, codecQueue:3, writeBacklog:3, tileConcurrency:2, blurSamples:24, checkpointEvery:30, yieldEvery:10 };

test('RC15 device passport learns locally and gives confidence only after evidence',()=>{
  const passport=new DevicePerformancePassport({storage:new MemoryStore()});
  passport.identify({hardwareConcurrency:8,deviceMemoryGB:8,webGPUAdapterInfo:{vendor:'v',architecture:'a'}});
  assert.equal(passport.bestProvider('rife',['webgpu','native']),null);
  passport.recordProvider('rife','webgpu',{latencyMs:12,success:true});
  passport.recordProvider('rife','native',{latencyMs:20,success:true});
  assert.equal(passport.bestProvider('rife',['webgpu','native']).provider,'webgpu');
  assert.ok(passport.snapshot().deviceKey.includes('8|8'));
});

test('RC15 memory governor uses hysteresis instead of oscillating queue depth',()=>{
  const g=new MemoryGovernor();
  let d=g.evaluate({capabilities:{deviceMemoryGB:8},telemetry:{jsHeapUsedMB:800,jsHeapLimitMB:1000}});
  assert.equal(d.state,'high'); assert.equal(d.concurrencyCap,1);
  d=g.evaluate({capabilities:{deviceMemoryGB:8},telemetry:{jsHeapUsedMB:700,jsHeapLimitMB:1000}});
  assert.equal(d.state,'high','70% should not immediately exit high state');
  d=g.evaluate({capabilities:{deviceMemoryGB:8},telemetry:{jsHeapUsedMB:500,jsHeapLimitMB:1000}});
  assert.equal(d.state,'normal');
});

test('RC15 storage governor collapses queue on sustained slow durable writes without changing quality',()=>{
  const passport=new DevicePerformancePassport({storage:new MemoryStore()}); passport.identify({});
  const g=new StorageGovernor({passport});
  g.observeWrite(50,1024*1024); g.observeWrite(60,1024*1024);
  assert.equal(g.queueCap(3),1);
  assert.ok(passport.storageProfile().writeMs>0);
});

test('RC15 Dynamic Render Fabric v2 consumes governors only for resource knobs',()=>{
  const passport=new DevicePerformancePassport({storage:new MemoryStore()}); passport.identify({hardwareConcurrency:8,deviceMemoryGB:8});
  const memoryGovernor=new MemoryGovernor();
  const storageGovernor=new StorageGovernor({passport}); storageGovernor.observeWrite(55); storageGovernor.observeWrite(55);
  const performance={telemetry:{jsHeapUsedMB:850,jsHeapLimitMB:1000,gpuAllocatedMB:0,gpuBudgetMB:512},getAdaptiveSettings:()=>({tileSize:256})};
  const fabric=new DynamicRenderFabric({performance,capabilities:{deviceMemoryGB:8,hardwareConcurrency:8,webGPU:true},passport,memoryGovernor,storageGovernor});
  const plan=fabric.plan({safetyPlan,width:1920,height:1080,fps:60,aiUpscale:true,rife:true});
  assert.equal(plan.qualityLocked,true);
  assert.equal(plan.codecQueue,1);
  assert.equal(plan.writeBacklog,1);
  assert.equal(plan.tileConcurrency,1);
  assert.ok(plan.memoryBudgetMB>=256);
  assert.equal(plan.learnedProfile,true);
  for(const forbidden of ['width','height','fps','bitrate','quality','modelPrecision']) assert.equal(forbidden in plan,false);
});

test('RC15 quality fingerprint ignores performance-only knobs but changes with final semantics', async()=>{
  const base={settings:{upscaleModelId:'x4',effects:{sharpness:2}},width:1920,height:1080,fps:60,bitrate:20_000_000,models:{upscale:'x4'}};
  const a=await createQualityLockFingerprint(base);
  const b=await createQualityLockFingerprint({...base,settings:{...base.settings,previewFps:3,queueDepth:1}});
  const c=await createQualityLockFingerprint({...base,width:3840,height:2160});
  assert.equal(a.hash,b.hash);
  assert.notEqual(a.hash,c.hash);
});

test('RC15 Doctor publishes numeric health and post-verification semantics', async()=>{
  const manager={activeJobId:null,capabilities:{webCodecs:true,webGPU:true,opfs:true,indexedDB:true},performancePassport:{snapshot:()=>({deviceKey:'d'})},engines:{
    storage:{getStorageUsage:async()=>({usageBytes:1,quotaBytes:100}),findResumableSession:async()=>null},
    performance:{telemetry:{},sample:async()=>{},getAdaptiveSettings:()=>({})},models:{getDetailedStatus:async()=>({installed:false})},
    upscale:{},rife:{},face:{},faceDetector:{},hardware:{runAcceptanceSuite:async()=>({ready:true})},
  },runCancelRestartSelfTest:async()=>({ok:true}),deviceTest:{run:async()=>({})}};
  const report=await new BarsaDoctor(manager).run('quick');
  assert.equal(report.version,2); assert.equal(report.healthScore,100); assert.equal(report.devicePassport.deviceKey,'d');
});
