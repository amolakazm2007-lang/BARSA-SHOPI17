import test from 'node:test';
import assert from 'node:assert/strict';
import { UpscaleEngine, imageDataToLumaFloat32, lumaToUpscaledImageData } from '../src/engine/UpscaleEngine.js';

if (!globalThis.ImageData) globalThis.ImageData = class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };

test('mobile luminance pipeline preserves chroma while replacing detail luminance', () => {
  const source = new ImageData(new Uint8ClampedArray([220, 70, 40, 255, 30, 160, 210, 255]), 2, 1);
  const luma = imageDataToLumaFloat32(source);
  assert.equal(luma.length, 2);
  assert.ok(luma.every((value) => value >= 0 && value <= 1));
  const output = lumaToUpscaledImageData(new Float32Array(6 * 3).fill(.55), source, 3);
  assert.equal(output.width, 6);
  assert.equal(output.height, 3);
  assert.equal(output.data.length, 72);
  assert.ok(output.data.some((value, index) => index % 4 !== 3 && value !== output.data[0]), 'output is not grayscale');
  for (let index = 3; index < output.data.length; index += 4) assert.equal(output.data[index], 255);
});

test('fixed-input ONNX tiles are edge padded then cropped to real tile geometry', async () => {
  const engine = new UpscaleEngine({});
  engine.ort = { Tensor: class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } } };
  const session = {
    inputNames: ['input'], outputNames: ['output'], inputMetadata: [{ dimensions: [1, 3, 2, 2] }],
    async run(feeds) {
      assert.deepEqual(feeds.input.dims, [1, 3, 2, 2]);
      return { output: { data: new Float32Array(3 * 8 * 8).fill(.5), dims: [1, 3, 8, 8] } };
    },
  };
  engine._loadSession = async () => session;
  const output = await engine.upscaleTile('real-esrgan-compatible-x4', new Float32Array([.1, .2, .3]), 1, 1);
  assert.equal(output.data.length, 3 * 4 * 4);
});
