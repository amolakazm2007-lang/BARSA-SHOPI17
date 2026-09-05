import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFaceFeeds,
  faceRollRadians,
  resolveFaceSignature,
  stabilizeFaceBoxes,
} from '../src/engine/FaceRestorationEngine.js';

class Tensor {
  constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
}

test('face signature supports GFPGAN image-only exports', () => {
  const session = { inputNames: ['input'], inputMetadata: { input: { dimensions: [1, 3, 512, 512] } } };
  assert.deepEqual(resolveFaceSignature(session, { inputSize: 256 }), {
    imageInput: 'input', inputSize: 512, auxiliaryInputs: [],
  });
});

test('face signature supports CodeFormer fidelity-weight input in any order', () => {
  const session = {
    inputNames: ['w', 'x'],
    inputMetadata: {
      w: { dimensions: [1] },
      x: { dimensions: [1, 3, 512, 512] },
    },
  };
  const signature = resolveFaceSignature(session, { inputSize: 512 });
  assert.equal(signature.imageInput, 'x');
  assert.deepEqual(signature.auxiliaryInputs, ['w']);
  const image = new Float32Array(3 * 512 * 512);
  const feeds = buildFaceFeeds(session, { Tensor }, signature, image, 0.73);
  assert.deepEqual(feeds.x.dims, [1, 3, 512, 512]);
  assert.deepEqual(feeds.w.dims, [1]);
  assert.ok(Math.abs(feeds.w.data[0] - 0.73) < 1e-6);
});

test('face signature rejects unknown auxiliary inputs instead of guessing', () => {
  const session = {
    inputNames: ['image', 'latent'],
    inputMetadata: {
      image: { dimensions: [1, 3, 256, 256] },
      latent: { dimensions: [1, 512] },
    },
  };
  assert.throws(() => resolveFaceSignature(session, {}), /Unsupported face-model auxiliary input/);
});

test('face boxes are temporally stabilized and unmatched detections are kept', () => {
  const previous = [{ x: 100, y: 80, width: 200, height: 200, landmarks: [[140, 130], [220, 140]] }];
  const current = [
    { x: 110, y: 90, width: 204, height: 196, landmarks: [[144, 134], [224, 144]] },
    { x: 500, y: 100, width: 120, height: 120 },
  ];
  const boxes = stabilizeFaceBoxes(previous, current, 0.5);
  assert.deepEqual(boxes[0], { x: 105, y: 85, width: 202, height: 198, landmarks: [[142, 132], [222, 142]] });
  assert.deepEqual(boxes[1], current[1]);
});

test('face roll uses eye landmarks and clamps extreme angles', () => {
  assert.ok(Math.abs(faceRollRadians([[10, 10], [30, 20]]) - Math.atan2(10, 20)) < 1e-9);
  assert.equal(faceRollRadians(null), 0);
  assert.equal(faceRollRadians([[0, 0], [0, 50]]), 35 * Math.PI / 180);
});
