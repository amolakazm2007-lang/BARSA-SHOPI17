// RIFEEngine — real AI frame interpolation via Android Native ONNX / WebGPU / WASM.
import { NativeAiClient } from '../platform/NativeAiClient.js';
import { TypedArrayPool } from './TypedArrayPool.js';
import { createOrtSessionWithFallback } from './OrtSessionLoader.js';
import { WebGpuIoArena } from './WebGpuIoArena.js';
import { withHardTimeout, BarsaError } from './CrashProofRuntime.js';
import { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';
//
// RIFE exports use several input signatures. Two conventions are
// common across RIFE ONNX exports found in the wild:
//   (a) two separate inputs, each [1,3,H,W]  — used by most Python exports
//   (b) one concatenated input [1,6,H,W]     — frame0 and frame1 stacked
//       on the channel axis (seen in the TensorForger/RIFE-safetensors
//       reference implementation found during research)
// _loadSession() inspects the loaded model and selects the correct path.
//
// RIFE ONNX exports differ: the audited 4.9/4.7 files expose a timestep
// input, while compatible user imports may be midpoint-only. The runtime
// inspects the actual signature and feeds timestep/scale only when declared.
// Midpoint recursion remains the safe fallback for exports without timestep.

export const RIFE_MODEL_REGISTRY = {
  'rife-compatible': {
    source: 'local-import',
    sha256: null,
    format: 'onnx',
    label: 'RIFE compatible ONNX',
  },
  'rife-tensorstack': {
    source: 'audited-onnx-mirror',
    sourcePage: 'https://huggingface.co/TensorStack/RIFE',
    license: 'community ONNX export; verify source terms before redistribution',
    sha256: '76e4cef9ab42fa7dd4e8f6e4aba47462051e3faa969e4bca6479784fbab0ac6f',
    expectedSizeBytes: 21_458_882,
    format: 'onnx',
    label: 'RIFE 4.9 ONNX',
    downloadCandidates: [
      'https://huggingface.co/TensorStack/RIFE/resolve/main/model.onnx?download=true',
      'https://huggingface.co/yuvraj108c/rife-onnx/resolve/main/rife49_ensemble_True_scale_1_sim.onnx?download=true',
      'https://huggingface.co/EmmaJohnson311/TensorRT-ONNX-collect/resolve/main/rife-onnx/rife49_ensemble_True_scale_1_sim.onnx?download=true',
    ],
  },
  'rife47-emmajohnson311': {
    source: 'audited-onnx-mirror',
    sourcePage: 'https://huggingface.co/yuvraj108c/rife-onnx',
    license: 'community ONNX export; verify source terms before redistribution',
    sha256: '0a3a52814d07d919b8336c6b66677baaeeec517bdd4ac4f6852d4bf2680ebb5a',
    expectedSizeBytes: 21_458_882,
    format: 'onnx',
    label: 'RIFE 4.7 ONNX',
    downloadCandidates: [
      'https://huggingface.co/yuvraj108c/rife-onnx/resolve/main/rife47_ensemble_True_scale_1_sim.onnx?download=true',
      'https://huggingface.co/EmmaJohnson311/TensorRT-ONNX-collect/resolve/main/rife-onnx/rife47_ensemble_True_scale_1_sim.onnx?download=true',
    ],
  },
};

/** Same fallback-chain mechanism as UpscaleEngine — see its comment for the full rationale. */
export const RIFE_FALLBACK_CHAIN = ['rife-tensorstack', 'rife47-emmajohnson311', 'rife-compatible'];

export class RIFEEngine {
  constructor(modelManager) {
    this.modelManager = modelManager;
    this.session = null;
    this.sessionModelId = null;
    this.ort = null;
    this.signature = null;
    this.preferGpu = true;
    this.nativeAi = new NativeAiClient();
    this.nativePrepared = new Set();
    this.lastExecutionProvider = null;
    this.tensorPool = new TypedArrayPool({ maxPerLength: 3, maxRetainedBytes: 64 * 1024 * 1024 });
    this.gpuIoArena = null;
    this.gpuIoDisabledModels = new Set();
  }

  setExecutionPreference(preferGpu = true) {
    const next = preferGpu !== false;
    if (this.preferGpu !== next) {
      this.preferGpu = next;
      this.session?.release?.();
      this.session = null;
      this.sessionModelId = null;
      this.signature = null;
    }
  }

  async isAvailable(modelId = 'rife-tensorstack') {
    const config = RIFE_MODEL_REGISTRY[modelId];
    if (!config) return { available: false, reason: 'unknown_model' };
    const status = await this.modelManager.getStatus(modelId);
    if (!status.installed || !status.verified) return { available: false, reason: 'not_installed' };
    if (!status.testPassed) return { available: false, reason: 'not_tested' };
    return { available: true };
  }

  async installCatalogModel(modelId, onProgress = null) {
    const config = RIFE_MODEL_REGISTRY[modelId];
    if (!config?.remoteURL && !config?.downloadCandidates?.length) throw new Error('هذا نموذج RIFE عام ويحتاج استيراد ONNX يدوياً');
    await this.modelManager.installFromCandidates(modelId, { ...config, role: 'interpolation' }, onProgress);
    try { await this.runSelfTest(modelId); }
    catch (error) { await this.modelManager.markTestFailed(modelId, error).catch(() => {}); throw error; }
    return this.modelManager.getStatus(modelId);
  }

  async ensureModel(modelId, onProgress, localFile = null) {
    const config = RIFE_MODEL_REGISTRY[modelId];
    if (!config) throw new Error(`Unknown RIFE model: ${modelId}`);
    const status = await this.modelManager.getStatus(modelId);
    if (localFile) {
      await this.modelManager.importModel(modelId, localFile, { ...config, role: 'interpolation' }, onProgress);
      return;
    }
    if (!status.installed || !status.verified) {
      const error = new Error(`Import the licensed ONNX file for ${modelId} before enabling frame interpolation`);
      error.code = 'MODEL_REQUIRED';
      throw error;
    }
  }

  /** Same fallback-chain mechanism as UpscaleEngine.resolveWorkingModel — see its comment. */
  async resolveWorkingModel(onProgress) {
    const errors = [];
    for (const modelId of RIFE_FALLBACK_CHAIN) {
      const config = RIFE_MODEL_REGISTRY[modelId];
      if (!config) { errors.push(`${modelId}: unknown`); continue; }
      try {
        onProgress?.({ stage: 'trying', modelId });
        if (typeof this.modelManager.getStatus === 'function') {
          const status = await this.modelManager.getStatus(modelId);
          if (!status.installed || !status.verified) {
            if ((config.remoteURL || config.downloadCandidates?.length) && typeof this.modelManager.installFromCandidates === 'function') {
              await this.modelManager.installFromCandidates(modelId, { ...config, role: 'interpolation' }, (p) => onProgress?.({ stage: 'downloading', modelId, ...p }));
            } else {
              await this.ensureModel(modelId, (p) => onProgress?.({ stage: 'importing', modelId, ...p }));
            }
          }
        } else {
          // Keeps the engine testable with a minimal injected manager and
          // preserves the original ensureModel fallback contract.
          await this.ensureModel(modelId, (p) => onProgress?.({ stage: 'importing', modelId, ...p }));
        }
        onProgress?.({ stage: 'testing', modelId });
        await this.runSelfTest(modelId);
        return modelId;
      } catch (e) {
        console.warn(`RIFE model candidate "${modelId}" failed, trying next in chain:`, e.message);
        errors.push(`${modelId}: ${e.message}`);
        this.session?.release?.();
        this.session = null;
        this.sessionModelId = null;
      }
    }
    console.error('All RIFE model candidates failed:', errors.join(' | '));
    return null;
  }

  async _invalidateSession(modelId, session = null) {
    const current = this.session;
    if (session && current && current !== session) {
      try { session.release?.(); } catch (error) { console.warn('[BARSA][RIFE][stale-session-release-failed]', { modelId, error }); }
      return;
    }
    try { current?.release?.(); } catch (error) { console.warn('[BARSA][RIFE][session-release-failed]', { modelId, error }); }
    this.session = null;
    this.sessionModelId = null;
    this.signature = null;
  }

  async _loadSession(modelId) {
    if (this.session && this.sessionModelId === modelId) return this.session;
    if (this.session) {
      this.session.release?.();
      this.session = null;
      this.signature = null;
    }
    if (!this.ort) {
      this.ort = await import('onnxruntime-web/webgpu');
      this.ort.env.wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      this.ort.env.wasm.wasmPaths = new URL('./vendor/ort-wasm/', document.baseURI).href;
    }
    const loaded = await withHardTimeout(() => createOrtSessionWithFallback({
      modelManager: this.modelManager, ort: this.ort, modelId,
      webgpuOptions: this.preferGpu ? [{ graphCapture: false, options: { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' } }] : [],
      wasmOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
    }), { timeoutMs: 30000, label: `RIFE session load ${modelId}`, onTimeout: () => { this.session?.release?.(); this.session=null; this.sessionModelId=null; this.signature=null; } });
    this.session = loaded.session;
    this.executionProvider = loaded.executionProvider;
    this.modelSourceKind = loaded.sourceKind;
    this.sessionModelId = modelId;
    this.signature = inspectRifeSignature(this.session);
    if (loaded.executionProvider === 'webgpu' && !this.gpuIoDisabledModels.has(modelId)) {
      this.gpuIoArena ||= new WebGpuIoArena(this.ort, { maxSlots: 3 });
    }
    return this.session;
  }

  async runSelfTest(modelId = 'rife-tensorstack') {
    const session = await withHardTimeout(() => this._loadSession(modelId), { timeoutMs: 30000, label: `RIFE self-test load ${modelId}` });
    const signature = this.signature || inspectRifeSignature(session);
    const w = signature.width || 64, h = signature.height || 64;
    const frame0 = new Float32Array(3 * h * w).fill(0.3);
    const frame1 = new Float32Array(3 * h * w).fill(0.7);
    const concatLease = signature.convention === 'concat' ? this.tensorPool.acquire(Float32Array, 6 * w * h) : null;
    const feeds = buildRifeFeeds(session, this.ort, signature, frame0, frame1, w, h, 0.5, concatLease);
    let outputs;
    try { outputs = await withHardTimeout(() => session.run(feeds), { timeoutMs: 30000, label: `RIFE self-test inference ${modelId}` }); }
    finally { if (concatLease) this.tensorPool.release(concatLease); }
    const out = selectRifeOutput(session, outputs, 3 * h * w);
    if (!out) {
      const sizes = Object.values(outputs).map((tensor) => tensor?.data?.length || 0).join(', ');
      throw new Error(`RIFE self-test output size mismatch: got [${sizes}], expected ${3 * h * w}. Do not mark as ready.`);
    }
    let gpuIoBindingVerified = false;
    if (this.executionProvider === 'webgpu' && session.outputNames?.length === 1 && this.gpuIoArena?.available && !this.gpuIoDisabledModels.has(modelId)) {
      const concatGpu = signature.convention === 'concat' ? this.tensorPool.acquire(Float32Array, 6 * w * h) : null;
      try {
        const gpuFeeds = [];
        if (signature.convention === 'concat') {
          concatGpu.set(frame0, 0); concatGpu.set(frame1, 3 * w * h);
          gpuFeeds.push({ name: signature.frameInputs[0], data: concatGpu, dims: [1, 6, h, w] });
        } else {
          gpuFeeds.push({ name: signature.frameInputs[0], data: frame0, dims: [1, 3, h, w] });
          gpuFeeds.push({ name: signature.frameInputs[1], data: frame1, dims: [1, 3, h, w] });
        }
        const cpuFeeds = {};
        if (signature.timestepInput) cpuFeeds[signature.timestepInput] = makeScalarFeed(session, this.ort, signature.timestepInput, 0.5);
        if (signature.scaleInput) cpuFeeds[signature.scaleInput] = makeScalarFeed(session, this.ort, signature.scaleInput, 1);
        const gpuBound = await this.gpuIoArena.runMulti({
          session, gpuFeeds, cpuFeeds, outputName: out.name, outputDims: [1, 3, h, w],
        });
        assertNearEquivalentRife(out.tensor.data, gpuBound.data, 1e-4);
        gpuIoBindingVerified = true;
      } catch (error) {
        this.gpuIoDisabledModels.add(modelId);
        console.warn(`WebGPU RIFE IO binding self-test failed for ${modelId}; standard inference remains enabled:`, error?.message || error);
      } finally { if (concatGpu) this.tensorPool.release(concatGpu); }
    }
    await this.modelManager.markTestPassed(modelId, {
      executionProvider: this.executionProvider,
      signature: { ...signature, width: w, height: h, output: out.name, gpuIoBindingVerified },
    });
    return true;
  }

  /**
   * Generates the midpoint frame between frame0 and frame1. This export is
   * Uses the requested timestep when the loaded model declares that input;
   * midpoint-only exports safely ignore it because buildRifeFeeds only adds
   * auxiliary tensors discovered from the model's real signature.
   */
  async interpolateMidpoint(modelId, frame0Chw, frame1Chw, width, height, timestep = 0.5) {
    const config = RIFE_MODEL_REGISTRY[modelId] || {};
    // Native Android RIFE is intentionally gated to <=1080p per call. A pair
    // of raw 4K float tensors exceeds 190 MB before ORT activations, which is
    // the opposite of stable mobile rendering. 4K keeps the WebGPU/WASM path
    // unless a future zero-copy native decoder surface is available.
    if (this.nativeAi.available && width * height <= 1920 * 1080 && !this.nativeAi.disabledModels.has(modelId)) {
      try {
        if (!this.nativePrepared.has(modelId)) {
          const status = await this.modelManager.getStatus(modelId).catch(() => ({}));
          const ready = await this.nativeAi.ensureModelLazy(modelId, {
            bytes: status?.size || config.expectedSizeBytes || 0, sha256: status?.sha256 || config.sha256 || '',
            load: () => (this.modelManager.openModelFile ? this.modelManager.openModelFile(modelId) : this.modelManager.loadModelBuffer(modelId)),
          });
          if (!ready) throw new Error('Android native RIFE model registration failed');
          this.nativePrepared.add(modelId);
        }
        const native = await withHardTimeout(() => this.nativeAi.inferRife(modelId, frame0Chw, frame1Chw, { width, height, timestep }), { timeoutMs: 30000, label: `Native RIFE inference ${modelId}` });
        this.executionProvider = `android-native:${native.provider}`;
        this.lastExecutionProvider = this.executionProvider;
        return { data:native.data, dims:[1,3,native.height,native.width] };
      } catch (error) {
        console.warn(`Native RIFE failed for ${modelId}; falling back to WebGPU/WASM:`, error?.message || error);
        this.nativeAi.disableModel(modelId);
      }
    }
    let session = await this._loadSession(modelId);
    let signature = this.signature || inspectRifeSignature(session);
    assertDynamicOrMatchingSize(signature, width, height);
    const concatLease = signature.convention === 'concat' ? this.tensorPool.acquire(Float32Array, 6 * width * height) : null;
    try {
      const outputName = session.outputNames?.length === 1 ? session.outputNames[0] : null;
      if (this.executionProvider === 'webgpu' && outputName && this.gpuIoArena?.available && !this.gpuIoDisabledModels.has(modelId)) {
        try {
          const gpuFeeds = [];
          if (signature.convention === 'concat') {
            concatLease.set(frame0Chw, 0); concatLease.set(frame1Chw, 3 * width * height);
            gpuFeeds.push({ name: signature.frameInputs[0], data: concatLease, dims: [1, 6, height, width] });
          } else {
            gpuFeeds.push({ name: signature.frameInputs[0], data: frame0Chw, dims: [1, 3, height, width] });
            gpuFeeds.push({ name: signature.frameInputs[1], data: frame1Chw, dims: [1, 3, height, width] });
          }
          const cpuFeeds = {};
          if (signature.timestepInput) cpuFeeds[signature.timestepInput] = makeScalarFeed(session, this.ort, signature.timestepInput, timestep);
          if (signature.scaleInput) cpuFeeds[signature.scaleInput] = makeScalarFeed(session, this.ort, signature.scaleInput, 1);
          const gpuOutput = await withHardTimeout(() => this.gpuIoArena.runMulti({
            session, gpuFeeds, cpuFeeds, outputName, outputDims: [1, 3, height, width],
          }), { timeoutMs: 30000, label: `RIFE WebGPU IO inference ${modelId}` });
          if (gpuOutput.data.length !== 3 * width * height) throw new Error('RIFE GPU output length mismatch');
          this.lastExecutionProvider = 'webgpu:iobinding';
          return gpuOutput;
        } catch (error) {
          console.warn(`WebGPU RIFE IO binding failed for ${modelId}; using standard ORT path:`, error?.message || error);
          this.gpuIoDisabledModels.add(modelId);
        }
      }

      const outputs = await runOrtInferenceWithRecovery({
        modelId,
        getSession: (id) => this._loadSession(id),
        invalidateSession: (id, stuck) => this._invalidateSession(id, stuck),
        run: (activeSession) => {
          session = activeSession;
          signature = this.signature || inspectRifeSignature(activeSession);
          assertDynamicOrMatchingSize(signature, width, height);
          const feeds = buildRifeFeeds(activeSession, this.ort, signature, frame0Chw, frame1Chw, width, height, timestep, concatLease);
          return activeSession.run(feeds);
        },
        timeoutMs: 30000,
        label: `RIFE ORT inference ${modelId}`,
      });
      const output = selectRifeOutput(session, outputs, 3 * width * height);
      if (!output) throw new Error(`RIFE returned no RGB frame matching ${width}x${height}`);
      this.lastExecutionProvider = this.executionProvider;
      return output.tensor;
    } finally { if (concatLease) this.tensorPool.release(concatLease); }
  }

  /**
   * ×4 interpolation via recursive midpoint splitting. This remains
   * compatible with midpoint-only imports and with audited timestep models,
   * while keeping native/GPU calls sequential to limit peak mobile memory.
   */
  async interpolateX4(modelId, frame0Chw, frame1Chw, width, height) {
    const midData = await this.interpolateMidpoint(modelId, frame0Chw, frame1Chw, width, height);
    const mid = midData.data;
    // Run sequentially to avoid two simultaneous ONNX activation graphs on
    // mobile GPUs, which can otherwise double peak VRAM.
    const q1Data = await this.interpolateMidpoint(modelId, frame0Chw, mid, width, height);
    const q3Data = await this.interpolateMidpoint(modelId, mid, frame1Chw, width, height);
    return [q1Data.data, mid, q3Data.data];
  }

  async interpolateAt(modelId, frame0Chw, frame1Chw, width, height, t, depth = 3) {
    if (t <= 0.001) return frame0Chw;
    if (t >= 0.999) return frame1Chw;
    await this._loadSession(modelId);
    if (this.signature?.timestepInput) {
      return (await this.interpolateMidpoint(modelId, frame0Chw, frame1Chw, width, height, t)).data;
    }
    const midpointTensor = await this.interpolateMidpoint(modelId, frame0Chw, frame1Chw, width, height);
    const midpoint = midpointTensor.data;
    if (depth <= 0 || Math.abs(t - 0.5) < 0.04) return midpoint;
    if (t < 0.5) return this.interpolateAt(modelId, frame0Chw, midpoint, width, height, t * 2, depth - 1);
    return this.interpolateAt(modelId, midpoint, frame1Chw, width, height, (t - 0.5) * 2, depth - 1);
  }

  async warmup(modelId) {
    await withHardTimeout(() => this._loadSession(modelId), { timeoutMs: 30000, label: `RIFE warmup ${modelId}` });
    return { executionProvider: this.executionProvider, signature: this.signature };
  }

  /** Plan which interpolation calls are needed for a given conversion. */
  static planForConversion(fromFps, toFps) {
    const ratio = toFps / fromFps;
    if (Math.abs(ratio - 2) < 0.01) return { factor: 2, method: 'interpolateMidpoint' };
    if (Math.abs(ratio - 4) < 0.01) return { factor: 4, method: 'interpolateX4' };
    return { factor: null, method: null, note: 'Non-integer or unsupported ratio — fall back to Basic FPS boost (no AI) and label it as such.' };
  }

  destroy() {
    this.session?.release?.();
    this.session = null;
    this.sessionModelId = null;
    this.signature = null;
    for (const modelId of this.nativePrepared) this.nativeAi.releaseSession?.(modelId).catch?.(() => {});
    this.nativePrepared.clear();
    this.lastExecutionProvider = null;
    this.gpuIoArena?.clear?.();
    this.gpuIoArena = null;
    this.gpuIoDisabledModels.clear();
    this.tensorPool.clear();
  }
}

function assertNearEquivalentRife(reference, candidate, tolerance = 1e-4) {
  if (!reference || !candidate || reference.length !== candidate.length) throw new Error('RIFE GPU IO self-test output length mismatch');
  const stride = Math.max(1, Math.floor(reference.length / 4096));
  for (let i = 0; i < reference.length; i += stride) {
    const a = Number(reference[i]), b = Number(candidate[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tolerance * Math.max(1, Math.abs(a), Math.abs(b))) {
      throw new Error(`RIFE GPU IO self-test numeric mismatch at ${i}: ${a} vs ${b}`);
    }
  }
}

/** Classifies common RIFE ONNX signatures, including timestep and scale inputs. */
export function inspectRifeSignature(session) {
  const inputs = (session.inputNames || []).map((name, index) => ({
    name,
    dimensions: inputDimensions(session, name, index),
  }));
  const imageInputs = inputs.filter((input) => {
    const channels = positiveDimension(input.dimensions[1]);
    return input.dimensions.length >= 4 && (channels === 3 || channels === 6);
  });
  let convention;
  if (imageInputs.some((input) => positiveDimension(input.dimensions[1]) === 6)) convention = 'concat';
  else if (imageInputs.filter((input) => positiveDimension(input.dimensions[1]) === 3).length >= 2) convention = 'dual';
  else if (inputs.length === 1) convention = 'concat';
  else {
    const namedFrames = inputs.filter((input) => /(img|image|frame|input)[_ -]?[01ab]?/i.test(input.name) && input.dimensions.length >= 4);
    if (namedFrames.length >= 2) convention = 'dual';
    else throw new Error('Unsupported RIFE signature: expected two RGB inputs or one six-channel input');
  }
  const frameInputs = convention === 'concat'
    ? [imageInputs.find((input) => positiveDimension(input.dimensions[1]) === 6) || inputs[0]]
    : imageInputs.filter((input) => positiveDimension(input.dimensions[1]) === 3).slice(0, 2);
  const auxiliary = inputs.filter((input) => !frameInputs.some((frame) => frame.name === input.name));
  const timestep = auxiliary.find((input) => /(time|timestep|ratio|t$)/i.test(input.name));
  const scale = auxiliary.find((input) => /scale/i.test(input.name));
  const unsupported = auxiliary.filter((input) => input !== timestep && input !== scale);
  if (unsupported.length) throw new Error(`Unsupported RIFE auxiliary inputs: ${unsupported.map((item) => item.name).join(', ')}`);
  const dimensions = frameInputs[0]?.dimensions || [];
  return {
    convention,
    frameInputs: frameInputs.map((input) => input.name),
    timestepInput: timestep?.name || null,
    scaleInput: scale?.name || null,
    width: positiveDimension(dimensions[3]),
    height: positiveDimension(dimensions[2]),
  };
}

export function buildRifeFeeds(session, ort, signature, frame0, frame1, width, height, timestep = 0.5, concatTarget = null) {
  const feeds = {};
  if (signature.convention === 'concat') {
    const concat = concatTarget || new Float32Array(6 * width * height);
    if (concat.length !== 6 * width * height) throw new RangeError('RIFE concat target has the wrong length');
    concat.set(frame0, 0); concat.set(frame1, 3 * width * height);
    feeds[signature.frameInputs[0]] = new ort.Tensor('float32', concat, [1, 6, height, width]);
  } else {
    feeds[signature.frameInputs[0]] = new ort.Tensor('float32', frame0, [1, 3, height, width]);
    feeds[signature.frameInputs[1]] = new ort.Tensor('float32', frame1, [1, 3, height, width]);
  }
  if (signature.timestepInput) feeds[signature.timestepInput] = makeScalarFeed(session, ort, signature.timestepInput, timestep);
  if (signature.scaleInput) feeds[signature.scaleInput] = makeScalarFeed(session, ort, signature.scaleInput, 1);
  return feeds;
}

function makeScalarFeed(session, ort, name, value) {
  const index = session.inputNames.indexOf(name);
  const dimensions = inputDimensions(session, name, index).map((dimension) => positiveDimension(dimension) || 1);
  const shape = dimensions.length ? dimensions : [];
  const count = Math.max(1, shape.reduce((total, dimension) => total * dimension, 1));
  return new ort.Tensor('float32', new Float32Array(count).fill(value), shape);
}

function selectRifeOutput(session, outputs, expectedLength) {
  for (const name of session.outputNames || Object.keys(outputs)) {
    const tensor = outputs[name];
    if (tensor?.data?.length === expectedLength) return { name, tensor };
  }
  return null;
}

function inputDimensions(session, name, index) {
  const metadata = session.inputMetadata;
  const item = Array.isArray(metadata) ? metadata[index] : metadata?.[name] || metadata?.[index];
  return item?.dimensions || item?.shape || [];
}

function positiveDimension(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assertDynamicOrMatchingSize(signature, width, height) {
  if (signature.width && signature.width !== width) throw new Error(`RIFE model requires width ${signature.width}, received ${width}`);
  if (signature.height && signature.height !== height) throw new Error(`RIFE model requires height ${signature.height}, received ${height}`);
}
