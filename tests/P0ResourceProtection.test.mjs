import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DynamicRenderFabric, estimateWorkloadMB } from '../src/engine/DynamicRenderFabric.js';

test('render workload estimate grows with AI stages and queue depth', () => {
  const base = estimateWorkloadMB({ width: 1920, height: 1080, codecQueue: 1, tileConcurrency: 1 });
  const heavy = estimateWorkloadMB({ width: 3840, height: 2160, codecQueue: 3, tileConcurrency: 2, aiUpscale: true, rife: true, face: true });
  assert.ok(base > 0);
  assert.ok(heavy > base * 4);
});

test('DynamicRenderFabric passes non-zero workload to MemoryGovernor and preserves quality lock', () => {
  let observedWorkload = 0;
  const fabric = new DynamicRenderFabric({
    capabilities: { deviceMemoryGB: 8, hardwareConcurrency: 8, webGPU: true },
    performance: { telemetry: {}, getAdaptiveSettings: () => ({ tileSize: 256 }) },
    memoryGovernor: {
      evaluate({ workloadMB }) {
        observedWorkload = workloadMB;
        return { safeBudgetMB: 512, state: 'high', concurrencyCap: 1, queueCap: 1 };
      },
    },
  });
  const plan = fabric.plan({
    safetyPlan: { tier: 'HEAVY', tileConcurrency: 3, codecQueue: 4, writeBacklog: 4, checkpointEvery: 30 },
    width: 3840,
    height: 2160,
    fps: 60,
    aiUpscale: true,
    rife: true,
    face: true,
  });
  assert.ok(observedWorkload > 0);
  assert.equal(plan.qualityLocked, true);
  assert.equal(plan.tileConcurrency, 1);
  assert.equal(plan.codecQueue, 1);
  assert.equal(plan.writeBacklog, 1);
  assert.ok(plan.estimatedWorkloadMB > 0);
});

test('Doctor memory repair must verify telemetry instead of unconditional success', async () => {
  const source = await fs.readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');
  assert.match(source, /pressureRatio\(telemetry\)/);
  assert.match(source, /performance\.now\(\) \+ 4000/);
  assert.match(source, /ratio < 0\.75/);
  assert.doesNotMatch(source, /return true; \/\/ release methods completed/);
});
