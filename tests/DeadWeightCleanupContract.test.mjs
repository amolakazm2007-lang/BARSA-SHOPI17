import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function exists(path) {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

test('production startup has no dead Nihui bridge and device diagnostics are module-lazy', async () => {
  const manager = await read('src/engine/EngineManager.js');
  const main = await read('src/main.js');
  const html = await read('index.html');

  assert.doesNotMatch(manager, /NihuiModelBridge|\bnihui\b/i);
  assert.doesNotMatch(main, /\bnihui\b/i);
  assert.doesNotMatch(html, /\bnihui\b/i);
  assert.equal(await exists('src/engine/NihuiModelBridge.js'), false);

  assert.doesNotMatch(manager, /import\s*\{\s*FullDeviceTestEngine\s*\}\s*from/);
  assert.match(manager, /import\('\.\/FullDeviceTestEngine\.js'\)/);
  assert.match(manager, /this\.deviceTest\s*=\s*createLazyDeviceTestHandle\(this\)/);
});

test('diagnostic quality sampling is not executed in the production frame hot path', async () => {
  const manager = await read('src/engine/EngineManager.js');
  const pipeline = await read('src/engine/VideoPipeline.js');

  assert.doesNotMatch(manager, /QualityMetricsEngine/);
  assert.doesNotMatch(pipeline, /\bqualityMetrics\b/);
  assert.doesNotMatch(pipeline, /\.sample\(outputCanvas,\s*encodedFrames\)/);
});

test('real visual engines and output-quality controls remain present', async () => {
  const html = await read('index.html');
  const pipeline = await read('src/engine/VideoPipeline.js');

  for (const id of ['upscaleEnabled', 'rifeEnabled', 'faceEnabled', 'audioEnabled']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const stage of ['restore', 'detail', 'face', 'upscale', 'motion', 'rife', 'stabilize', 'blur']) {
    assert.match(html, new RegExp(`data-batch-stage=["']${stage}["']`));
  }

  assert.match(pipeline, /createQualityLockFingerprint/);
  assert.match(pipeline, /assertQualityLockFingerprint/);
  assert.match(pipeline, /FrameIntegrityMonitor/);
});
