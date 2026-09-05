/**
 * GPU tile compositor for quality-locked AI upscaling.
 *
 * Keeps ONNX CHW float output on the WebGPU device and accumulates overlap
 * blending in a full-frame float32 RGBA+weight buffer. Only one readback is
 * performed after all tiles are complete. The weight equation intentionally
 * mirrors TileProcessor.edgeRampWeight().
 */
export class WebGpuTileCompositor {
  constructor(device) {
    this.device = device;
    this.pipeline = null;
    this.normalizePipeline = null;
    this.accumBuffer = null;
    this.outputBuffer = null;
    this.readbackBuffer = null;
    this.uniformBuffer = null;
    this.width = 0;
    this.height = 0;
    this.destroyed = false;
    this.deviceLost = false;
    device?.lost?.then?.((info) => {
      this.deviceLost = true;
      this._releaseBuffers();
      this.lastFailure = `device-lost:${info?.reason || 'unknown'}:${info?.message || ''}`;
    }).catch?.(() => {});
  }

  get available() {
    return !this.destroyed && !this.deviceLost && Boolean(this.device)
      && typeof GPUBufferUsage !== 'undefined'
      && typeof GPUMapMode !== 'undefined';
  }


  frameRequirements(width, height) {
    const pixels = Number(width) * Number(height);
    if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new RangeError('Invalid GPU compositor size');
    return { pixels, accumBytes: pixels * 16, outBytes: pixels * 4, totalBytes: pixels * 24 };
  }

  supportsFrameSize(width, height) {
    if (!this.available) return false;
    const { accumBytes, outBytes } = this.frameRequirements(width, height);
    const limits = this.device?.limits || {};
    const maxStorage = Number(limits.maxStorageBufferBindingSize || 128 * 1024 * 1024);
    const maxBuffer = Number(limits.maxBufferSize || 256 * 1024 * 1024);
    return accumBytes <= maxStorage && accumBytes <= maxBuffer && outBytes <= maxStorage && outBytes <= maxBuffer;
  }

  _ensurePipelines() {
    if (this.pipeline) return;
    const device = this.device;
    const blendModule = device.createShaderModule({ code: `
struct Params {
  frameW:u32, frameH:u32, tileW:u32, tileH:u32,
  destX:u32, destY:u32, overlap:u32, flags:u32,
  srcW:u32, srcH:u32, _pad0:u32, _pad1:u32,
};
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> p: Params;

fn edgeWeight(pos:u32, length:u32, overlap:u32, hasPrev:bool, hasNext:bool) -> f32 {
  var w:f32 = 1.0;
  if (overlap > 0u && hasPrev && pos < overlap) {
    w = min(w, (f32(pos) + 0.5) / f32(overlap));
  }
  if (overlap > 0u && hasNext && pos >= length - overlap) {
    w = min(w, (f32(length - pos) - 0.5) / f32(overlap));
  }
  return clamp(w, 0.0, 1.0);
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= p.tileW || y >= p.tileH) { return; }
  let hasLeft = (p.flags & 1u) != 0u;
  let hasRight = (p.flags & 2u) != 0u;
  let hasTop = (p.flags & 4u) != 0u;
  let hasBottom = (p.flags & 8u) != 0u;
  let wx = edgeWeight(x, p.tileW, p.overlap, hasLeft, hasRight);
  let wy = edgeWeight(y, p.tileH, p.overlap, hasTop, hasBottom);
  let weight = wx * wy;
  let plane = p.srcW * p.srcH;
  let srcIndex = y * p.srcW + x;
  let dstX = p.destX + x;
  let dstY = p.destY + y;
  if (dstX >= p.frameW || dstY >= p.frameH) { return; }
  let dstIndex = dstY * p.frameW + dstX;
  let r = clamp(src[srcIndex], 0.0, 1.0);
  let g = clamp(src[plane + srcIndex], 0.0, 1.0);
  let b = clamp(src[2u * plane + srcIndex], 0.0, 1.0);
  let old = accum[dstIndex];
  accum[dstIndex] = old + vec4<f32>(r * weight, g * weight, b * weight, weight);
}` });
    this.pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: blendModule, entryPoint: 'main' } });

    const normalizeModule = device.createShaderModule({ code: `
struct Params { frameW:u32, frameH:u32, _a:u32, _b:u32 };
@group(0) @binding(0) var<storage, read> accum: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> p: Params;
fn byte(v:f32) -> u32 { return u32(round(clamp(v, 0.0, 1.0) * 255.0)); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i = gid.x;
  let total = p.frameW * p.frameH;
  if (i >= total) { return; }
  let a = accum[i];
  let inv = select(0.0, 1.0 / a.w, a.w > 0.0);
  let r = byte(a.x * inv);
  let g = byte(a.y * inv);
  let b = byte(a.z * inv);
  out[i] = r | (g << 8u) | (b << 16u) | (255u << 24u);
}` });
    this.normalizePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: normalizeModule, entryPoint: 'main' } });
  }

  begin(width, height) {
    if (!this.available) throw new Error('WebGPU compositor unavailable');
    this._ensurePipelines();
    this._releaseBuffers();
    this.width = width;
    this.height = height;
    if (!this.supportsFrameSize(width, height)) {
      const error = new Error(`GPU compositor frame ${width}x${height} exceeds device buffer limits`);
      error.code = 'GPU_COMPOSITOR_LIMIT';
      throw error;
    }
    const { pixels, accumBytes, outBytes } = this.frameRequirements(width, height);
    this.accumBuffer = this.device.createBuffer({ size: accumBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.outputBuffer = this.device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.readbackBuffer = this.device.createBuffer({ size: outBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.uniformBuffer = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // Clear on the GPU instead of uploading up to hundreds of MB of zeroes
    // from JavaScript for every frame. This is byte-identical to zero filling.
    const clearEncoder = this.device.createCommandEncoder();
    clearEncoder.clearBuffer(this.accumBuffer);
    this.device.queue.submit([clearEncoder.finish()]);
  }

  composeTile({ gpuBuffer, tileWidth, tileHeight, sourceWidth = tileWidth, sourceHeight = tileHeight, destX, destY, overlap, hasLeft, hasRight, hasTop, hasBottom }) {
    if (!this.accumBuffer) throw new Error('GPU compositor frame not begun');
    const flags = (hasLeft ? 1 : 0) | (hasRight ? 2 : 0) | (hasTop ? 4 : 0) | (hasBottom ? 8 : 0);
    const params = new Uint32Array([this.width, this.height, tileWidth, tileHeight, destX, destY, overlap, flags, sourceWidth, sourceHeight, 0, 0]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, params);
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: gpuBuffer } },
        { binding: 1, resource: { buffer: this.accumBuffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(tileWidth / 8), Math.ceil(tileHeight / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  async finish() {
    if (!this.accumBuffer) throw new Error('GPU compositor frame not begun');
    const smallParams = new Uint32Array([this.width, this.height, 0, 0]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, smallParams);
    const bindGroup = this.device.createBindGroup({
      layout: this.normalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.accumBuffer } },
        { binding: 1, resource: { buffer: this.outputBuffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.normalizePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil((this.width * this.height) / 256));
    pass.end();
    encoder.copyBufferToBuffer(this.outputBuffer, 0, this.readbackBuffer, 0, this.width * this.height * 4);
    this.device.queue.submit([encoder.finish()]);
    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const mapped = this.readbackBuffer.getMappedRange();
    const rgba = new Uint8ClampedArray(mapped.slice(0));
    this.readbackBuffer.unmap();
    return new ImageData(rgba, this.width, this.height);
  }

  async selfTest({ tolerance = 1 } = {}) {
    if (!this.available) return false;
    const device = this.device;
    const width = 6, height = 4, tileW = 4, tileH = 4, overlap = 2;
    const makeTile = (rgb) => {
      const plane = tileW * tileH;
      const data = new Float32Array(plane * 3);
      data.fill(rgb[0], 0, plane);
      data.fill(rgb[1], plane, plane * 2);
      data.fill(rgb[2], plane * 2);
      const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    const left = makeTile([1, 0.25, 0]);
    const right = makeTile([0, 0.25, 1]);
    try {
      this.begin(width, height);
      this.composeTile({ gpuBuffer: left, tileWidth: tileW, tileHeight: tileH, destX: 0, destY: 0, overlap, hasLeft: false, hasRight: true, hasTop: false, hasBottom: false });
      this.composeTile({ gpuBuffer: right, tileWidth: tileW, tileHeight: tileH, destX: 2, destY: 0, overlap, hasLeft: true, hasRight: false, hasTop: false, hasBottom: false });
      const actual = await this.finish();
      const expected = new Uint8ClampedArray(width * height * 4);
      const weight = (pos, length, hasPrev, hasNext) => {
        let w = 1;
        if (hasPrev && pos < overlap) w = Math.min(w, (pos + 0.5) / overlap);
        if (hasNext && pos >= length - overlap) w = Math.min(w, (length - pos - 0.5) / overlap);
        return Math.max(0, Math.min(1, w));
      };
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, total = 0;
        if (x < 4) { const w = weight(x, 4, false, true); r += 1 * w; g += .25 * w; total += w; }
        if (x >= 2) { const lx = x - 2; const w = weight(lx, 4, true, false); b += 1 * w; g += .25 * w; total += w; }
        const i = (y * width + x) * 4;
        expected[i] = Math.round((r / total) * 255);
        expected[i + 1] = Math.round((g / total) * 255);
        expected[i + 2] = Math.round((b / total) * 255);
        expected[i + 3] = 255;
      }
      for (let i = 0; i < expected.length; i++) {
        if (Math.abs(Number(expected[i]) - Number(actual.data[i])) > tolerance) {
          throw new Error(`GPU compositor self-test mismatch at byte ${i}: ${actual.data[i]} vs ${expected[i]}`);
        }
      }
      return true;
    } finally {
      try { left.destroy(); } catch {}
      try { right.destroy(); } catch {}
      this._releaseBuffers();
    }
  }

  _releaseBuffers() {
    for (const value of ['accumBuffer', 'outputBuffer', 'readbackBuffer', 'uniformBuffer']) {
      try { this[value]?.destroy?.(); } catch {}
      this[value] = null;
    }
  }

  destroy() { this._releaseBuffers(); this.destroyed = true; }
}
