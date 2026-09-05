import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeBlurConfiguration } from '../src/engine/VideoPipeline.js';
import { createBlurWeights } from '../src/engine/MotionBlurEngine.js';

test('v8.4 blur complete exposes documented weighting families and mobile-safe fps cap', () => {
  for (const method of ['equal','gaussian_sym','vegas','pyramid','gaussian','ascending','descending','gaussian_reverse']) {
    const weights = createBlurWeights(5, { method, stdDev: 1, mean: 0, bound: [-2, 2] });
    assert.equal(weights.length, 5);
    const sum = weights.reduce((a,b)=>a+b,0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `${method} weights must normalize`);
  }
  const safe = normalizeBlurConfiguration({ enabled:true, outputFps:'custom', customOutputFps:480, interpolation:true, interpolationFps:'custom', customInterpolationFps:480, interpolationMultiplier:8, mobileSafeMode:true }, 60, 60);
  assert.equal(safe.outputFps, 240);
  assert.equal(safe.interpolationFps, 240);
  assert.equal(safe.interpolationMultiplier, 5);
  const unlocked = normalizeBlurConfiguration({ enabled:true, outputFps:'custom', customOutputFps:480, interpolation:true, interpolationFps:'custom', customInterpolationFps:480, interpolationMultiplier:8, mobileSafeMode:false }, 60, 60);
  assert.equal(unlocked.outputFps, 480);
  assert.equal(unlocked.interpolationMultiplier, 8);
});

test('v8.4 blur-only render is isolated from AI restore, temporal reconstruction and stabilization', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /settings\.upscaleModelId=null/);
  assert.match(main, /settings\.faceModelId=null/);
  assert.match(main, /settings\.temporalReconstruction=\{enabled:false/);
  assert.match(main, /settings\.stabilization=\{enabled:false/);
  assert.match(main, /settings\.temporalMaster=\{enabled:false/);
  assert.match(main, /brightness:b\.filtersEnabled\?/);
  assert.doesNotMatch(main, /brightness:1,contrast:1,saturation:1,vibrance:0/);
});

test('v8.4 blur workspace includes cfg compatibility and dedicated MP4 render controls', async () => {
  const ui = await readFile(new URL('../src/ui/EngineLabsUI.js', import.meta.url), 'utf8');
  for (const id of ['blur-render-only','blur-export-cfg','blur-import-cfg','blur-render-crf','blur-gpu-interpolation','blur-gpu-encode','blur-filter-brightness','blur-detailed-filenames','blur-copy-dates']) {
    assert.match(ui, new RegExp(`id=["']${id}["']`));
  }
  assert.match(ui, /Desktop-only/);
  assert.match(ui, /serializeF0eBlurConfig/);
  assert.match(ui, /parseF0eBlurConfig/);
});
