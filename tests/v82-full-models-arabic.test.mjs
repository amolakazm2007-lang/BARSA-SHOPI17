import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTO_MODEL_PLAN } from '../src/engine/AutoModelVault.js';

test('v8.2 full automatic model suite includes every audited catalog model', () => {
  const ids = new Set(AUTO_MODEL_PLAN.map(x => x.modelId));
  for (const id of ['onnx-model-zoo-sr-x3','real-esrgan-x4plus','rife-tensorstack','rife47-emmajohnson311','yunet-2026may','gfpgan-1.4','codeformer']) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});

test('v8.2 Arabic help center is present with external tutorials', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /مركز الشروحات/);
  assert.match(html, /Real-ESRGAN/);
  assert.match(html, /RIFE/);
  assert.match(html, /GFPGAN/);
  assert.match(html, /youtube\.com\/watch/);
});

test('v8.2 full models button requests all catalog models', () => {
  const js = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(js, /includeAllCatalog:true/);
});
