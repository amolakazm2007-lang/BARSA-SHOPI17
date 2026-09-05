import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeYuNetOutputs, resolveYuNetSignature } from '../src/engine/FaceDetectorEngine.js';

function tensor(length) { return { data: new Float32Array(length) }; }

function blankOutputs(width = 32, height = 32) {
  const output = {};
  for (const stride of [8, 16, 32]) {
    const count = width / stride * (height / stride);
    output[`cls_${stride}`] = tensor(count);
    output[`obj_${stride}`] = tensor(count);
    output[`bbox_${stride}`] = tensor(count * 4);
    output[`kps_${stride}`] = tensor(count * 10);
  }
  return output;
}

test('YuNet decoder converts stride predictions into a face and landmarks', () => {
  const output = blankOutputs();
  const index = 2 * 4 + 2;
  output.cls_8.data[index] = 1;
  output.obj_8.data[index] = 0.81;
  const faces = decodeYuNetOutputs(output, 32, 32, { scoreThreshold: 0.7, maxFaces: 4 });
  assert.equal(faces.length, 1);
  assert.deepEqual({ x: faces[0].x, y: faces[0].y, width: faces[0].width, height: faces[0].height }, { x: 12, y: 12, width: 8, height: 8 });
  assert.ok(Math.abs(faces[0].score - 0.9) < 1e-6);
  assert.deepEqual(faces[0].landmarks[0], [16, 16]);
});

test('YuNet decoder rejects incomplete model exports', () => {
  assert.throws(() => decodeYuNetOutputs({ cls_8: tensor(1) }, 32, 32), /missing obj_8/);
});

test('YuNet signature accepts fixed NCHW and rejects invalid channels', () => {
  const session = { inputNames: ['input'], inputMetadata: [{ dimensions: [1, 3, 320, 320] }] };
  assert.deepEqual(resolveYuNetSignature(session, {}), { inputName: 'input', width: 320, height: 320 });
  assert.throws(() => resolveYuNetSignature({ ...session, inputMetadata: [{ dimensions: [1, 1, 320, 320] }] }), /received 1 channels/);
});
