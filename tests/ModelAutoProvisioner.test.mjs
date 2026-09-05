import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelAutoProvisioner } from '../src/engine/ModelAutoProvisioner.js';

test('keeps an already verified model without reinstalling', async () => {
  let installs = 0;
  const engine = { isAvailable: async () => ({ available: true }), installCatalogModel: async () => { installs++; } };
  const result = await new ModelAutoProvisioner().ensure({ role: 'rife', modelId: 'a', engine, registry: { a: { remoteURL: 'https://example.invalid/a.onnx' } } });
  assert.equal(result.modelId, 'a');
  assert.equal(installs, 0);
});

test('automatically installs and verifies a catalog model', async () => {
  let ready = false;
  const engine = { isAvailable: async () => ({ available: ready }), installCatalogModel: async () => { ready = true; } };
  const result = await new ModelAutoProvisioner().ensure({ role: 'upscale', modelId: 'a', engine, registry: { a: { bundledURL: './a.onnx', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } } });
  assert.equal(result.ready, true);
  assert.equal(result.installed, true);
});

test('switches to a runtime-verified fallback when primary install fails', async () => {
  const engine = {
    isAvailable: async (id) => ({ available: id === 'fallback' }),
    installCatalogModel: async () => { throw new Error('network'); },
    resolveWorkingModel: async () => 'fallback',
  };
  const result = await new ModelAutoProvisioner().ensure({ role: 'rife', modelId: 'primary', engine, registry: { primary: { remoteURL: 'https://example.invalid/a.onnx', sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } } });
  assert.equal(result.modelId, 'fallback');
  assert.equal(result.changed, true);
});
