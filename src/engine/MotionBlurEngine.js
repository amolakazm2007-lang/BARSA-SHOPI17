const DEFAULT_GAUSSIAN = Object.freeze({ stdDev: 1, mean: 0, bound: [-2, 2] });
const DEFAULT_MEMORY_BUDGET = 128 * 1024 * 1024;

/**
 * Streaming temporal motion blur inspired by f0e/blur's frame-weighting model.
 *
 * Frames are kept only for the active shutter window.  The engine never builds
 * or stores a complete high-FPS intermediate video: input frame -> rolling
 * window -> weighted accumulation -> final-rate frame -> release.
 */
export class MotionBlurEngine {
  constructor({ memoryBudgetBytes = DEFAULT_MEMORY_BUDGET, stripeRows = 96 } = {}) {
    this.memoryBudgetBytes = memoryBudgetBytes;
    this.stripeRows = stripeRows;
    this.reset();
  }

  configure(options = {}) {
    this.destroy();
    const inputFps = positive(options.inputFps, 'Blur input FPS');
    const outputFps = positive(options.outputFps, 'Blur output FPS');
    const amount = clamp(Number(options.amount ?? 1), 0, 4);
    const requestedWindow = calculateBlurSampleCount(inputFps, outputFps, amount);
    const width = integer(options.width, 'Blur width');
    const height = integer(options.height, 'Blur height');
    const bytesPerFrame = width * height * 4;
    // Keep a safety reserve for the decoder, AI tensors, output canvas and encoder.
    // This matters on Android where a 4K RGBA frame is ~32 MiB before model tensors.
    const requestedBudget = Number(options.memoryBudgetBytes) || this.memoryBudgetBytes;
    const safeBudget = Math.max(bytesPerFrame, Math.min(requestedBudget, 128 * 1024 * 1024));
    const memoryWindow = Math.max(1, Math.floor(safeBudget / Math.max(1, bytesPerFrame)));
    const maxSamples = Math.max(1, Math.min(Number(options.maxSamples) || 24, memoryWindow));

    this.settings = {
      enabled: options.enabled !== false && amount > 0,
      width,
      height,
      inputFps,
      outputFps,
      amount,
      gamma: clamp(Number(options.gamma ?? 1), 0.25, 4),
      weighting: normalizeWeightingName(options.weighting || 'gaussian_sym'),
      customWeights: options.customWeights || '',
      gaussian: normalizeGaussian(options.gaussian),
      deduplicate: Boolean(options.deduplicate),
      deduplicateRange: Math.max(1, Math.min(12, Math.round(Number(options.deduplicateRange) || 2))),
      deduplicateThreshold: clamp(Number(options.deduplicateThreshold ?? 0.006), 0.0001, 0.2),
      deduplicateMethod: ['skip', 'nearest'].includes(options.deduplicateMethod) ? options.deduplicateMethod : 'skip',
      sceneCutThreshold: clamp(Number(options.sceneCutThreshold ?? 0.24), 0.08, 0.65),
      requestedWindow,
      windowSamples: Math.min(requestedWindow, maxSamples),
      maxSamples,
    };
    this.inputDurationUs = 1_000_000 / inputFps;
    this.outputDurationUs = 1_000_000 / outputFps;
    this.windowDurationUs = Math.max(this.inputDurationUs, this.settings.windowSamples * this.inputDurationUs);
    this.outputCanvas = makeCanvas(width, height);
    this.outputContext = this.outputCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    this.sampleCanvas = makeCanvas(32, 18);
    this.sampleContext = this.sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.stripeCanvas = makeCanvas(width, Math.min(height, this.stripeRows));
    this.stripeContext = this.stripeCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.stats.limitedWindow = requestedWindow > this.settings.windowSamples;
    this.stats.requestedWindow = requestedWindow;
    this.stats.activeWindow = this.settings.windowSamples;
    if (options.gpuDevice && typeof GPUTextureUsage !== 'undefined') {
      try {
        this.gpuCanvas = makeCanvas(width, height);
        this.gpu = new WebGPUFrameAccumulator(options.gpuDevice, this.gpuCanvas, width, height);
        this.stats.backend = 'webgpu';
      } catch {
        this.gpu = null;
        this.stats.backend = 'cpu-striped';
      }
    }
    return this.diagnostics();
  }

  /** Caller retains ownership of frame. Returned VideoFrames belong to caller. */
  async push(frame, { timestamp = frame.timestamp, duration = frame.duration, sceneCut = false, signal = null } = {}) {
    abortIfNeeded(signal);
    if (!this.settings?.enabled) {
      return [frame.clone()];
    }
    const outputs = [];
    const safeTimestamp = Number.isFinite(timestamp) ? Number(timestamp) : (this.lastInputEndUs || 0);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? Number(duration) : this.inputDurationUs;

    const signature = this._signature(frame);
    const automaticSceneCut = this.buffer.length
      && frameDifference(signature, this.buffer[this.buffer.length - 1].signature) >= this.settings.sceneCutThreshold;
    if ((sceneCut || automaticSceneCut) && this.buffer.length) {
      outputs.push(...await this._drainUntil(safeTimestamp, true, signal));
      this._releaseBuffer();
      this.nextOutputTimestampUs = safeTimestamp;
      this.stats.sceneResets++;
    }

    const owned = frame.clone();
    const duplicate = this.settings.deduplicate && this._isDuplicate(signature);
    this.buffer.push({ frame: owned, timestamp: safeTimestamp, duration: safeDuration, signature, duplicate });
    this.lastInputEndUs = Math.max(this.lastInputEndUs || 0, safeTimestamp + safeDuration);
    if (duplicate) this.stats.duplicatesDetected++;
    if (this.nextOutputTimestampUs == null) this.nextOutputTimestampUs = safeTimestamp;

    outputs.push(...await this._drainUntil(safeTimestamp + safeDuration, false, signal));
    return outputs;
  }

  async flush({ signal = null } = {}) {
    if (!this.settings?.enabled) return [];
    const outputs = await this._drainUntil(this.lastInputEndUs || 0, true, signal);
    this._releaseBuffer();
    return outputs;
  }

  async _drainUntil(availableUntilUs, flush, signal) {
    const output = [];
    while (this.nextOutputTimestampUs != null) {
      abortIfNeeded(signal);
      const intervalEnd = this.nextOutputTimestampUs + this.outputDurationUs;
      if (!flush && availableUntilUs < intervalEnd - 0.5) break;
      if (flush && this.nextOutputTimestampUs >= availableUntilUs - 0.5) break;
      const candidates = this._selectCandidates(intervalEnd);
      if (!candidates.length) break;
      output.push(await this._blend(candidates, this.nextOutputTimestampUs, signal));
      this.stats.outputFrames++;
      this.nextOutputTimestampUs += this.outputDurationUs;
      this._releaseExpired(this.nextOutputTimestampUs + this.outputDurationUs - this.windowDurationUs - this.inputDurationUs);
    }
    return output;
  }

  _selectCandidates(intervalEndUs) {
    const start = intervalEndUs - this.windowDurationUs;
    let candidates = this.buffer.filter((entry) => entry.timestamp < intervalEndUs + 0.5 && entry.timestamp + entry.duration > start - 0.5);
    if (candidates.length > this.settings.windowSamples) candidates = candidates.slice(-this.settings.windowSamples);
    if (this.settings.deduplicate && candidates.some((entry) => entry.duplicate)) {
      const unique = candidates.filter((entry) => !entry.duplicate);
      if (unique.length) {
        this.stats.duplicatesSkipped += candidates.length - unique.length;
        candidates = unique;
      } else if (this.settings.deduplicateMethod === 'nearest') {
        candidates = [candidates[candidates.length - 1]];
      }
    }
    return candidates;
  }

  async _blend(candidates, timestamp, signal) {
    const weights = createBlurWeights(candidates.length, {
      method: this.settings.weighting,
      customWeights: this.settings.customWeights,
      ...this.settings.gaussian,
    });
    if (candidates.length === 1) {
      return new VideoFrame(candidates[0].frame, {
        timestamp: Math.max(0, Math.round(timestamp)),
        duration: Math.round(this.outputDurationUs),
      });
    }

    if (this.gpu) {
      try {
        await this.gpu.accumulate(candidates.map((item) => item.frame), weights, this.settings.gamma, signal);
        this.outputContext.globalCompositeOperation = 'copy';
        this.outputContext.drawImage(this.gpuCanvas, 0, 0);
      } catch {
        this.gpu.destroy();
        this.gpu = null;
        this.stats.backend = 'cpu-striped';
        this.stats.gpuFallbacks++;
        await this._blendCPU(candidates, weights, signal);
      }
    } else {
      await this._blendCPU(candidates, weights, signal);
    }
    return new VideoFrame(this.outputCanvas, {
      timestamp: Math.max(0, Math.round(timestamp)),
      duration: Math.round(this.outputDurationUs),
    });
  }

  async _blendCPU(candidates, weights, signal) {
    const { width, height, gamma } = this.settings;
    const inverseGamma = 1 / gamma;
    for (let y = 0; y < height; y += this.stripeRows) {
      abortIfNeeded(signal);
      const rows = Math.min(this.stripeRows, height - y);
      if (this.stripeCanvas.height !== rows) this.stripeCanvas.height = rows;
      const accumulation = new Float32Array(width * rows * 3);
      for (let frameIndex = 0; frameIndex < candidates.length; frameIndex++) {
        const context = this.stripeContext;
        context.globalCompositeOperation = 'copy';
        context.globalAlpha = 1;
        context.drawImage(candidates[frameIndex].frame, 0, y, width, rows, 0, 0, width, rows);
        const pixels = context.getImageData(0, 0, width, rows).data;
        const weight = weights[frameIndex];
        for (let pixel = 0, outputIndex = 0; pixel < pixels.length; pixel += 4, outputIndex += 3) {
          accumulation[outputIndex] += Math.pow(pixels[pixel] / 255, gamma) * weight;
          accumulation[outputIndex + 1] += Math.pow(pixels[pixel + 1] / 255, gamma) * weight;
          accumulation[outputIndex + 2] += Math.pow(pixels[pixel + 2] / 255, gamma) * weight;
        }
      }
      const image = this.outputContext.createImageData(width, rows);
      for (let pixel = 0, inputIndex = 0; pixel < image.data.length; pixel += 4, inputIndex += 3) {
        image.data[pixel] = byte(Math.pow(clamp01(accumulation[inputIndex]), inverseGamma) * 255);
        image.data[pixel + 1] = byte(Math.pow(clamp01(accumulation[inputIndex + 1]), inverseGamma) * 255);
        image.data[pixel + 2] = byte(Math.pow(clamp01(accumulation[inputIndex + 2]), inverseGamma) * 255);
        image.data[pixel + 3] = 255;
      }
      this.outputContext.putImageData(image, 0, y);
      await Promise.resolve();
    }
  }

  _signature(frame) {
    this.sampleContext.globalCompositeOperation = 'copy';
    this.sampleContext.drawImage(frame, 0, 0, this.sampleCanvas.width, this.sampleCanvas.height);
    const pixels = this.sampleContext.getImageData(0, 0, this.sampleCanvas.width, this.sampleCanvas.height).data;
    const signature = new Uint8Array(pixels.length / 4);
    for (let index = 0, out = 0; index < pixels.length; index += 4, out++) {
      signature[out] = Math.round(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
    }
    return signature;
  }

  _isDuplicate(signature) {
    const recent = this.buffer.slice(-this.settings.deduplicateRange);
    return recent.some((entry) => frameDifference(signature, entry.signature) <= this.settings.deduplicateThreshold);
  }

  _releaseExpired(cutoffUs) {
    while (this.buffer.length > 1 && this.buffer[0].timestamp + this.buffer[0].duration < cutoffUs) {
      this.buffer.shift().frame.close();
    }
  }

  _releaseBuffer() {
    this.buffer.splice(0).forEach(({ frame }) => frame.close());
  }

  diagnostics() {
    return { ...this.stats, ...(this.settings || {}) };
  }

  reset() {
    this.settings = null;
    this.buffer = [];
    this.nextOutputTimestampUs = null;
    this.lastInputEndUs = 0;
    this.outputCanvas = null;
    this.outputContext = null;
    this.sampleCanvas = null;
    this.sampleContext = null;
    this.stripeCanvas = null;
    this.stripeContext = null;
    this.gpuCanvas = null;
    this.gpu = null;
    this.stats = {
      backend: 'cpu-striped',
      outputFrames: 0,
      duplicatesDetected: 0,
      duplicatesSkipped: 0,
      sceneResets: 0,
      gpuFallbacks: 0,
      limitedWindow: false,
      requestedWindow: 0,
      activeWindow: 0,
    };
  }

  destroy() {
    this._releaseBuffer?.();
    this.gpu?.destroy();
    for (const canvas of [this.outputCanvas, this.sampleCanvas, this.stripeCanvas, this.gpuCanvas]) {
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
    this.reset();
  }
}

/** Mirrors blur's frame-gap × blur-amount shutter sizing. */
export function calculateBlurSampleCount(inputFps, outputFps, amount) {
  if (!(inputFps > 0) || !(outputFps > 0) || !(amount > 0)) return 0;
  return Math.max(1, Math.round(inputFps / outputFps * amount));
}

export function createBlurWeights(frameCount, options = {}) {
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new RangeError('Blur frame count must be a positive integer');
  const method = normalizeWeightingName(options.method || 'equal');
  let raw;
  if (method === 'equal') raw = new Array(frameCount).fill(1);
  else if (method === 'ascending') raw = Array.from({ length: frameCount }, (_, index) => index + 1);
  else if (method === 'descending') raw = Array.from({ length: frameCount }, (_, index) => frameCount - index);
  else if (method === 'pyramid') {
    const half = (frameCount - 1) / 2;
    raw = Array.from({ length: frameCount }, (_, index) => half - Math.abs(index - half) + 1);
  } else if (method === 'vegas') {
    raw = frameCount % 2 ? new Array(frameCount).fill(1) : Array.from({ length: frameCount }, (_, index) => index === 0 || index === frameCount - 1 ? 1 : 2);
  } else if (method === 'custom') {
    const source = parseCustomWeights(options.customWeights);
    raw = stretchWeights(source, frameCount);
  } else {
    const stdDev = Math.max(0.001, Number(options.stdDev ?? DEFAULT_GAUSSIAN.stdDev));
    const mean = Number(options.mean ?? DEFAULT_GAUSSIAN.mean);
    const bound = normalizeBound(options.bound);
    const maximum = Math.max(Math.abs(bound[0]), Math.abs(bound[1]));
    const start = method === 'gaussian_sym' ? -maximum : bound[0];
    const end = method === 'gaussian_sym' ? maximum : bound[1];
    const denominator = 2 * stdDev * stdDev;
    raw = Array.from({ length: frameCount }, (_, index) => {
      const x = frameCount === 1 ? start : start + (end - start) * index / (frameCount - 1);
      return Math.exp(-((x - mean) ** 2) / denominator);
    });
    if (method === 'gaussian_reverse') raw.reverse();
  }
  return normalizeWeights(raw);
}

export function frameDifference(first, second) {
  if (!first?.length || first.length !== second?.length) return 1;
  let total = 0;
  for (let index = 0; index < first.length; index++) total += Math.abs(first[index] - second[index]);
  return total / (first.length * 255);
}

class WebGPUFrameAccumulator {
  constructor(device, canvas, width, height) {
    this.device = device;
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = canvas.getContext('webgpu');
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
    this.accumulation = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const vertex = device.createShaderModule({ code: FULLSCREEN_VERTEX });
    const accumulate = device.createShaderModule({ code: ACCUMULATE_FRAGMENT });
    const finish = device.createShaderModule({ code: FINISH_FRAGMENT });
    this.accumulatePipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: vertex, entryPoint: 'main' },
      fragment: { module: accumulate, entryPoint: 'main', targets: [{
        format: 'rgba16float',
        blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
      }] }, primitive: { topology: 'triangle-list' },
    });
    this.finishPipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: vertex, entryPoint: 'main' },
      fragment: { module: finish, entryPoint: 'main', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' },
    });
    this.accumulateBindGroup = device.createBindGroup({ layout: this.accumulatePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.source.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.params } },
    ] });
    this.finishBindGroup = device.createBindGroup({ layout: this.finishPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.accumulation.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.params } },
    ] });
  }

  async accumulate(frames, weights, gamma, signal) {
    for (let index = 0; index < frames.length; index++) {
      abortIfNeeded(signal);
      this.device.queue.copyExternalImageToTexture({ source: frames[index] }, { texture: this.source }, [this.width, this.height]);
      this.device.queue.writeBuffer(this.params, 0, new Float32Array([weights[index], gamma, 1 / gamma, 0]));
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: this.accumulation.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: index === 0 ? 'clear' : 'load', storeOp: 'store',
      }] });
      pass.setPipeline(this.accumulatePipeline);
      pass.setBindGroup(0, this.accumulateBindGroup);
      pass.draw(3);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([1, gamma, 1 / gamma, 0]));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
    }] });
    pass.setPipeline(this.finishPipeline);
    pass.setBindGroup(0, this.finishBindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }

  destroy() {
    this.source?.destroy();
    this.accumulation?.destroy();
    this.params?.destroy();
    this.context?.unconfigure?.();
  }
}

const FULLSCREEN_VERTEX = `
struct Out { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn main(@builtin(vertex_index) index: u32) -> Out {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1,-1), vec2<f32>(3,-1), vec2<f32>(-1,3));
  var out: Out; out.position = vec4<f32>(p[index], 0, 1); out.uv = p[index] * vec2<f32>(.5,-.5) + vec2<f32>(.5,.5); return out;
}`;
const ACCUMULATE_FRAGMENT = `
struct Params { weight: f32, gamma: f32, inverseGamma: f32, padding: f32 };
@group(0) @binding(0) var image: texture_2d<f32>; @group(0) @binding(1) var samp: sampler; @group(0) @binding(2) var<uniform> p: Params;
@fragment fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { let c = textureSample(image, samp, uv).rgb; return vec4<f32>(pow(max(c, vec3<f32>(0)), vec3<f32>(p.gamma)) * p.weight, p.weight); }`;
const FINISH_FRAGMENT = `
struct Params { weight: f32, gamma: f32, inverseGamma: f32, padding: f32 };
@group(0) @binding(0) var image: texture_2d<f32>; @group(0) @binding(1) var samp: sampler; @group(0) @binding(2) var<uniform> p: Params;
@fragment fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { let c = textureSample(image, samp, uv).rgb; return vec4<f32>(pow(clamp(c, vec3<f32>(0), vec3<f32>(1)), vec3<f32>(p.inverseGamma)), 1); }`;

function normalizeWeights(values) {
  const finite = values.map((value) => Number.isFinite(value) ? value : 0);
  const minimum = Math.min(...finite);
  const shifted = minimum < 0 ? finite.map((value) => value - minimum + 1) : finite;
  const total = shifted.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) throw new Error('Blur weights must contain a positive value');
  return shifted.map((value) => Math.max(0, value) / total);
}

function parseCustomWeights(value) {
  const values = String(value).split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
  if (!values.length) throw new Error('Custom blur weights must be comma-separated numbers');
  return values;
}

function stretchWeights(values, count) {
  if (values.length === count) return values;
  if (count === 1) return [values[0]];
  return Array.from({ length: count }, (_, index) => {
    const position = index * (values.length - 1) / (count - 1);
    const left = Math.floor(position), right = Math.min(values.length - 1, left + 1), mix = position - left;
    return values[left] + (values[right] - values[left]) * mix;
  });
}

function normalizeWeightingName(value) {
  const normalized = String(value).toLowerCase().replaceAll('-', '_');
  const supported = ['equal', 'gaussian_sym', 'vegas', 'pyramid', 'gaussian', 'ascending', 'descending', 'gaussian_reverse', 'custom'];
  if (!supported.includes(normalized)) throw new RangeError(`Unsupported blur weighting: ${value}`);
  return normalized;
}

function normalizeGaussian(value = {}) {
  return {
    stdDev: Math.max(0.001, Number(value.stdDev ?? DEFAULT_GAUSSIAN.stdDev)),
    mean: Number(value.mean ?? DEFAULT_GAUSSIAN.mean),
    bound: normalizeBound(value.bound),
  };
}

function normalizeBound(value) {
  const bound = Array.isArray(value) ? value.map(Number) : DEFAULT_GAUSSIAN.bound;
  if (bound.length !== 2 || !bound.every(Number.isFinite) || bound[0] === bound[1]) throw new Error('Gaussian bound must contain two distinct numbers');
  return bound;
}

function positive(value, label) { const number = Number(value); if (!(number > 0)) throw new RangeError(`${label} must be positive`); return number; }
function integer(value, label) { const number = Math.round(Number(value)); if (!(number > 0)) throw new RangeError(`${label} must be a positive integer`); return number; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function byte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function abortIfNeeded(signal) { if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError'); }
function makeCanvas(width, height) { if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
