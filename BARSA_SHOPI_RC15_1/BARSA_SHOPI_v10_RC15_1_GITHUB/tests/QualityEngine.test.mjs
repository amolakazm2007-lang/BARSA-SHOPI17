import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQualityFrame, buildSmartEnhancePlan, resolveQualityEffects, splitEffectsForPipeline } from '../src/engine/QualityEngine.js';

test('Quality Lab OFF is a complete stage bypass', () => {
  const effects = resolveQualityEffects({ sharpenAmount: .8, denoiseAmount: .5 }, { stages: {
    smartSharpen: { enabled: false, strength: 1.2 },
    denoise: { enabled: false, strength: .9 },
  } });
  assert.equal(effects.sharpenAmount, 0);
  assert.equal(effects.denoiseAmount, 0);
});

test('quality pipeline separates cleanup, temporal, and finishing stages', () => {
  const stages = splitEffectsForPipeline({ deblockAmount: .4, temporalDenoise: .2, detailAmount: .6 });
  assert.equal(stages.cleanup.deblockAmount, .4);
  assert.equal(stages.temporal.temporalDenoise, .2);
  assert.equal(stages.finish.detailAmount, .6);
  assert.equal(stages.finish.deblockAmount, 0);
});

test('Smart Enhance enables useful processors instead of every processor', () => {
  const plan = buildSmartEnhancePlan({ blocking: .35, noise: .03, detail: .7, banding: .01, contrast: .8 }, 'strong');
  assert.equal(plan.stages.deblock.enabled, true);
  assert.equal(plan.stages.artifactRemoval.enabled, true);
  assert.equal(plan.stages.denoise.enabled, false);
  assert.equal(plan.stages.fineDetailRecovery.enabled, false);
});

test('general frame analysis returns bounded technical metrics', () => {
  const width = 16, height = 16, data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) { data[index] = 80; data[index + 1] = 110; data[index + 2] = 90; data[index + 3] = 255; }
  const metrics = analyzeQualityFrame({ width, height, data });
  for (const key of ['exposure', 'contrast', 'noise', 'detail', 'blocking', 'banding']) assert.ok(Number.isFinite(metrics[key]), key);
});
