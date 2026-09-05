import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalExportSettings } from '../src/engine/ApplyStackEngine.js';

test('v9.6 final export keeps light color/sharp but disables baked heavy stages',()=>{
  const input={quality:'ULTRA',export:{},audioEnabled:true,audio:{},resolution:'4k',targetFps:60,upscaleModelId:'sr',rifeModelId:'rife',faceModelId:'face',faceStrength:.8,effects:{brightness:.1,contrast:1.1,saturation:1.1,sharpenAmount:.4,detailAmount:.7,denoiseAmount:.6,temporalDenoise:.5},qualityLab:{stages:{denoise:{enabled:true,strength:.8},detailRecovery:{enabled:true,strength:.9},smartSharpen:{enabled:true,strength:.7}}},colorLab:{enabled:true,lutStrength:.3},faceLab:{faceDetection:true,faceDetail:{enabled:true,strength:.8}},temporalMaster:{enabled:true,strength:.7},temporalReconstruction:{enabled:true,strength:.7},stabilization:{enabled:true,strength:.7},blur:{enabled:false}};
  const out=buildFinalExportSettings(input,['restore','detail','upscale','rife','face']);
  assert.equal(out.upscaleModelId,null); assert.equal(out.rifeModelId,null); assert.equal(out.faceModelId,null);
  assert.equal(out.qualityLab.stages.denoise.enabled,false); assert.equal(out.qualityLab.stages.detailRecovery.enabled,false);
  assert.equal(out.qualityLab.stages.smartSharpen.enabled,true); assert.equal(out.colorLab.enabled,true);
  assert.equal(out.effects.sharpenAmount,.4); assert.equal(out.effects.brightness,.1);
});

test('v9.6 UI exposes apply buttons only for heavy stages',async()=>{
  const fs=await import('node:fs/promises'); const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['restore','detail','face','motion','stabilize','upscale','rife']) assert.match(html,new RegExp(`data-apply-stage="${id}"`));
  assert.doesNotMatch(html,/data-apply-stage="sharp"/); assert.doesNotMatch(html,/data-apply-stage="color"/);
});


test('v9.6.1 preserves final resolution/fps when those transforms were not baked',()=>{
  const input={quality:'HIGH',export:{},audioEnabled:true,audio:{},resolution:'4k',customWidth:0,customHeight:0,targetFps:60,effects:{},qualityLab:{stages:{}},colorLab:{enabled:true},faceLab:{},temporalMaster:{enabled:false},temporalReconstruction:{enabled:false},stabilization:{enabled:false},blur:{enabled:false}};
  const faceOnly=buildFinalExportSettings(input,['face']);
  assert.equal(faceOnly.resolution,'4k');
  assert.equal(faceOnly.targetFps,60);
  const baked=buildFinalExportSettings(input,['upscale','rife']);
  assert.equal(baked.resolution,'original');
  assert.equal(baked.targetFps,null);
});

test('v9.6.1 source contains stale-stage guard and safe rewind',async()=>{
  const fs=await import('node:fs/promises');
  const main=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
  const stack=await fs.readFile(new URL('../src/engine/ApplyStackEngine.js',import.meta.url),'utf8');
  assert.match(main,/تغيّرت إعدادات/);
  assert.match(main,/rewindFrom\(stageId\)/);
  assert.match(stack,/async rewindFrom\(stageId\)/);
  assert.match(stack,/this\.originalMetadata/);
});
