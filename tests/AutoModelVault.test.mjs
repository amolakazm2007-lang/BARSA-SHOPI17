import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoModelVault } from '../src/engine/AutoModelVault.js';

test('auto model vault installs core models sequentially and skips huge face model by default', async () => {
  const calls = [];
  const make = (role) => ({
    destroy() { calls.push(`destroy:${role}`); },
  });
  const manager = { engines: {
    upscale: make('upscale'), rife: make('rife'), face: make('face'),
    faceDetector: {
      available: false,
      async isAvailable() { return { available: this.available }; },
      async installCatalogModel() { calls.push('install:faceDetector'); this.available = true; },
      destroy() { calls.push('destroy:faceDetector'); },
    },
  } };
  const provisioner = { async ensure({ role, modelId }) { calls.push(`ensure:${role}:${modelId}`); return { modelId, ready: true }; } };
  const vault = new AutoModelVault({ manager, provisioner, registries: { upscale: {}, rife: {}, face: {} } });
  const result = await vault.ensureCore();
  assert.equal(result.total, 4);
  assert.equal(result.ready, 4);
  assert.deepEqual(calls.filter((x) => x.startsWith('ensure:')), [
    'ensure:upscale:realesr-general-x4v3-turbo',
    'ensure:upscale:onnx-model-zoo-sr-x3',
    'ensure:rife:rife-tensorstack',
  ]);
  assert.equal(calls.includes('ensure:face:gfpgan-1.4'), false);
});

test('full vault includes face restoration and keeps going after one model fails', async () => {
  const manager = { engines: {
    upscale: {}, rife: {}, face: {},
    faceDetector: { async isAvailable() { return { available: true }; } },
  } };
  const provisioner = { async ensure({ role, modelId }) {
    if (role === 'rife') throw new Error('mirror unavailable');
    return { modelId, ready: true };
  } };
  const vault = new AutoModelVault({ manager, provisioner, registries: { upscale: {}, rife: {}, face: {} } });
  const result = await vault.ensureCore({ includeFace: true });
  assert.equal(result.total, 5);
  assert.equal(result.ready, 4);
  assert.equal(result.results.find((x) => x.role === 'rife').ok, false);
  assert.equal(result.results.find((x) => x.role === 'face').ok, true);
});
