import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicRenderFabric, snapTile } from '../src/engine/DynamicRenderFabric.js';

function safety(overrides = {}) {
  return { tier: 'NORMAL', loadScore: 3, codecQueue: 3, writeBacklog: 3, tileConcurrency: 2, checkpointEvery: 30, yieldEvery: 10, ...overrides };
}

test('DynamicRenderFabric keeps output quality untouched and raises safe throughput on strong devices', () => {
  const performance = { telemetry: { jsHeapUsedMB: 300, jsHeapLimitMB: 4000, gpuAllocatedMB: 100, gpuBudgetMB: 1000 }, getAdaptiveSettings: () => ({ tileSize: 384 }) };
  const fabric = new DynamicRenderFabric({ performance, capabilities: { deviceMemoryGB: 12, hardwareConcurrency: 8, webGPU: true } });
  const plan = fabric.plan({ safetyPlan: safety(), width: 1920, height: 1080, fps: 30, aiUpscale: true });
  assert.equal(plan.fabric, true);
  assert.equal(plan.tileSize, 384);
  assert.ok(plan.memoryBudgetMB >= 384);
  assert.equal(plan.enginePreference, 'WEBGPU_FIRST');
});

test('DynamicRenderFabric clamps concurrency and preview under high pressure', () => {
  const performance = { telemetry: { jsHeapUsedMB: 3500, jsHeapLimitMB: 4000, gpuAllocatedMB: 900, gpuBudgetMB: 1000 }, getAdaptiveSettings: () => ({ tileSize: 512 }) };
  const fabric = new DynamicRenderFabric({ performance, capabilities: { deviceMemoryGB: 8, hardwareConcurrency: 8, webGPU: true } });
  const plan = fabric.plan({ safetyPlan: safety({ tier: 'HEAVY', checkpointEvery: 45 }), width: 3840, height: 2160, fps: 60, aiUpscale: true, rife: true });
  assert.equal(plan.tileConcurrency, 1);
  assert.equal(plan.codecQueue, 1);
  assert.equal(plan.writeBacklog, 1);
  assert.equal(plan.tileSize, 192);
  assert.equal(plan.previewMaxFps, 3);
  assert.ok(plan.checkpointEvery >= 75);
});

test('snapTile returns reusable fixed tile shapes', () => {
  assert.equal(snapTile(370), 384);
  assert.equal(snapTile(220), 192);
  assert.equal(snapTile(500), 512);
});
