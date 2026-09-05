import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const compact = await readFile(new URL('../src/ui/CompactProUI.js', import.meta.url), 'utf8');
const models = await readFile(new URL('../src/ui/ModelQuickUI.js', import.meta.url), 'utf8');

test('v9.2 supports independent multi-select processing cards', () => {
  for (const id of ['cp-restore-on','cp-detail-on','cp-sharp-on','cp-face-on','cp-motion-on','cp-stabilize-on','cp-color-on']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(compact,/compactActiveStack/);
  assert.match(compact,/STACK\.filter/);
});

test('v9.2 exposes simplified manual model roles', () => {
  for (const id of ['quickUpscaleModel','quickRifeModel','quickFaceModel','quickModelsPrepare','quickModelsManage']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(models,/source\.dispatchEvent\(new Event\('change'/);
  assert.doesNotMatch(models,/auto.*select/i);
});

test('v9.2 keeps blur and export independent', () => {
  assert.match(html,/البلور يبقى بخانة مستقلة ورندر مستقل/);
  assert.match(html,/التصدير يبقى بخانة مستقلة/);
});
