import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v9.3 quick model download counters are present', () => {
  const html=fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../src/ui/ModelQuickUI.js', import.meta.url),'utf8');
  const main=fs.readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
  for (const id of ['quickUpscaleModelProgress','quickRifeModelProgress','quickFaceModelProgress']) assert.ok(html.includes(id));
  assert.ok(ui.includes('updateProgress(role, event = {})'));
  assert.ok(ui.includes('received'));
  assert.ok(ui.includes('total'));
  assert.ok(main.includes('quickModels?.updateProgress?.(role,event)'));
});
