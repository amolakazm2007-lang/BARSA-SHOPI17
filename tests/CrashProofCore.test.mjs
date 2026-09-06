import test from 'node:test';
import assert from 'node:assert/strict';
import { BarsaError, withHardTimeout, runFallbackChain, ProgressWatchdog } from '../src/engine/CrashProofRuntime.js';
import { CrashProofFallbackPolicy } from '../src/engine/CrashProofFallbackPolicy.js';
import { GPUDeviceLossGuard } from '../src/engine/GPUDeviceLossGuard.js';
import { WebGLContextGuard } from '../src/engine/WebGLContextGuard.js';

if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };

test('hard timeout rejects a Promise that ignores AbortSignal', async () => {
  const started = Date.now();
  await assert.rejects(withHardTimeout(() => new Promise(() => {}), { timeoutMs: 30, label: 'hung' }), (error) => error instanceof BarsaError && error.code === 'OPERATION_TIMEOUT');
  assert.ok(Date.now() - started < 500);
});

test('fallback chain advances and runs cleanup', async () => {
  const events = [];
  const result = await runFallbackChain([
    { name: 'A', run: async () => { throw new Error('fail'); }, cleanup: async () => events.push('cleanup') },
    { name: 'B', run: async () => 'ok' },
  ], { onFallback: ({ from, to }) => events.push(`${from}->${to}`) });
  assert.equal(result, 'ok');
  assert.deepEqual(events, ['cleanup', 'A->B']);
});

test('graphics recovery order is WebGPU -> WebGL2 -> Canvas2D', async () => {
  const policy = new CrashProofFallbackPolicy({ logger: { error() {}, warn() {} } });
  const result = await policy.renderGraphics({ webgpu: async () => { throw new Error('lost'); }, webgl2: async () => 'webgl', canvas2d: async () => 'canvas' });
  assert.equal(result, 'webgl');
  assert.equal(policy.isEnabled('WebGPU'), false);
});

test('graphics recovery reaches Canvas2D after both GPU backends fail', async () => {
  const policy = new CrashProofFallbackPolicy({ logger: { error() {}, warn() {} } });
  const result = await policy.renderGraphics({ webgpu: async () => { throw new Error('lost'); }, webgl2: async () => { throw new Error('lost'); }, canvas2d: async () => 'canvas' });
  assert.equal(result, 'canvas');
});

test('watchdog detects a silent frame stall', async () => {
  let stalled;
  const watchdog = new ProgressWatchdog({ timeoutMs: 1000, pollMs: 100, onStall: async (error) => { stalled = error; } });
  watchdog.start(5); watchdog.lastProgressAt = performance.now() - 2000; await watchdog._check(); watchdog.stop();
  assert.equal(stalled?.code, 'PIPELINE_STALLED');
});

test('unexpected WebGPU device loss is recoverable', async () => {
  let resolveLost; const device = { lost: new Promise((resolve) => { resolveLost = resolve; }) };
  const guard = new GPUDeviceLossGuard({ logger: { error() {} } }); guard.attach(device); resolveLost({ reason: 'unknown', message: 'reset' });
  await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(guard.lost, true); assert.throws(() => guard.assertAvailable(), (e) => e.code === 'GPU_DEVICE_LOST');
});

test('WebGL context loss blocks rendering until restoration', () => {
  class FakeCanvas extends EventTarget {} const canvas = new FakeCanvas(); const guard = new WebGLContextGuard({ canvas, logger: { error() {}, warn() {} } });
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); assert.equal(guard.lost, true); assert.throws(() => guard.assertAvailable(), (e) => e.code === 'WEBGL_CONTEXT_LOST');
  canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(guard.lost, false); guard.dispose();
});
