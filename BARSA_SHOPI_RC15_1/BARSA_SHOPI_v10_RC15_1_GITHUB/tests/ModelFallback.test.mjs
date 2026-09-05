import test from 'node:test';
import assert from 'node:assert/strict';
import { UpscaleEngine, UPSCALE_FALLBACK_CHAIN } from '../src/engine/UpscaleEngine.js';
import { RIFEEngine, RIFE_FALLBACK_CHAIN } from '../src/engine/RIFEEngine.js';

test('upscale fallback stops at the first already-installed model', async () => {
  const manager = { getStatus: async () => ({ installed: true, verified: true }) };
  const engine = new UpscaleEngine(manager);
  const tested = [];
  engine.runSelfTest = async (id) => { tested.push(id); return true; };
  assert.equal(await engine.resolveWorkingModel(), UPSCALE_FALLBACK_CHAIN[0]);
  assert.deepEqual(tested, [UPSCALE_FALLBACK_CHAIN[0]]);
});

test('upscale fallback installs the bundled candidate then uses a verified fallback', async () => {
  const attempted = [];
  const manager = {
    getStatus: async (id) => ({ installed: id === UPSCALE_FALLBACK_CHAIN[1], verified: id === UPSCALE_FALLBACK_CHAIN[1] }),
    installFromCandidates: async (id) => {
      attempted.push(id);
      throw new Error('simulated remote digest failure');
    },
    installBundled: async (id) => {
      attempted.push(id);
      throw new Error('simulated bundled digest failure');
    },
  };
  const engine = new UpscaleEngine(manager);
  engine.runSelfTest = async () => true;
  assert.equal(await engine.resolveWorkingModel(), UPSCALE_FALLBACK_CHAIN[1]);
  assert.deepEqual(attempted, [UPSCALE_FALLBACK_CHAIN[0]]);
});

test('upscale fallback never reports success if every candidate fails', async () => {
  const manager = {
    getStatus: async () => ({ installed: false, verified: false }),
    installBundled: async () => { throw new Error('bundled install failed'); },
    installFromURL: async () => { throw new Error('download failed'); },
  };
  const engine = new UpscaleEngine(manager);
  engine.ensureModel = async () => { throw new Error('manual model absent'); };
  engine.runSelfTest = async () => true;
  assert.equal(await engine.resolveWorkingModel(), null);
});

test('upscale fallback rejects a model that downloads but fails inference', async () => {
  const manager = { getStatus: async () => ({ installed: true, verified: true }) };
  const engine = new UpscaleEngine(manager);
  const tested = [];
  engine.runSelfTest = async (id) => {
    tested.push(id);
    if (id === UPSCALE_FALLBACK_CHAIN[0]) throw new Error('bad output shape');
    return true;
  };
  assert.equal(await engine.resolveWorkingModel(), UPSCALE_FALLBACK_CHAIN[1]);
  assert.deepEqual(tested, UPSCALE_FALLBACK_CHAIN.slice(0, 2));
});

test('RIFE retains its independent fallback contract', async () => {
  const engine = new RIFEEngine({});
  engine.ensureModel = async (id) => { if (id === RIFE_FALLBACK_CHAIN[0]) throw new Error('first failed'); };
  engine.runSelfTest = async () => true;
  assert.equal(await engine.resolveWorkingModel(), RIFE_FALLBACK_CHAIN[1]);
});
