import { VERTEX_SHADER, EFFECTS_FRAGMENT_SHADER } from '../effects/shaders.wgsl.js';
import { GPUDeviceLossGuard } from './GPUDeviceLossGuard.js';
import { BarsaError } from './CrashProofRuntime.js';

const PARAM_FLOATS = 40;
const PARAM_BUFFER_SIZE = PARAM_FLOATS * 4;

export class WebGPUEngine {
  constructor() {
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.sampler = null;
    this.paramBuffer = null;
    this.canvas = null;
    this.format = null;
    this.srcTexture = null;
    this.srcTexSize = null;
    this.bindGroup = null;
    this.deviceLost = false;
    this.onFatalLoss = null;
    this.performanceManager = null;
    this.lossGuard = new GPUDeviceLossGuard();
    this.lossGuard.addEventListener('lost', ({ detail }) => {
      this.deviceLost = true;
      console.error('[BARSA][WebGPU] device lost; graphics policy must fall back to WebGL2/Canvas2D', detail);
      this.onFatalLoss?.(detail);
    });
  }

  async init(canvas, { performanceManager = null } = {}) {
    if (!('gpu' in navigator)) throw new BarsaError('WEBGPU_UNAVAILABLE', 'WebGPU not available on this browser', { recoverable: true });
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new BarsaError('WEBGPU_ADAPTER_UNAVAILABLE', 'No WebGPU adapter available', { recoverable: true });
    this.device = await adapter.requestDevice();
    this.adapter = adapter;
    this.lossGuard.attach(this.device);
    this.performanceManager = performanceManager;
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new BarsaError('WEBGPU_CONTEXT_UNAVAILABLE', 'Unable to create WebGPU canvas context', { recoverable: true });
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.device.pushErrorScope?.('validation');
    this.device.pushErrorScope?.('out-of-memory');
    try {
      const vsModule = this.device.createShaderModule({ code: VERTEX_SHADER });
      const fsModule = this.device.createShaderModule({ code: EFFECTS_FRAGMENT_SHADER });
      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: vsModule, entryPoint: 'main' },
        fragment: { module: fsModule, entryPoint: 'main', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this.paramBuffer = this.device.createBuffer({ size: PARAM_BUFFER_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    } finally {
      await this._drainErrorScopes('init');
    }

    this.srcTexture = null;
    this.srcTexSize = null;
    this.bindGroup = null;
    this.deviceLost = false;
  }

  async _drainErrorScopes(stage) {
    if (!this.device?.popErrorScope) return;
    for (const kind of ['out-of-memory', 'validation']) {
      try {
        const error = await this.device.popErrorScope();
        if (error) {
          const code = kind === 'out-of-memory' ? 'GPU_OUT_OF_MEMORY' : 'GPU_VALIDATION_ERROR';
          const wrapped = new BarsaError(code, `WebGPU ${stage} ${kind} error: ${error.message || error}`, { recoverable: true, cause: error });
          console.error(`[BARSA][WebGPU][${stage}]`, wrapped);
          this.deviceLost = true;
          this.onFatalLoss?.(wrapped);
        }
      } catch (error) {
        console.error(`[BARSA][WebGPU][${stage}][error-scope-failed]`, error);
      }
    }
  }

  _ensureSourceTexture(width, height) {
    this.lossGuard.assertAvailable();
    if (this.srcTexture && this.srcTexSize?.width === width && this.srcTexSize?.height === height) return;
    this.srcTexture?.destroy?.();
    this.srcTexture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.srcTexSize = { width, height };
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.srcTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.paramBuffer } },
      ],
    });
  }

  renderFrame(sourceFrame, params = {}, texelSize, { releaseSource = true } = {}) {
    this.lossGuard.assertAvailable();
    if (this.deviceLost) throw new BarsaError('GPU_DEVICE_LOST', 'WebGPU device was lost', { recoverable: true });
    const { device, context, pipeline, paramBuffer } = this;
    if (!device || !context || !pipeline || !paramBuffer) throw new BarsaError('WEBGPU_NOT_INITIALIZED', 'WebGPU engine is not initialized', { recoverable: true });
    const { width, height } = texelSize;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      context.configure({ device, format: this.format, alphaMode: 'opaque' });
    }

    device.pushErrorScope?.('validation');
    device.pushErrorScope?.('out-of-memory');
    try {
      this._ensureSourceTexture(width, height);
      device.queue.copyExternalImageToTexture({ source: sourceFrame }, { texture: this.srcTexture }, [width, height]);

      const paramData = new Float32Array([
        params.brightness ?? 0,
        params.contrast ?? 1,
        params.saturation ?? 1,
        params.vibrance ?? 0,
        params.gamma ?? 1,
        params.temperature ?? 0,
        params.sharpenAmount ?? 0,
        params.sharpenThreshold ?? 0.02,
        params.highPassAmount ?? 0,
        params.denoiseAmount ?? 0,
        params.detailAmount ?? 0,
        params.portraitSmooth ?? 0,
        params.exposure ?? 0,
        params.highlights ?? 0,
        params.shadows ?? 0,
        params.whites ?? 0,
        params.blacks ?? 0,
        params.dehaze ?? 0,
        params.vignette ?? 0,
        params.grain ?? 0,
        params.deblockAmount ?? 0,
        params.debandAmount ?? 0,
        params.artifactRemoval ?? 0,
        params.fineDetailRecovery ?? 0,
        params.textureRecovery ?? 0,
        params.edgeRecovery ?? 0,
        params.clarity ?? 0,
        params.localContrast ?? 0,
        params.dehalo ?? 0,
        params.antiRinging ?? 0,
        params.tint ?? 0,
        params.lift ?? 0,
        params.gain ?? 1,
        1 / width,
        1 / height,
        params.chromaDenoise ?? 0,
        params.detailFusion ?? 0,
        0, 0, 0,
      ]);
      device.queue.writeBuffer(paramBuffer, 0, paramData);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      this.performanceManager?.setGPUAllocation(width * height * 4 + PARAM_BUFFER_SIZE);
    } catch (error) {
      const wrapped = error instanceof BarsaError ? error : new BarsaError('WEBGPU_FRAME_FAILED', `WebGPU frame failed: ${error?.message || error}`, { recoverable: true, cause: error });
      console.error('[BARSA][WebGPU][frame-failed]', wrapped);
      this.deviceLost = true;
      this.onFatalLoss?.(wrapped);
      throw wrapped;
    } finally {
      void this._drainErrorScopes('frame');
      if (releaseSource) {
        this.srcTexture?.destroy?.();
        this.srcTexture = null;
        this.srcTexSize = null;
        this.bindGroup = null;
        this.performanceManager?.setGPUAllocation(PARAM_BUFFER_SIZE);
      }
    }
  }

  destroy() {
    this.lossGuard.detach();
    this.srcTexture?.destroy?.();
    this.paramBuffer?.destroy?.();
    this.context?.unconfigure?.();
    this.device?.destroy?.();
    this.device = null;
    this.adapter = null;
    this.context = null;
    this.pipeline = null;
    this.sampler = null;
    this.paramBuffer = null;
    this.bindGroup = null;
    this.deviceLost = false;
    this.performanceManager?.setGPUAllocation(0);
  }
}
