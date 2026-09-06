import test from 'node:test';
import assert from 'node:assert/strict';
import { GPUDeviceLossGuard } from '../src/engine/GPUDeviceLossGuard.js';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
}

test('unexpected device loss becomes recoverable GPU_DEVICE_LOST', async () => {
  let resolveLost;
  const device = { lost: new Promise((resolve) => { resolveLost = resolve; }) };
  const guard = new GPUDeviceLossGuard({ logger: { error() {} } });
  let detail;
  guard.addEventListener('lost', (event) => { detail = event.detail; });
  guard.attach(device);
  resolveLost({ reason: 'unknown', message: 'driver reset' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(guard.lost, true);
  assert.equal(detail?.code, 'GPU_DEVICE_LOST');
  assert.throws(() => guard.assertAvailable(), (error) => error.code === 'GPU_DEVICE_LOST');
});

test('intentional device destroy is not treated as crash', async () => {
  let resolveLost;
  const device = { lost: new Promise((resolve) => { resolveLost = resolve; }) };
  const guard = new GPUDeviceLossGuard({ logger: { error() {} } });
  guard.attach(device);
  resolveLost({ reason: 'destroyed', message: 'intentional' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(guard.lost, false);
});
