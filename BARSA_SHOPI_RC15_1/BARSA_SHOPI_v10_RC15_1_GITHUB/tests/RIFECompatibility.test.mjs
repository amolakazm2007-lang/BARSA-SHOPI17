import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRifeFeeds, inspectRifeSignature } from '../src/engine/RIFEEngine.js';

class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }

test('RIFE adapter recognizes dual-image plus timestep signatures', () => {
  const session = {
    inputNames: ['img0', 'img1', 'timestep'],
    inputMetadata: {
      img0: { dimensions: [1, 3, 'height', 'width'] },
      img1: { dimensions: [1, 3, 'height', 'width'] },
      timestep: { dimensions: [1] },
    },
  };
  const signature = inspectRifeSignature(session);
  assert.equal(signature.convention, 'dual');
  assert.equal(signature.timestepInput, 'timestep');
  const frame = new Float32Array(3 * 8 * 8);
  const feeds = buildRifeFeeds(session, { Tensor }, signature, frame, frame, 8, 8, 0.25);
  assert.deepEqual(feeds.img0.dims, [1, 3, 8, 8]);
  assert.equal(feeds.timestep.data[0], 0.25);
});

test('RIFE adapter recognizes concatenated six-channel inputs with scale', () => {
  const session = {
    inputNames: ['input', 'scale'],
    inputMetadata: {
      input: { dimensions: [1, 6, 64, 64] },
      scale: { dimensions: [1] },
    },
  };
  const signature = inspectRifeSignature(session);
  assert.equal(signature.convention, 'concat');
  assert.equal(signature.width, 64);
  const a = new Float32Array(3 * 64 * 64).fill(0.2);
  const b = new Float32Array(3 * 64 * 64).fill(0.8);
  const feeds = buildRifeFeeds(session, { Tensor }, signature, a, b, 64, 64);
  assert.deepEqual(feeds.input.dims, [1, 6, 64, 64]);
  assert.ok(Math.abs(feeds.input.data[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(feeds.input.data[3 * 64 * 64] - 0.8) < 1e-6);
  assert.equal(feeds.scale.data[0], 1);
});

test('RIFE adapter rejects unknown auxiliary tensors', () => {
  const session = {
    inputNames: ['img0', 'img1', 'flow'],
    inputMetadata: {
      img0: { dimensions: [1, 3, 32, 32] }, img1: { dimensions: [1, 3, 32, 32] }, flow: { dimensions: [1, 2, 32, 32] },
    },
  };
  assert.throws(() => inspectRifeSignature(session), /Unsupported RIFE auxiliary inputs/);
});
