import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RenderLoadGovernor } from '../src/engine/RenderLoadGovernor.js';
import { resolveQualityEffects } from '../src/engine/QualityEngine.js';

test('4K long-render governor chooses single-frame queues without changing requested output', () => {
  const plan = new RenderLoadGovernor().plan({ width:3840, height:2160, fps:60, aiUpscale:true, rife:true, face:true, deviceMemoryGB:8 });
  assert.equal(plan.tier, 'EXTREME');
  assert.equal(plan.codecQueue, 1);
  assert.equal(plan.writeBacklog, 1);
  assert.equal(plan.tileConcurrency, 1);
});

test('Denoise/Detail V3 stages resolve into real effects', () => {
  const out = resolveQualityEffects({}, { stages:{ chromaDenoise:{enabled:true,strength:.61}, detailFusion:{enabled:true,strength:.87} } });
  assert.equal(out.chromaDenoise, .61);
  assert.equal(out.detailFusion, .87);
  const shader = fs.readFileSync(new URL('../src/effects/shaders.wgsl.js', import.meta.url), 'utf8');
  assert.match(shader, /chromaDenoise/);
  assert.match(shader, /detailFusion/);
});

test('Native RIFE path is wired end-to-end with Android fallback', () => {
  const rife = fs.readFileSync(new URL('../src/engine/RIFEEngine.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/platform/NativeAiClient.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java', import.meta.url), 'utf8');
  assert.match(rife, /inferRife/);
  assert.match(rife, /falling back to WebGPU\/WASM/);
  assert.match(client, /\/native-ai\/rife/);
  assert.match(server, /\/native-ai\/rife/);
  assert.match(runtime, /InferenceResult inferRife/);
});
