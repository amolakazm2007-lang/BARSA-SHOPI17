import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RenderLoadGovernor } from '../src/engine/RenderLoadGovernor.js';

const pipeline = await fs.readFile(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');

test('v10 render uses offscreen full-resolution surface and throttled visible preview', () => {
  assert.match(pipeline, /const outputCanvas = new OffscreenCanvas\(outputSize\.width, outputSize\.height\)/);
  assert.match(pipeline, /createThrottledRenderPreview\(previewCanvas, outputSize/);
  assert.match(pipeline, /renderPreview\?\.draw\(outputCanvas, timestamp\)/);
  assert.doesNotMatch(pipeline, /const outputCanvas = previewCanvas \|\|/);
});

test('v10 render progress UI is throttled instead of updating every encoded frame', () => {
  assert.match(pipeline, /now - lastProgressUiAt < 125/);
  assert.match(pipeline, /reportRenderProgress\(\{/);
});

test('v10 completed exports are not redundantly duplicated into frame cache', () => {
  assert.doesNotMatch(pipeline, /9999999999/);
  assert.doesNotMatch(pipeline, /role: 'final-output'/);
});

test('v10 checkpoint cadence scales by time instead of every few frames', () => {
  const governor = new RenderLoadGovernor();
  const plan60 = governor.plan({ width:3840, height:2160, fps:60, aiUpscale:true });
  const plan120 = governor.plan({ width:3840, height:2160, fps:120, aiUpscale:true });
  assert.ok(plan60.checkpointEvery >= 30);
  assert.ok(plan120.checkpointEvery >= 60);
  assert.ok(plan60.yieldEvery >= 4);
});

test('v10 stage cache avoids per-hit IndexedDB writes and reconciles orphans', async () => {
  const storage = await fs.readFile(new URL('../src/engine/StorageManager.js', import.meta.url), 'utf8');
  assert.match(storage, /touchDue = now - Number\(index\[name\]\.lastAccessAt \|\| 0\) >= 30_000/);
  assert.match(storage, /async reconcileStageCacheIndex\(\)/);
  assert.match(storage, /unindexed stage cannot be referenced by ApplyStack/i);
  assert.match(storage, /await this\.reconcileStageCacheIndex\(\)\.catch/);
});
