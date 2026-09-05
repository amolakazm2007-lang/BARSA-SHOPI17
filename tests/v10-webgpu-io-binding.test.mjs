import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WebGpuIoArena } from '../src/engine/WebGpuIoArena.js';

class MockBuffer {
  constructor(size) { this.bytes = new Uint8Array(size); this.mapState = 'unmapped'; this.destroyed = false; }
  async mapAsync() { this.mapState = 'mapped'; }
  getMappedRange(offset = 0, size = this.bytes.byteLength) {
    return this.bytes.buffer.slice(this.bytes.byteOffset + offset, this.bytes.byteOffset + offset + size);
  }
  unmap() { this.mapState = 'unmapped'; }
  destroy() { this.destroyed = true; }
}

function makeGpuHarness() {
  globalThis.GPUBufferUsage = { COPY_DST: 1, STORAGE: 2, COPY_SRC: 4, MAP_READ: 8 };
  globalThis.GPUMapMode = { READ: 1 };
  let createCount = 0;
  const device = {
    createBuffer({ size }) { createCount++; return new MockBuffer(size); },
    queue: {
      writeBuffer(target, targetOffset, sourceBuffer, sourceOffset, size) {
        target.bytes.set(new Uint8Array(sourceBuffer, sourceOffset, size), targetOffset);
      },
      submit(commands) {
        for (const command of commands) for (const copy of command.copies) {
          copy.dst.bytes.set(copy.src.bytes.subarray(copy.srcOffset, copy.srcOffset + copy.size), copy.dstOffset);
        }
      },
    },
    createCommandEncoder() {
      const copies = [];
      return {
        copyBufferToBuffer(src, srcOffset, dst, dstOffset, size) { copies.push({ src, srcOffset, dst, dstOffset, size }); },
        finish() { return { copies }; },
      };
    },
  };
  class Tensor {
    static fromGpuBuffer(buffer, options) { return { buffer, dims: [...options.dims], type: options.dataType, gpu: true }; }
  }
  const ort = { Tensor, env: { webgpu: { device } } };
  return { device, ort, getCreateCount: () => createCount };
}

test('WebGpuIoArena preserves Float32 results and reuses GPU buffers for an identical shape', async () => {
  const { ort, getCreateCount } = makeGpuHarness();
  const arena = new WebGpuIoArena(ort, { maxSlots: 2 });
  const session = {
    async run(feeds, fetches) {
      const input = new Float32Array(feeds.input.buffer.bytes.buffer, 0, 4);
      const output = new Float32Array(fetches.output.buffer.bytes.buffer, 0, 4);
      for (let i = 0; i < 4; i++) output[i] = input[i] * 2;
      return fetches;
    },
  };
  const first = await arena.run({
    session, inputName: 'input', outputName: 'output', input: new Float32Array([1,2,3,4]),
    inputDims: [1,1,2,2], outputDims: [1,1,2,2],
  });
  assert.deepEqual([...first.data], [2,4,6,8]);
  assert.equal(first.gpuIoBound, true);
  assert.equal(getCreateCount(), 3, 'one input + one output + one readback allocation');

  const second = await arena.run({
    session, inputName: 'input', outputName: 'output', input: new Float32Array([5,6,7,8]),
    inputDims: [1,1,2,2], outputDims: [1,1,2,2],
  });
  assert.deepEqual([...second.data], [10,12,14,16]);
  assert.equal(getCreateCount(), 3, 'same shape must reuse all GPU buffers');
  arena.clear();
});

test('WebGpuIoArena supports multiple GPU inputs for RIFE-style IO binding', async () => {
  const { ort } = makeGpuHarness();
  const arena = new WebGpuIoArena(ort);
  const session = {
    async run(feeds, fetches) {
      const a = new Float32Array(feeds.a.buffer.bytes.buffer, 0, 4);
      const b = new Float32Array(feeds.b.buffer.bytes.buffer, 0, 4);
      const out = new Float32Array(fetches.out.buffer.bytes.buffer, 0, 4);
      for (let i = 0; i < 4; i++) out[i] = (a[i] + b[i]) / 2;
      assert.equal(feeds.timestep.data[0], 0.5);
      return fetches;
    },
  };
  const result = await arena.runMulti({
    session,
    gpuFeeds: [
      { name: 'a', data: new Float32Array([0,2,4,6]), dims: [1,1,2,2] },
      { name: 'b', data: new Float32Array([2,4,6,8]), dims: [1,1,2,2] },
    ],
    cpuFeeds: { timestep: { data: new Float32Array([0.5]) } },
    outputName: 'out', outputDims: [1,1,2,2],
  });
  assert.deepEqual([...result.data], [1,3,5,7]);
});

test('Upscale and RIFE integrate IO binding with automatic standard-path fallback', () => {
  const upscale = fs.readFileSync(new URL('../src/engine/UpscaleEngine.js', import.meta.url), 'utf8');
  const rife = fs.readFileSync(new URL('../src/engine/RIFEEngine.js', import.meta.url), 'utf8');
  assert.match(upscale, /webgpu:iobinding/);
  assert.match(upscale, /using standard ORT path/);
  assert.match(upscale, /gpuIoDisabledModels\.add\(modelId\)/);
  assert.match(rife, /runMulti/);
  assert.match(rife, /webgpu:iobinding/);
  assert.match(rife, /using standard ORT path/);
});
