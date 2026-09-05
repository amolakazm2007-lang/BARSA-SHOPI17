import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_REGISTRY } from '../src/engine/UpscaleEngine.js';
import { RIFE_MODEL_REGISTRY } from '../src/engine/RIFEEngine.js';
import { FACE_MODEL_REGISTRY } from '../src/engine/FaceRestorationEngine.js';
import { FACE_DETECTOR_REGISTRY } from '../src/engine/FaceDetectorEngine.js';

const sha = /^[0-9a-f]{64}$/;
function assertCatalogEntry(entry, expectedSize) {
  assert.match(entry.sha256, sha);
  assert.equal(entry.expectedSizeBytes, expectedSize);
  const urls = entry.downloadCandidates || (entry.remoteURL ? [entry.remoteURL] : []);
  if (entry.bundledURL) { assert.ok(entry.bundledURL.startsWith('./')); return; }
  assert.ok(urls.length > 0);
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.protocol, 'https:');
    assert.ok(['github.com','huggingface.co'].includes(url.hostname));
  }
}

test('production automatic model metadata is pinned by hash and exact byte size', () => {
  assertCatalogEntry(MODEL_REGISTRY['onnx-model-zoo-sr-x3'], 240_078);
  assertCatalogEntry(MODEL_REGISTRY['real-esrgan-x4plus'], 67_167_471);
  assertCatalogEntry(RIFE_MODEL_REGISTRY['rife-tensorstack'], 21_458_882);
  assertCatalogEntry(RIFE_MODEL_REGISTRY['rife47-emmajohnson311'], 21_458_882);
  assertCatalogEntry(FACE_MODEL_REGISTRY['gfpgan-1.4'], 340_254_218);
  assertCatalogEntry(FACE_MODEL_REGISTRY.codeformer, 337_171_345);
  assertCatalogEntry(FACE_DETECTOR_REGISTRY['yunet-2026may'], 229_738);
  assertCatalogEntry(FACE_DETECTOR_REGISTRY['yunet-2023mar'], 232_589);
});
