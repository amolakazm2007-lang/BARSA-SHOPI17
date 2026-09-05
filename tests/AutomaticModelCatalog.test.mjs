import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_REGISTRY } from '../src/engine/UpscaleEngine.js';
import { RIFE_MODEL_REGISTRY } from '../src/engine/RIFEEngine.js';
import { FACE_MODEL_REGISTRY } from '../src/engine/FaceRestorationEngine.js';
import { ModelManager } from '../src/engine/ModelManager.js';

test('automatic catalog exposes real downloadable ONNX candidates for primary AI models', () => {
  const configs = [
    MODEL_REGISTRY['real-esrgan-x4plus'],
    RIFE_MODEL_REGISTRY['rife-tensorstack'],
    RIFE_MODEL_REGISTRY['rife47-emmajohnson311'],
    FACE_MODEL_REGISTRY['gfpgan-1.4'],
    FACE_MODEL_REGISTRY.codeformer,
  ];
  for (const config of configs) {
    assert.equal(config.format, 'onnx');
    assert.ok(config.sha256?.length === 64, 'catalog model must be hash locked');
    assert.ok(config.downloadCandidates?.length >= 1, 'catalog model must have an automatic source');
    for (const url of config.downloadCandidates) {
      assert.equal(new URL(url).protocol, 'https:');
    }
  }
});

test('candidate installer falls through failed mirrors and keeps verification config', async () => {
  const manager = new ModelManager();
  const attempts = [];
  manager.installFromURL = async (id, url, config, onProgress) => {
    attempts.push({ id, url, sha256: config.sha256 });
    onProgress?.({ received: 1, total: 1, pct: 1 });
    if (attempts.length === 1) throw new Error('mirror unavailable');
    return { id, sourceURL: url };
  };
  manager.deleteModel = async () => {};
  const result = await manager.installFromCandidates('demo', {
    sha256: 'a'.repeat(64),
    downloadCandidates: ['https://huggingface.co/a/model.onnx', 'https://github.com/a/b/releases/download/v1/model.onnx'],
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].sha256, 'a'.repeat(64));
  assert.equal(result.sourceURL, attempts[1].url);
});
