import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNcnnParam } from '../src/engine/NihuiModelBridge.js';

test('accepts a complete NCNN param header', () => {
  const text = `7767517\n2 3\nInput input 0 1 data\nConvolution conv 1 1 data out 0=3`;
  assert.deepEqual(inspectNcnnParam(text), { valid: true, layerCount: 2, blobCount: 3 });
});

test('rejects wrong magic and truncated NCNN params', () => {
  assert.equal(inspectNcnnParam('123\n1 1\nInput input 0 1 data').valid, false);
  assert.equal(inspectNcnnParam('7767517\n3 4\nInput input 0 1 data').valid, false);
});
