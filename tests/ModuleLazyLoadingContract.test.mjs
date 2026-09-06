import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const managerPath = new URL('../src/engine/EngineManager.js', import.meta.url);
const pipelinePath = new URL('../src/engine/VideoPipeline.js', import.meta.url);
const catalogPath = new URL('../src/engine/RenderCatalog.js', import.meta.url);

async function source(path) { return readFile(path, 'utf8'); }

test('EngineManager startup path has no static imports of heavy AI or FFmpeg engines', async () => {
  const code = await source(managerPath);
  for (const module of ['RIFEEngine.js', 'UpscaleEngine.js', 'FaceRestorationEngine.js', 'FaceDetectorEngine.js', 'FFmpegEngine.js']) {
    assert.doesNotMatch(code, new RegExp(`^import .*${module.replace('.', '\\.')}`, 'm'));
    assert.match(code, new RegExp(`import\\(['\"]\\./${module.replace('.', '\\.')}['\"]\\)`));
  }
  assert.match(code, /createModuleLazyEngine/);
});

test('VideoPipeline imports lightweight metadata and tensor helpers only', async () => {
  const code = await source(pipelinePath);
  assert.match(code, /from '\.\/RenderCatalog\.js'/);
  assert.match(code, /from '\.\/TensorImageUtils\.js'/);
  assert.doesNotMatch(code, /from '\.\/UpscaleEngine\.js'/);
  assert.doesNotMatch(code, /from '\.\/FFmpegEngine\.js'/);
});

test('render catalog preserves all current quality-locked upscale geometries', async () => {
  const { UPSCALE_RENDER_CATALOG, QUALITY_PRESETS } = await import(catalogPath.href);
  assert.deepEqual(UPSCALE_RENDER_CATALOG['realesr-general-x4v3-turbo'], { scale: 4, tileSize: 192, overlap: 12 });
  assert.deepEqual(UPSCALE_RENDER_CATALOG['onnx-model-zoo-sr-x3'], { scale: 3, tileSize: 224, overlap: 12 });
  assert.deepEqual(UPSCALE_RENDER_CATALOG['real-esrgan-compatible-x4'], { scale: 4, tileSize: 256, overlap: 16 });
  assert.deepEqual(UPSCALE_RENDER_CATALOG['real-esrgan-x4plus'], { scale: 4, tileSize: 128, overlap: 12 });
  assert.deepEqual(UPSCALE_RENDER_CATALOG['real-esrgan-x8-facefusion'], { scale: 8, tileSize: 256, overlap: 12 });
  assert.deepEqual(UPSCALE_RENDER_CATALOG['real-cugan-x2-fp16'], { scale: 2, tileSize: 256, overlap: 12 });
  assert.equal(QUALITY_PRESETS.BALANCED.bitsPerPixel, 0.11);
  assert.equal(QUALITY_PRESETS.ULTRA.audioBitrateK, 320);
});

test('migration is declared deterministic and fails on missing structural patterns', async () => {
  const code = await readFile(new URL('../scripts/apply-phase3-lazy-loading.mjs', import.meta.url), 'utf8');
  assert.match(code, /replaceRequired/);
  assert.match(code, /pattern missing/);
  assert.match(code, /source\.includes\(to\)/);
});
