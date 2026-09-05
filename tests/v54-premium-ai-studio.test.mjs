import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/EngineLabsUI.js', import.meta.url), 'utf8');

test('premium profile deck includes targeted enhancement profiles', () => {
  for (const id of ['tiktok-rescue','low-light','anime-clean','face-focus','old-video','gaming-60','clean-4k','maximum-detail']) {
    assert.match(index, new RegExp(`data-preset="${id}"`));
    assert.match(main, new RegExp(`'${id}'`));
  }
});

test('quality lab is grouped into real processing categories', () => {
  for (const label of ['الاستعادة','التفاصيل','الوضوح','الحدة','الثبات']) assert.match(ui, new RegExp(label));
  for (const id of ['denoise','deblock','artifactRemoval','detailRecovery','textureRecovery','smartSharpen','antiFlicker']) assert.match(ui, new RegExp(id));
});

test('profiles can directly enable real AI switches', () => {
  assert.match(main, /v\.ai\.upscale/);
  assert.match(main, /v\.ai\.rife/);
  assert.match(main, /v\.ai\.face/);
  assert.match(main, /'face-focus':[\s\S]*face:true/);
  assert.match(main, /'gaming-60':[\s\S]*rife:true/);
  assert.match(main, /'clean-4k':[\s\S]*upscale:true/);
});
