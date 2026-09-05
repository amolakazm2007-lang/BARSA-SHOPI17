import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');

test('v10 manual control exposes real multi-select batch stages',()=>{
  for(const id of ['restore','detail','face','upscale','motion','rife','stabilize','blur']) assert.match(html,new RegExp(`data-batch-stage="${id}"`));
  assert.match(html,/id="applySelectedStagesBtn"/);
  assert.match(main,/const BATCH_STAGE_ORDER=/);
  assert.match(main,/await applyStageFromUI\(id,button\)/);
});

test('v10 project settings can be exported and imported',()=>{
  assert.match(html,/id="exportProjectBtn"/);
  assert.match(html,/id="importProjectBtn"/);
  assert.match(main,/function exportProjectSettings\(\)/);
  assert.match(main,/async function importProjectSettings\(file\)/);
  assert.match(main,/BARSA-SHOPI-PROJECT/);
});

test('v10 throttles interactive preview/preflight refreshes',()=>{
  assert.match(main,/function scheduleInteractiveRefresh/);
  assert.match(main,/onChange:\(\)=>\{scheduleInteractiveRefresh\(\);schedulePreferenceSave\(\)\}/);
});

test('v10 includes mobile overflow and preview-height hardening',()=>{
  assert.match(css,/html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.match(css,/max-height:56vh/);
});

test('v10 batch apply validates prerequisites before starting and select-all chooses ready stages only',()=>{
  assert.match(main,/function getBatchStageReadiness\(stageId\)/);
  assert.match(main,/x\.checked=getBatchStageReadiness\(x\.dataset\.batchStage\)\.ready/);
  assert.match(main,/blocked\.length/);
});

test('v10 project import resynchronizes model availability and output UI',()=>{
  assert.match(main,/await refreshModelStates\(\)/);
  assert.match(main,/renderOutputReadiness\(\)/);
  assert.match(main,/renderCustomSize\(\)/);
});
