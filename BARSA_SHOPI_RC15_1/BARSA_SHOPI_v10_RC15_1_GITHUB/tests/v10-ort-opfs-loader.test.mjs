import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createOrtSessionWithFallback } from '../src/engine/OrtSessionLoader.js';

test('ORT loader prefers OPFS Blob URL and does not request a JS ArrayBuffer when URL loading works', async () => {
  let bufferLoads = 0;
  const manager = {
    openModelFile: async () => new Blob([new Uint8Array([1,2,3,4])]),
    loadModelBuffer: async () => { bufferLoads++; return new ArrayBuffer(4); },
  };
  const seen = [];
  const ort = { InferenceSession: { create: async (source, options) => { seen.push({ source, options }); return { ok: true }; } } };
  const result = await createOrtSessionWithFallback({
    modelManager: manager, ort, modelId: 'm',
    webgpuOptions: [{ graphCapture: false, options: { executionProviders: ['webgpu'] } }],
    wasmOptions: { executionProviders: ['wasm'] },
  });
  assert.equal(result.sourceKind, 'opfs-blob-url');
  assert.equal(result.executionProvider, 'webgpu');
  assert.equal(bufferLoads, 0);
  assert.equal(typeof seen[0].source, 'string');
  assert.match(seen[0].source, /^blob:/);
});

test('ORT loader falls back to ArrayBuffer when blob URL path is unsupported', async () => {
  let bufferLoads = 0;
  const manager = {
    openModelFile: async () => new Blob([new Uint8Array([1,2,3,4])]),
    loadModelBuffer: async () => { bufferLoads++; return new ArrayBuffer(4); },
  };
  const ort = { InferenceSession: { create: async (source, options) => {
    if (typeof source === 'string') throw new Error('blob unsupported');
    return { provider: options.executionProviders[0] };
  } } };
  const result = await createOrtSessionWithFallback({
    modelManager: manager, ort, modelId: 'm',
    webgpuOptions: [{ graphCapture: false, options: { executionProviders: ['webgpu'] } }],
    wasmOptions: { executionProviders: ['wasm'] },
  });
  assert.equal(result.sourceKind, 'array-buffer');
  assert.equal(result.executionProvider, 'webgpu');
  assert.equal(bufferLoads, 1);
});

test('all major web ONNX engines use the shared low-copy loader', () => {
  for (const file of ['UpscaleEngine.js','RIFEEngine.js','FaceRestorationEngine.js','FaceDetectorEngine.js']) {
    const source = fs.readFileSync(new URL(`../src/engine/${file}`, import.meta.url), 'utf8');
    assert.match(source, /createOrtSessionWithFallback/);
  }
  const server = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8');
  assert.match(server, /connect-src 'self' https: blob:/);
});
