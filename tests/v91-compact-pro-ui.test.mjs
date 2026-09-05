import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html','utf8');
const compact = fs.readFileSync('src/ui/CompactProUI.js','utf8');
const css = fs.readFileSync('src/styles.css','utf8');

test('Compact Pro exposes distinct specialist controls without merging blur/export', () => {
  for (const id of ['cp-restore-on','cp-detail-on','cp-sharp-on','cp-face-on','cp-motion-on','cp-stabilize-on','cp-color-on']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /البلور يبقى بخانة مستقلة ورندر مستقل/);
  assert.match(html, /التصدير يبقى بخانة مستقلة/);
});

test('Compact groups map to real underlying stages', () => {
  for (const token of ['compressionRecovery','detailFusion','smartSharpen','faceEnabled','rifeEnabled','st-enabled','cl-enabled']) assert.ok(compact.includes(token), token);
});

test('Advanced controls are hidden by default only in enhance pane', () => {
  assert.match(css, /body\[data-master-panel="enhance"\].*#engineLabsMount/);
  assert.match(css, /show-advanced-enhance/);
});
