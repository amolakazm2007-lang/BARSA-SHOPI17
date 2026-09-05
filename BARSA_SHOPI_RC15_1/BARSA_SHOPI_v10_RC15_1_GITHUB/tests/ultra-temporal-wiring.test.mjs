import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pipeline=fs.readFileSync(new URL('../src/engine/VideoPipeline.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('Temporal Master maps to all three real temporal passes',()=>{
  assert.match(pipeline,/temporalDenoise[\s\S]*0\.72/);
  assert.match(pipeline,/antiFlicker[\s\S]*0\.58/);
  assert.match(pipeline,/temporalDetailStability[\s\S]*0\.90/);
});
test('model selection stays manual while All Engine Boost is wired',()=>{
  assert.doesNotMatch(main,/await applyAutomaticModelSelection\(settings\)/);
  assert.match(main,/function applyAllEngineBoost/);
  assert.match(main,/qualityTargets/);
  assert.match(main,/All Engine Boost/);
});
