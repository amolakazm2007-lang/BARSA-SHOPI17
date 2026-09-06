import { BarsaError, runFallbackChain, withHardTimeout } from './CrashProofRuntime.js';

export const DEFAULT_TIMEOUTS = Object.freeze({
  webgpuInitMs: 8000,
  webgpuFrameMs: 5000,
  webglFrameMs: 5000,
  workerFrameMs: 12000,
  codecFlushMs: 15000,
  ffmpegExecMs: 120000,
  onnxInferenceMs: 30000,
  storageCheckpointMs: 10000,
});

export class CrashProofFallbackPolicy extends EventTarget {
  constructor({ logger = console } = {}) {
    super();
    this.logger = logger;
    this.disabled = new Set();
  }

  disable(name, error) {
    this.disabled.add(name);
    this.logger.error?.(`[BARSA][fallback-disable] ${name}`, error);
    this.dispatchEvent(new CustomEvent('backenddisabled', { detail: { name, error } }));
  }

  isEnabled(name) { return !this.disabled.has(name); }

  async renderGraphics({ webgpu, webgl2, canvas2d, timeouts = DEFAULT_TIMEOUTS }) {
    return runFallbackChain([
      {
        name: 'WebGPU',
        code: 'GPU_DEVICE_LOST',
        run: async () => {
          if (!this.isEnabled('WebGPU')) throw new BarsaError('GPU_DEVICE_LOST', 'WebGPU disabled for this render', { recoverable: true });
          return withHardTimeout(webgpu, { timeoutMs: timeouts.webgpuFrameMs, label: 'WebGPU frame' });
        },
        cleanup: async (error) => this.disable('WebGPU', error),
      },
      {
        name: 'WebGL2',
        code: 'WEBGL_CONTEXT_LOST',
        run: async () => {
          if (!this.isEnabled('WebGL2')) throw new BarsaError('WEBGL_CONTEXT_LOST', 'WebGL2 disabled for this render', { recoverable: true });
          return withHardTimeout(webgl2, { timeoutMs: timeouts.webglFrameMs, label: 'WebGL2 frame' });
        },
        cleanup: async (error) => this.disable('WebGL2', error),
      },
      { name: 'Canvas2D', run: canvas2d },
    ], {
      label: 'graphics',
      onFallback: ({ from, to, error }) => {
        this.logger.warn?.(`[BARSA][fallback] ${from} -> ${to}`, error);
        this.dispatchEvent(new CustomEvent('fallback', { detail: { from, to, error } }));
      },
    });
  }

  async aiOrSafeFallback({ label, inference, fallback, timeoutMs = DEFAULT_TIMEOUTS.onnxInferenceMs }) {
    try {
      return await withHardTimeout(inference, { timeoutMs, label });
    } catch (error) {
      this.logger.error?.(`[BARSA][ai-fallback] ${label}`, error);
      this.dispatchEvent(new CustomEvent('fallback', { detail: { from: label, to: 'safe-fallback', error } }));
      return fallback(error);
    }
  }
}
