import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { NativeAiClient } from '../src/platform/NativeAiClient.js';

test('v8.6 native AI lazy model check avoids re-uploading cached face models', async () => {
  const oldFetch = globalThis.fetch;
  let loadCalls = 0, fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls++;
    assert.match(String(url), /\/native-ai\/model\?/);
    return new Response(JSON.stringify({ ready: true, bytes: 337171345 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const client = new NativeAiClient({ api: { getNativeAiInfo: () => JSON.stringify({ available: true, binaryTileApi: true, nativeFaceApi: true }), getNativeAiToken: () => '0123456789abcdef0123456789abcdef' }, origin: 'http://127.0.0.1:7777' });
    const ok = await client.ensureModelLazy('codeformer', { bytes: 337171345, sha256: 'abc', load: async () => { loadCalls++; return new ArrayBuffer(16); } });
    assert.equal(ok, true);
    assert.equal(fetchCalls, 1);
    assert.equal(loadCalls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('v8.6 native inference sends fidelity and accepts exact face tensor output', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get('fidelity'), '0.72');
    assert.equal(init.method, 'POST');
    const out = new Float32Array(3 * 2 * 2).fill(0.25);
    return new Response(out.buffer, { status: 200, headers: { 'X-Barsa-Width': '2', 'X-Barsa-Height': '2', 'X-Barsa-Channels': '3', 'X-Barsa-Provider': 'nnapi/cpu-fallback' } });
  };
  try {
    const client = new NativeAiClient({ api: { getNativeAiInfo: () => JSON.stringify({ available: true, binaryTileApi: true, nativeFaceApi: true }), getNativeAiToken: () => '0123456789abcdef0123456789abcdef' }, origin: 'http://127.0.0.1:7777' });
    const result = await client.infer('gfpgan-1.4', new Float32Array(12), { channels: 3, width: 2, height: 2, fidelity: 0.72 });
    assert.equal(result.data.length, 12);
    assert.equal(result.provider, 'nnapi/cpu-fallback');
  } finally { globalThis.fetch = oldFetch; }
});

test('v8.6 native face and render-proof wiring are present in production paths', async () => {
  const [face, runtime, server, pipeline, main, html] = await Promise.all([
    fs.readFile(new URL('../src/engine/FaceRestorationEngine.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java', import.meta.url), 'utf8'),
    fs.readFile(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(face, /ensureModelLazy/);
  assert.match(face, /android-native:/);
  assert.match(runtime, /nativeFaceApi/);
  assert.match(runtime, /auxiliaryInputs/);
  assert.match(server, /fidelity=parseFloat/);
  assert.match(pipeline, /faceProvider:/);
  assert.match(main, /downloadRenderProof/);
  assert.match(html, /renderProofBtn/);
});
