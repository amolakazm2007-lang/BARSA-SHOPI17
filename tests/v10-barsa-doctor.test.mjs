import test from 'node:test';
import assert from 'node:assert/strict';
import { BarsaDoctor } from '../src/engine/BarsaDoctor.js';

function managerFixture({ usage = 50, quota = 100, modelStatus = null } = {}) {
  const calls = [];
  const model = modelStatus || { installed:false, verified:false, testPassed:false, state:'missing' };
  const engine = { isAvailable: async()=>({available:false}), runSelfTest: async()=>({ok:true}), destroy(){ calls.push('destroy'); } };
  return {
    calls,
    activeJobId:null,
    capabilities:{ webCodecs:true, webGPU:true, opfs:true, indexedDB:true, hardwareConcurrency:8, deviceMemoryGB:8, deviceProfile:{label:'test'} },
    engines:{
      storage:{
        getStorageUsage:async()=>({usageBytes:usage,quotaBytes:quota}),
        findResumableSession:async()=>null,
        pruneTerminalSessions:async()=>calls.push('prune'),
        reconcileStageCacheIndex:async()=>calls.push('reconcile'),
        enforceStageCacheBudget:async()=>calls.push('budget'),
      },
      performance:{ telemetry:{}, _pressureState:'normal', sample:async()=>{}, getAdaptiveSettings:()=>({tileSize:256,batchSize:1}) },
      models:{ getDetailedStatus:async()=>model, verifyStoredModel:async()=>calls.push('verify') },
      upscale:engine, rife:engine, face:engine, faceDetector:engine,
      hardware:{ runAcceptanceSuite:async()=>({ready:true}) },
    },
    runCancelRestartSelfTest:async()=>({ok:true}),
    deviceTest:{ run:async()=>({verdict:'PASS'}) },
  };
}

test('BARSA Doctor reports healthy quick check without destructive repair', async()=>{
  const manager=managerFixture();
  const doctor=new BarsaDoctor(manager);
  const report=await doctor.run('quick');
  assert.equal(report.verdict,'HEALTHY');
  assert.equal(report.safeRepairCount,0);
  assert.equal(manager.calls.length,0);
});

test('BARSA Doctor flags high storage and only runs allow-listed cleanup', async()=>{
  const manager=managerFixture({usage:95,quota:100});
  const doctor=new BarsaDoctor(manager);
  const report=await doctor.run('quick');
  assert.equal(report.verdict,'ATTENTION');
  assert.ok(report.issues.some(x=>x.id==='storage-critical'&&x.repair==='storage-safe-clean'));
  const repaired=await doctor.repairSafe(report);
  assert.equal(repaired.failed,0);
  assert.deepEqual(manager.calls,['prune','reconcile','budget']);
});

test('BARSA Doctor does not auto-delete broken or unverified models', async()=>{
  const manager=managerFixture({modelStatus:{installed:true,verified:false,testPassed:false,state:'error',lastError:'sha mismatch'}});
  const doctor=new BarsaDoctor(manager);
  const report=await doctor.run('quick');
  assert.ok(report.issues.some(x=>x.id.startsWith('model-unverified:')));
  assert.equal(manager.calls.includes('delete'),false);
});

test('BARSA Doctor full mode catches live inference failure and keeps report actionable', async()=>{
  const manager=managerFixture({modelStatus:{installed:true,verified:true,testPassed:true,state:'ready'}});
  manager.engines.upscale.runSelfTest=async()=>{throw new Error('gpu provider failed')};
  const doctor=new BarsaDoctor(manager);
  const report=await doctor.run('full');
  assert.equal(report.verdict,'ATTENTION');
  assert.ok(report.issues.some(x=>x.id.startsWith('model-runtime:')));
});

test('BARSA Doctor refuses to run during active render', async()=>{
  const manager=managerFixture();manager.activeJobId='job-1';
  await assert.rejects(()=>new BarsaDoctor(manager).run('quick'),/active render/i);
});
