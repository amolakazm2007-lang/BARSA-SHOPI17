import test from 'node:test';
import assert from 'node:assert/strict';
import { BarsaError, withHardTimeout, runFallbackChain, ProgressWatchdog } from '../src/engine/CrashProofRuntime.js';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
}

test('withHardTimeout fails even when operation ignores AbortSignal', async () => {
  const started = Date.now();
  await assert.rejects(
    withHardTimeout(() => new Promise(() => {}), { timeoutMs: 40, label: 'hung-operation' }),
    (error) => error instanceof BarsaError && error.code === 'OPERATION_TIMEOUT'
  );
  assert.ok(Date.now() - started < 500);
});

test('runFallbackChain moves to next backend and preserves failure visibility', async () => {
  const events = [];
  const result = await runFallbackChain([
    { name: 'WebGPU', run: async () => { throw new Error('GPU device lost'); }, cleanup: async () => events.push('gpu-cleanup') },
    { name: 'WebGL2', run: async () => 'webgl-ok' },
    { name: 'Canvas2D', run: async () => 'canvas-ok' },
  ], { onFallback: ({ from, to }) => events.push(`${from}->${to}`) });
  assert.equal(result, 'webgl-ok');
  assert.deepEqual(events, ['gpu-cleanup', 'WebGPU->WebGL2']);
});

test('ProgressWatchdog detects silent frame stall and executes cleanup callback', async () => {
  let stalled = null;
  const watchdog = new ProgressWatchdog({ timeoutMs: 1000, pollMs: 100, label: 'test-render', onStall: async (error) => { stalled = error; } });
  watchdog.start(5);
  watchdog.lastProgressAt = performance.now() - 2000;
  await watchdog._check();
  watchdog.stop();
  assert.equal(stalled?.code, 'PIPELINE_STALLED');
  assert.equal(stalled?.details?.lastCount, 5);
});

test('ProgressWatchdog resets timeout when frame count increases', async () => {
  let stalls = 0;
  const watchdog = new ProgressWatchdog({ timeoutMs: 1000, pollMs: 100, onStall: async () => { stalls += 1; } });
  watchdog.start(0);
  watchdog.lastProgressAt = performance.now() - 2000;
  watchdog.progress(1);
  await watchdog._check();
  watchdog.stop();
  assert.equal(stalls, 0);
});
