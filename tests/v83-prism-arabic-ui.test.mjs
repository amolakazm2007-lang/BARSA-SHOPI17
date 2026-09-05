import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v8.3 Prism UI keeps four focused mobile workspaces', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['studio','enhance','blur','render']) assert.match(html, new RegExp(`data-master-target=\"${id}\"`));
  assert.match(html, /PRISM CORE/);
  assert.match(html, /prism-status/);
});

test('v8.3 Arabic UI retains technical model names while translating controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/ui/EngineLabsUI.js', import.meta.url), 'utf8');
  for (const label of ['الاستوديو','التحسين','البلور','التصدير','مختبر الجودة','استعادة التفاصيل','إزالة الضوضاء','ترميم الوجوه']) assert.match(html + ui, new RegExp(label));
  for (const model of ['Real-ESRGAN','RIFE','GFPGAN','CodeFormer','YuNet']) assert.match(html, new RegExp(model));
});
