import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQualityEffects, buildSmartEnhancePlan } from '../src/engine/QualityEngine.js';
import { RenderResilienceEngine } from '../src/engine/RenderResilienceEngine.js';
import { RenderLoadGovernor } from '../src/engine/RenderLoadGovernor.js';

test('Compression Rescue V3 stages resolve into real effect settings', () => {
  const effects = resolveQualityEffects({}, { stages: {
    mosquitoNoise: { enabled: true, strength: .61 },
    compressionRecovery: { enabled: true, strength: .84 },
  }});
  assert.equal(effects.mosquitoNoise, .61);
  assert.equal(effects.compressionRecovery, .84);
  const plan = buildSmartEnhancePlan({ blocking:.7, noise:.25, detail:.3, banding:.2, contrast:.5 }, 'strong');
  assert.equal(plan.stages.mosquitoNoise.enabled, true);
  assert.equal(plan.stages.compressionRecovery.enabled, true);
});

test('Render resilience reduces queues but never requests frame dropping', () => {
  const engine = new RenderResilienceEngine({ sampleEveryFrames: 1 });
  const action = engine.evaluate({ frameIndex: 1, codecQueue: 9, writeBacklog: 7, plan: { codecQueue: 2, writeBacklog: 2 } });
  assert.ok(['HIGH','CRITICAL'].includes(action.tier));
  assert.equal(action.codecQueue, 1);
  assert.equal(action.writeBacklog, 1);
  assert.equal(engine.diagnostics().policy, 'never-drop-frames-never-change-output');
});

test('POCO F6 4K plan uses sustained mobile policy', () => {
  const plan = new RenderLoadGovernor().plan({ width:3840, height:2160, fps:60, aiUpscale:true, rife:true, face:true, deviceMemoryGB:8, deviceProfile:{ id:'POCO_F6', label:'POCO F6 · Turbo' } });
  assert.equal(plan.tier, 'EXTREME');
  assert.equal(plan.codecQueue, 1);
  assert.equal(plan.tileConcurrency, 1);
  assert.equal(plan.sustainedMobile, true);
  assert.equal(plan.thermalBias, 'SUSTAINED');
});
