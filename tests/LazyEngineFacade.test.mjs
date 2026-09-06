import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleLazyEngine } from '../src/engine/LazyEngineFacade.js';

test('module loader stays cold until first async engine operation', async () => {
  let loads = 0;
  const facade = createModuleLazyEngine('demo', async () => {
    loads++;
    return { async ping(value) { return value; }, destroy() {} };
  });
  assert.equal(loads, 0);
  facade.destroy();
  assert.equal(loads, 0);
  assert.equal(await facade.ping('ok'), 'ok');
  assert.equal(loads, 1);
});

test('concurrent first calls share exactly one module/engine load', async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const facade = createModuleLazyEngine('demo', async () => {
    loads++;
    await gate;
    return { async ping(value) { return value; } };
  });
  const a = facade.ping('a');
  const b = facade.ping('b');
  // The loader intentionally starts in a microtask. Yield once so this test
  // observes the actual asynchronous contract rather than assuming eager load.
  await Promise.resolve();
  assert.equal(loads, 1);
  release();
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  assert.equal(loads, 1);
});

test('RIFE execution preference is synchronous and replayed after module load', async () => {
  const calls = [];
  const facade = createModuleLazyEngine('rife', async () => ({
    setExecutionPreference(value) { calls.push(value); },
    async isAvailable(modelId) { return { available: true, modelId }; },
  }));
  facade.setExecutionPreference(false);
  assert.deepEqual(calls, []);
  const status = await facade.isAvailable('rife-v4.6');
  assert.equal(status.modelId, 'rife-v4.6');
  assert.deepEqual(calls, [false]);
});

test('selected model id passes through unchanged', async () => {
  const seen = [];
  const facade = createModuleLazyEngine('upscale', async () => ({
    async isAvailable(modelId) { seen.push(modelId); return { available: true }; },
    async warmup(modelId) { seen.push(modelId); },
  }));
  await facade.isAvailable('real-esrgan-x4plus');
  await facade.warmup('real-esrgan-x4plus');
  assert.deepEqual(seen, ['real-esrgan-x4plus', 'real-esrgan-x4plus']);
});

test('load failure is reported and a later call can retry cleanly', async () => {
  let attempts = 0;
  const faults = [];
  const facade = createModuleLazyEngine('demo', async () => {
    attempts++;
    if (attempts === 1) throw new Error('first load failed');
    return { async ping() { return 'ok'; } };
  }, { faultReporter: { warning(code, detail) { faults.push({ code, detail }); } } });
  await assert.rejects(() => facade.ping());
  assert.equal(await facade.ping(), 'ok');
  assert.equal(attempts, 2);
  assert.equal(faults[0].code, 'LAZY_ENGINE_LOAD_FAILED');
});
