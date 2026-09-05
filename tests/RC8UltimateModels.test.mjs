import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MODEL_REGISTRY, UPSCALE_FALLBACK_CHAIN } from '../src/engine/UpscaleEngine.js';
import { RIFE_FALLBACK_CHAIN } from '../src/engine/RIFEEngine.js';
import { FACE_DETECTOR_REGISTRY, DEFAULT_FACE_DETECTOR_MODEL, FACE_DETECTOR_FALLBACK_CHAIN } from '../src/engine/FaceDetectorEngine.js';

test('RC8 turbo upscaler is pinned to an exact audited model', () => {
  const m = MODEL_REGISTRY['realesr-general-x4v3-turbo'];
  assert.ok(m);
  assert.equal(m.sha256, 'e8db65652ed421c2f8c92645d8f6fc6b07fd2868a916fdaa1a99c8d28091f097');
  assert.equal(m.expectedSizeBytes, 4_868_759);
  assert.equal(m.scale, 4);
  assert.match(m.downloadCandidates[0], /^https:\/\/huggingface\.co\//);
  assert.equal(UPSCALE_FALLBACK_CHAIN[0], 'realesr-general-x4v3-turbo');
});


test('RC8 YuNet 2026 is the audited default while 2023 remains a safe fallback', () => {
  const latest = FACE_DETECTOR_REGISTRY['yunet-2026may'];
  assert.equal(DEFAULT_FACE_DETECTOR_MODEL, 'yunet-2026may');
  assert.deepEqual(FACE_DETECTOR_FALLBACK_CHAIN, ['yunet-2026may', 'yunet-2023mar']);
  assert.equal(latest.expectedSizeBytes, 229_738);
  assert.equal(latest.sha256, 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0');
  assert.match(latest.remoteURL, /face_detection_yunet_2026may\.onnx/);
  assert.ok(FACE_DETECTOR_REGISTRY['yunet-2023mar']);
});

test('RC8 RIFE fallback tries automatic verified sources before manual compatible files', () => {
  assert.deepEqual(RIFE_FALLBACK_CHAIN.slice(0, 2), ['rife-tensorstack', 'rife47-emmajohnson311']);
  assert.equal(RIFE_FALLBACK_CHAIN.at(-1), 'rife-compatible');
});

test('bundled Mobile SR bytes match the pinned catalog digest', () => {
  const file = fs.readFileSync(new URL('../public/models/super-resolution-10.onnx', import.meta.url));
  assert.equal(file.length, MODEL_REGISTRY['onnx-model-zoo-sr-x3'].expectedSizeBytes);
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), MODEL_REGISTRY['onnx-model-zoo-sr-x3'].sha256);
});

test('model UI exposes per-model numerical progress and explicit working state', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(html, /data-suite-model="realesr-general-x4v3-turbo"/);
  assert.match(html, /class="suite-progress"/);
  assert.match(main, /100% · شغال ✓/);
  assert.match(main, /updateSuiteModelProgress/);
  assert.match(main, /realesr-general-x4v3-turbo/);
  assert.match(main, /modelTransferDetails/);
  assert.match(main, /formatEta/);
  assert.match(main, /\/s/);
});

test('model download path has a stall timeout and explicit verify stage', () => {
  const source = fs.readFileSync(new URL('../src/engine/ModelManager.js', import.meta.url), 'utf8');
  assert.match(source, /NETWORK_READ_TIMEOUT_MS = 30_000/);
  assert.match(source, /MODEL_DOWNLOAD_STALLED/);
  assert.match(source, /stage: 'verify'/);
  assert.match(source, /stage: 'complete'/);
});

test('native ONNX sessions can be released without deleting model files', () => {
  const server = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/platform/NativeAiClient.js', import.meta.url), 'utf8');
  assert.match(server, /DELETE.*\/native-ai\/session/);
  assert.match(runtime, /public void releaseSession/);
  assert.match(client, /async releaseSession\(modelId\)/);
});

test('face processing reuses scratch memory and throttles detector work', () => {
  const source = fs.readFileSync(new URL('../src/engine/FaceRestorationEngine.js', import.meta.url), 'utf8');
  assert.match(source, /this\.detectionInterval = 4/);
  assert.match(source, /_getFaceScratch\(size\)/);
  assert.match(source, /otherSession\.release/);
});

test('all heavy web ONNX engines request full graph optimization', () => {
  for (const path of ['../src/engine/UpscaleEngine.js', '../src/engine/RIFEEngine.js', '../src/engine/FaceRestorationEngine.js']) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /graphOptimizationLevel: 'all'/);
  }
});
