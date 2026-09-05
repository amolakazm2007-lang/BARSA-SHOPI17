import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const arena = fs.readFileSync(new URL('../src/engine/WebGpuIoArena.js', import.meta.url), 'utf8');
const compositor = fs.readFileSync(new URL('../src/engine/WebGpuTileCompositor.js', import.meta.url), 'utf8');
const upscale = fs.readFileSync(new URL('../src/engine/UpscaleEngine.js', import.meta.url), 'utf8');

test('WebGpuIoArena exposes retained GPU output without CPU readback', () => {
  assert.match(arena, /async runGpu\(/);
  assert.match(arena, /gpuBuffer: slot\.outputBuffer/);
  assert.match(arena, /release: \(\) =>/);
  const method = arena.slice(arena.indexOf('async runGpu('), arena.indexOf('async run({', arena.indexOf('async runGpu(')));
  assert.doesNotMatch(method, /mapAsync|mapped\.slice|Float32Array\(mapped/);
});

test('GPU compositor performs weighted CHW blend and only final readback', () => {
  assert.match(compositor, /var<storage, read> src: array<f32>/);
  assert.match(compositor, /var<storage, read_write> accum: array<vec4<f32>>/);
  assert.match(compositor, /edgeWeight/);
  assert.match(compositor, /encoder\.copyBufferToBuffer\(this\.outputBuffer/);
  assert.match(compositor, /async selfTest/);
  assert.match(compositor, /tolerance = 1/);
});

test('UpscaleEngine enables GPU compositor only behind runtime verification and fallback', () => {
  assert.match(upscale, /_ensureGpuCompositorVerified/);
  assert.match(upscale, /await this\.gpuCompositor\.selfTest/);
  assert.match(upscale, /_upscaleFrameGpuComposited/);
  assert.match(upscale, /restarting frame with quality-locked CPU compositor/);
  assert.match(upscale, /destCtx\.putImageData\(finalImage/);
  assert.match(upscale, /webgpu:iobinding\+gpu-compositor/);
});

test('GPU fast path does not alter model scale, output resolution, FPS or bitrate settings', () => {
  const method = upscale.slice(upscale.indexOf('async _upscaleFrameGpuComposited'), upscale.indexOf('/**\n   * Upscales one full frame', upscale.indexOf('async _upscaleFrameGpuComposited')));
  assert.match(method, /const \{ scale \} = config/);
  assert.match(method, /const outW = width \* scale, outH = height \* scale/);
  assert.doesNotMatch(method, /bitrate|fps\s*=|scale\s*=\s*[0-9]/i);
});
