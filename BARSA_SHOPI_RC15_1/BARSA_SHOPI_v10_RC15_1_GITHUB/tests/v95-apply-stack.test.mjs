import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildStageSettings, buildFinalExportSettings } from '../src/engine/ApplyStackEngine.js';

const sample = {
  resolution:'1080', aspectRatio:'original', fitMode:'contain', customWidth:0, customHeight:0,
  targetFps:60, quality:'HIGH', outputFormat:'mp4', audioEnabled:true,
  export:{videoMode:'auto',audioBitrateK:192,acceleration:'hardware'},
  audio:{enabled:true}, protectSceneCuts:true,
  upscaleModelId:'sr-x4', rifeModelId:'rife-4.9', faceModelId:'gfpgan', faceStrength:.8,
  temporalMaster:{enabled:true,strength:.7}, temporalReconstruction:{enabled:true,strength:.5}, stabilization:{enabled:true,strength:.6},
  blur:{enabled:true,interpolation:true}, colorLab:{enabled:true,contrast:1.1,lutStrength:0},
  faceLab:{faceDetection:true,faceDetail:{enabled:true,strength:.8},skinCleanup:{enabled:true,strength:.4}},
  qualityLab:{mode:'natural',sceneAware:true,stages:{denoise:{enabled:true,strength:.8},detailRecovery:{enabled:true,strength:.9},smartSharpen:{enabled:true,strength:.7},antiFlicker:{enabled:true,strength:.4}}},
  effects:{denoiseAmount:.2,temporalDenoise:.15,detailAmount:.3,sharpenAmount:.25,highPassAmount:.1,brightness:0,contrast:1.05,saturation:1.02,vibrance:.1,temperature:0,exposure:0,highlights:0,shadows:0,whites:0,blacks:0,dehaze:0,vignette:0,grain:0}
};

test('v9.5 applies one heavy stage without re-running unrelated AI',()=>{
  const s=buildStageSettings('restore',sample);
  assert.equal(s.upscaleModelId,null); assert.equal(s.rifeModelId,null); assert.equal(s.faceModelId,null);
  assert.equal(s.qualityLab.stages.denoise.enabled,true);
  assert.equal(s.qualityLab.stages.detailRecovery.enabled,false);
  assert.equal(s.blur.enabled,false); assert.equal(s.colorLab.enabled,false); assert.equal(s.stabilization.enabled,false);
});

test('v9.5 explicit model passes stay manual and isolated',()=>{
  const up=buildStageSettings('upscale',sample); assert.equal(up.upscaleModelId,'sr-x4'); assert.equal(up.rifeModelId,null); assert.equal(up.faceModelId,null); assert.equal(up.resolution,'1080');
  const rife=buildStageSettings('rife',sample); assert.equal(rife.rifeModelId,'rife-4.9'); assert.equal(rife.upscaleModelId,null); assert.equal(rife.targetFps,60);
  const face=buildStageSettings('face',sample); assert.equal(face.faceModelId,'gfpgan'); assert.equal(face.rifeModelId,null); assert.equal(face.faceLab.faceDetection,true);
});

test('v9.5+ final export avoids replaying baked heavy AI while preserving light controls',()=>{
  const s=buildFinalExportSettings(sample,['upscale','rife','face','stabilize','blur']);
  assert.equal(s.upscaleModelId,null); assert.equal(s.rifeModelId,null); assert.equal(s.faceModelId,null);
  assert.equal(s.blur.enabled,false); assert.equal(s.stabilization.enabled,false); assert.equal(s.colorLab.enabled,true);
  assert.equal(s.resolution,'original'); assert.equal(s.targetFps,null); assert.equal(s.renderIntent,'final-export-from-apply-stack');
});

test('v9.5/v9.6 UI exposes heavy-stage apply plus stack undo',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['restore','detail','face','motion','stabilize','upscale','rife']) assert.match(html,new RegExp(`data-apply-stage="${id}"`));
  assert.doesNotMatch(html,/data-apply-stage="sharp"/); assert.doesNotMatch(html,/data-apply-stage="color"/);
  assert.match(html,/id="applyStackCard"/); assert.match(html,/id="undoApplyStageBtn"/); assert.match(html,/id="clearApplyStackBtn"/);
  const labs=fs.readFileSync(new URL('../src/ui/EngineLabsUI.js',import.meta.url),'utf8'); assert.match(labs,/data-apply-stage="blur"/);
});
