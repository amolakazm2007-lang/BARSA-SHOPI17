import test from 'node:test';
import assert from 'node:assert/strict';
import { CrashProofFallbackPolicy } from '../src/engine/CrashProofFallbackPolicy.js';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
}

test('graphics fallback is WebGPU -> WebGL2 -> Canvas2D', async () => {
  const logs = [];
  const policy = new CrashProofFallbackPolicy({ logger: { error: (...args) => logs.push(['error', ...args]), warn: (...args) => logs.push(['warn', ...args]) } });
  const result = await policy.renderGraphics({
    webgpu: async () => { throw new Error('GPU device lost'); },
    webgl2: async () => 'webgl-frame',
    canvas2d: async () => 'canvas-frame',
  });
  assert.equal(result, 'webgl-frame');
  assert.equal(policy.isEnabled('WebGPU'), false);
  assert.ok(logs.some((entry) => String(entry[1]).includes('WebGPU -> WebGL2')));
});

test('graphics fallback reaches Canvas2D after WebGPU and WebGL2 fail', async () => {
  const policy = new CrashProofFallbackPolicy({ logger: { error() {}, warn() {} } });
  const result = await policy.renderGraphics({
    webgpu: async () => { throw new Error('GPU device lost'); },
    webgl2: async () => { throw new Error('WebGL2 context lost'); },
    canvas2d: async () => 'canvas-frame',
  });
  assert.equal(result, 'canvas-frame');
  assert.equal(policy.isEnabled('WebGPU'), false);
  assert.equal(policy.isEnabled('WebGL2'), false);
});

test('AI timeout falls back without hiding the cause', async () => {
  const logs = [];
  const policy = new CrashProofFallbackPolicy({ logger: { error: (...args) => logs.push(args), warn() {} } });
  const result = await policy.aiOrSafeFallback({
    label: 'RIFE inference',
    timeoutMs: 30,
    inference: async () => new Promise(() => {}),
    fallback: (error) => ({ mode: 'normal-fps', code: error.code }),
  });
  assert.deepEqual(result, { mode: 'normal-fps', code: 'OPERATION_TIMEOUT' });
  assert.ok(logs.length > 0);
});
