import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const models=fs.readFileSync(new URL('../src/ui/ModelQuickUI.js',import.meta.url),'utf8');

test('v9.4 exposes prepared render flow',()=>{
  for(const id of ['prepareEffectsBtn','preparedRenderState','preparedRenderBadge','clearPreparedBtn']) assert.ok(html.includes(id));
  assert.ok(main.includes('async function prepareEffects()'));
  assert.ok(main.includes('preparedSettingsSignature'));
  assert.ok(main.includes('preparedCacheHit'));
});

test('v9.4 final render reuses matching prepared result',()=>{
  assert.match(main,/preparedResult&&preparedSignature===signature/);
  assert.match(main,/showResult\(preparedResult\)/);
  assert.match(main,/deferShow:true/);
});

test('v9.4 model counter estimates remaining download time',()=>{
  assert.ok(models.includes('_eta(role, received, total)'));
  assert.match(models,/باقي ~/);
});
