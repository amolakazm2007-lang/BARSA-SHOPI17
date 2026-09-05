import { VERTEX_SHADER, EFFECTS_FRAGMENT_SHADER } from '../effects/shaders.wgsl.js';

const PARAM_FLOATS = 40;
// All values are scalar f32 fields. 160 bytes is a 16-byte multiple, which
// satisfies the conservative uniform-buffer struct alignment requirement.
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
    this.onFatalLoss = null; // set by caller: called immediately and once when the device is permanently lost
    this.performanceManager = null;
  }

  async init(canvas, { performanceManager = null } = {}) {
    if (!('gpu' in navigator)) throw new Error('WebGPU not available on this browser');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter available');
    this.device = await adapter.requestDevice();
    this.adapter = adapter;
    this.performanceManager = performanceManager;
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });

    const vsModule = this.device.createShaderModule({ code: VERTEX_SHADER });
    const fsModule = this.device.createShaderModule({ code: EFFECTS_FRAGMENT_SHADER });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: vsModule, entryPoint: 'main' },
      fragment: { module: fsModule, entryPoint: 'main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.paramBuffer = this.device.createBuffer({
      size: PARAM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Reset per-init state so stale references from a previous run (this
    // instance may be reused across multiple videos in one session) don't
    // survive into the new device/pipeline.
    this.srcTexture = null;
    this.srcTexSize = null;
    this.bindGroup = null;
    this.deviceLost = false;

    // HONESTY NOTE, including a design change made after real testing:
    // device loss with this exact "A valid external Instance reference no
    // longer exists" message is a documented, real occurrence on Android
    // Chrome under GPU/memory pressure (e.g. huggingface/transformers.js
    // #1205, reported on Chrome 133 for Android), not just a software-
    // renderer testing artifact — it was reproduced directly here too.
    // An earlier version of this code attempted automatic multi-try
    // recovery (re-init the device and keep going). Stress-testing that
    // under a deliberately hostile environment (device lost on nearly
    // every frame) surfaced a real race: recovery's async re-init could
    // still be in flight when the frame loop called renderFrame() again,
    // producing inconsistent, sometimes-hanging behavior between runs.
    // For a video tool, a pipeline that unpredictably hangs is worse than
    // one that falls back to a slower but reliable path. So: on loss, fall
    // back to Canvas2D immediately and permanently for the rest of this
    // run, once, deterministically — no retry loop, no race.
    this.device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message, info.reason);
      this.deviceLost = true;
      if (info.reason === 'destroyed') return; // we called destroy() ourselves — not a real loss
      console.error('Falling back to Canvas2D for the rest of this run (no automatic retry — see WebGPUEngine.js comment).');
      this.onFatalLoss?.();
    });
  }

  /**
   * Ensures a persistent GPUTexture + bind group exist at the given size.
   * Reused across frames (only recreated on resize) specifically to avoid
   * the per-frame external-texture churn that crashed under SwiftShader/
   * Vulkan during real testing (reproduced with a minimal isolated test
   * case: the page crashed on the 2nd frame every time with
   * GPUDevice.importExternalTexture()). copyExternalImageToTexture into a
   * persistent regular texture, done in renderFrame() below, is the
   * documented working alternative for that specific crash.
   */
  _ensureSourceTexture(width, height) {
    if (this.srcTexture && this.srcTexSize?.width === width && this.srcTexSize?.height === height) {
      return;
    }
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

  /**
   * Render one frame (VideoFrame, HTMLVideoElement, or ImageBitmap) through
   * the effects pipeline onto the canvas. Caller still owns/closes the frame.
   * Throws if the device has been lost — caller (main.js) catches this and
   * switches permanently to the Canvas2D path for the rest of the run.
   */
  renderFrame(sourceFrame, params = {}, texelSize, { releaseSource = true } = {}) {
    if (this.deviceLost) throw new Error('WebGPU device was lost — caller must fall back to Canvas2D');
    const { device, context, pipeline, paramBuffer } = this;
    const { width, height } = texelSize;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      context.configure({ device, format: this.format, alphaMode: 'opaque' });
    }

    this._ensureSourceTexture(width, height);
    device.queue.copyExternalImageToTexture(
      { source: sourceFrame },
      { texture: this.srcTexture },
      [width, height]
    );

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
    if (releaseSource) {
      this.srcTexture.destroy();
      this.srcTexture = null;
      this.srcTexSize = null;
      this.bindGroup = null;
      this.performanceManager?.setGPUAllocation(PARAM_BUFFER_SIZE);
    }
  }

  destroy() {
    this.srcTexture?.destroy?.();
    this.paramBuffer?.destroy?.();
    this.context?.unconfigure?.();
    this.device?.destroy?.(); // triggers device.lost with reason 'destroyed' — the handler above correctly ignores that case
    this.device = null;
    this.adapter = null;
    this.context = null;
    this.pipeline = null;
    this.sampler = null;
    this.paramBuffer = null;
    this.bindGroup = null;
    this.performanceManager?.setGPUAllocation(0);
  }
}

/**
 * The WebGL2 fallback (WebGL2Engine.js) does NOT share this WGSL shader —
 * WebGL2 uses GLSL ES, a different language entirely. It reimplements the
 * same math (brightness/contrast/saturation/gamma/temperature/sharpen/
 * denoise) as a separate fragment shader. Keep the two numerically in sync
 * by hand when tuning one; there is no automatic cross-compilation here.
 */
