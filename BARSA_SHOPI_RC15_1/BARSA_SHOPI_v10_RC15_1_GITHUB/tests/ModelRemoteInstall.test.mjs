import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelManager } from '../src/engine/ModelManager.js';

test('remote model install accepts only audited HTTPS hosts and streams progress', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  });
  globalThis.location = new URL('https://studio.example.test/');
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  globalThis.fetch = async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  const manager = new ModelManager();
  let imported = null;
  manager._importStream = async (id, stream, total, name, config, onProgress) => {
    const reader = stream.getReader();
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      onProgress?.({ received, total, pct: total ? received / total : 0 });
    }
    imported = { id, size: received, config, name };
    return imported;
  };
  const progress = [];
  await manager.installFromURL('mobile-sr', 'https://huggingface.co/org/model/resolve/main/model.onnx', { license: 'Apache-2.0' }, (event) => progress.push(event));
  assert.equal(imported.id, 'mobile-sr');
  assert.equal(imported.size, bytes.length);
  assert.match(imported.config.sourceURL, /^https:\/\/huggingface\.co\//);
  assert.ok(progress.some((event) => event.stage === 'download' && event.received === bytes.length));
  await assert.rejects(() => manager.installFromURL('bad', 'https://example.com/model.onnx'), /audited HTTPS catalog/);
  await assert.rejects(() => manager.installFromURL('bad', 'http://huggingface.co/model.onnx'), /audited HTTPS catalog/);
});
