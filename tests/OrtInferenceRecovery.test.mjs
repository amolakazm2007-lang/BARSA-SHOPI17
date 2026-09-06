import test from 'node:test';
import assert from 'node:assert/strict';
import { runOrtInferenceWithRecovery } from '../src/engine/OrtInferenceRecovery.js';

test('ONNX timeout invalidates and recreates the same model session exactly once', async () => {
  let generation = 0;
  const invalidated = [];
  const requestedModels = [];
  const result = await runOrtInferenceWithRecovery({
    modelId: 'locked-model',
    timeoutMs: 15,
    getSession: async (modelId) => {
      requestedModels.push(modelId);
      return { generation: ++generation };
    },
    invalidateSession: async (modelId, session) => invalidated.push({ modelId, generation: session.generation }),
    run: async (session) => {
      if (session.generation === 1) return new Promise(() => {});
      return { ok: true, generation: session.generation };
    },
    logger: { warn() {}, error() {} },
  });
  assert.deepEqual(requestedModels, ['locked-model', 'locked-model']);
  assert.equal(result.ok, true);
  assert.equal(result.generation, 2);
  assert.ok(invalidated.length >= 1);
  assert.ok(invalidated.every((row) => row.modelId === 'locked-model'));
});

test('ONNX recovery never retries non-timeout inference failures', async () => {
  let loads = 0;
  await assert.rejects(() => runOrtInferenceWithRecovery({
    modelId: 'manual-model',
    timeoutMs: 50,
    getSession: async () => ({ id: ++loads }),
    invalidateSession: async () => {},
    run: async () => { throw Object.assign(new Error('bad tensor'), { code: 'ORT_BAD_INPUT' }); },
  }), /bad tensor/);
  assert.equal(loads, 1);
});

test('ONNX recovery stops after one same-model retry if replacement session also stalls', async () => {
  let loads = 0;
  await assert.rejects(() => runOrtInferenceWithRecovery({
    modelId: 'manual-model',
    timeoutMs: 10,
    getSession: async () => ({ id: ++loads }),
    invalidateSession: async () => {},
    run: async () => new Promise(() => {}),
    logger: { warn() {}, error() {} },
  }), (error) => error?.code === 'OPERATION_TIMEOUT');
  assert.equal(loads, 2);
});
