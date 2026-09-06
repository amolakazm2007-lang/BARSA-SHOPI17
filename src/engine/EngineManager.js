import { StorageManager } from './StorageManager.js';
import { PerformanceManager } from './PerformanceManager.js';
import { WebCodecsEngine, getSupportedCodecs } from './WebCodecsEngine.js';
import { WebGPUEngine } from './WebGPUEngine.js';
import { WebGL2Engine } from './WebGL2Engine.js';
import { ModelManager } from './ModelManager.js';
import { NihuiModelBridge } from './NihuiModelBridge.js';
import { RIFEEngine } from './RIFEEngine.js';
import { UpscaleEngine } from './UpscaleEngine.js';
import { FaceRestorationEngine } from './FaceRestorationEngine.js';
import { AudioEngine } from './AudioEngine.js';
import { FFmpegEngine } from './FFmpegEngine.js';
import { TileProcessor } from './TileProcessor.js';
import { MediaInputEngine } from './MediaInputEngine.js';
import { DeviceGuard } from './DeviceGuard.js';
import { HardwareProbe } from './HardwareProbe.js';
import { TemporalConsistencyEngine } from './TemporalConsistencyEngine.js';
import { supportsNativeAAC } from './NativeMP4Muxer.js';
import { QualityMetricsEngine } from './QualityMetricsEngine.js';
import { FaceDetectorEngine } from './FaceDetectorEngine.js';
import { QualityEngine } from './QualityEngine.js';
import { ColorEngine } from './ColorEngine.js';
import { MotionBlurEngine } from './MotionBlurEngine.js';
import { FullDeviceTestEngine } from './FullDeviceTestEngine.js';
import { StabilizationEngine } from './StabilizationEngine.js';
import { TemporalReconstructionEngine } from './TemporalReconstructionEngine.js';
import { RenderResilienceEngine } from './RenderResilienceEngine.js';
import { DynamicRenderFabric } from './DynamicRenderFabric.js';
import { BarsaDoctor } from './BarsaDoctor.js';
import { DoctorControlPlane } from './DoctorControlPlane.js';
import { DevicePerformancePassport } from './DevicePerformancePassport.js';
import { MemoryGovernor } from './MemoryGovernor.js';
import { StorageGovernor } from './StorageGovernor.js';
import { RuntimeHealthGuard } from './RuntimeHealthGuard.js';
import { BoundedAsyncQueue } from './BoundedAsyncQueue.js';
import { ResourceScope } from './ResourceScope.js';
import { RuntimeFaultLedger } from './RuntimeFaultLedger.js';
import { RuntimeFaultReporter } from './RuntimeFaultReporter.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const LAZY_CLEANUP_METHODS = new Set(['destroy', 'dispose', 'release', 'releaseAll', 'releaseMemory', 'terminate', 'close']);

export class EngineManager extends EventTarget {
  constructor() {
    super();
    const storage = new StorageManager();
    const models = new ModelManager();
    const rife = createLazyEngineHandle('rife', () => new RIFEEngine(models));
    const upscale = createLazyEngineHandle('upscale', () => new UpscaleEngine(models));
    const faceDetector = createLazyEngineHandle('faceDetector', () => new FaceDetectorEngine(models));
    const face = createLazyEngineHandle('face', () => new FaceRestorationEngine(models, faceDetector));
    this.engines = {
      storage,
      performance: new PerformanceManager(this),
      codecs: new WebCodecsEngine(),
      gpu: new WebGPUEngine(),
      webgl: new WebGL2Engine(),
      models,
      nihui: new NihuiModelBridge(),
      rife,
      upscale,
      faceDetector,
      face,
      audio: new AudioEngine(),
      ffmpeg: new FFmpegEngine(),
      tiles: new TileProcessor(),
      media: new MediaInputEngine(),
      deviceGuard: new DeviceGuard(),
      hardware: new HardwareProbe(),
      temporal: new TemporalConsistencyEngine(),
      qualityMetrics: new QualityMetricsEngine(),
      quality: new QualityEngine(),
      color: new ColorEngine(),
      blur: new MotionBlurEngine(),
      stabilization: new StabilizationEngine(),
      temporalReconstruction: new TemporalReconstructionEngine(),
      resilience: new RenderResilienceEngine(),
      fabric: null,
    };
    this.capabilities = null;
    this.performancePassport = new DevicePerformancePassport();
    this.memoryGovernor = new MemoryGovernor();
    this.storageGovernor = new StorageGovernor({ passport: this.performancePassport });
    this.runtimeGuard = new RuntimeHealthGuard({
      memoryGovernor: this.memoryGovernor,
      performance: this.engines.performance,
      storageGovernor: this.storageGovernor,
    });
    this.doctorControlPlane = new DoctorControlPlane({
      runtimeGuard: this.runtimeGuard,
      performance: this.engines.performance,
      storage: this.engines.storage,
      passport: this.performancePassport,
    });
    this.jobs = new Map();
    this.activeJobId = null;
    this.faultLedger = new RuntimeFaultLedger({ maxEntries: 240, maxGroups: 96 });
    this.faultReporter = new RuntimeFaultReporter({
      ledger: this.faultLedger,
      eventTarget: this,
      source: 'EngineManager',
      getActiveJobId: () => this.activeJobId,
    });
    this.deviceTest = new FullDeviceTestEngine(this);
    this.doctor = new BarsaDoctor(this);
  }

  async initialize() {
    this.capabilities = await this.detect();
    await this.engines.performance.initialize(this.capabilities.webGPUAdapter, this.capabilities.deviceProfile);
    this.performancePassport.identify(this.capabilities);
    this.storageGovernor.seedFromPassport();
    this.engines.fabric = new DynamicRenderFabric({
      performance: this.engines.performance, capabilities: this.capabilities,
      passport: this.performancePassport, memoryGovernor: this.memoryGovernor, storageGovernor: this.storageGovernor,
    });
    this.engines.performance.startMonitoring();
    const adaptive = this.engines.performance.getAdaptiveSettings();
    this.engines.tiles.configure(adaptive);
    this.engines.performance.addEventListener('pressure', (event) => {
      this.engines.tiles.configure(event.detail.settings);
      this._emit('warning', { code: 'MEMORY_PRESSURE', ...event.detail });
    });
    await this._bestEffort('prune-terminal-sessions', () => this.engines.storage.pruneTerminalSessions({ keepCompleted: 0 }));
    await this._bestEffort('enforce-stage-cache-budget', () => this.engines.storage.enforceStageCacheBudget());
    const resumable = await this._bestEffort('find-resumable-session', () => this.engines.storage.findResumableSession(), null);
    this._emit('ready', { capabilities: this.capabilities, resumable });
    return { capabilities: this.capabilities, resumable };
  }

  async detect() {
    const capabilities = {
      secureContext: isSecureContext,
      crossOriginIsolated,
      webCodecs: 'VideoDecoder' in globalThis && 'VideoEncoder' in globalThis,
      audioCodecs: 'AudioDecoder' in globalThis && 'AudioEncoder' in globalThis,
      webCodecsCodecs: [],
      webGPU: false,
      webGL2: false,
      webGPUAdapter: null,
      webGPUAdapterInfo: null,
      opfs: !!navigator.storage?.getDirectory,
      indexedDB: 'indexedDB' in globalThis,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      hardwareConcurrency: navigator.hardwareConcurrency || 1,
      deviceMemoryGB: navigator.deviceMemory || null,
      deviceProfile: null,
      h264Matrix: [],
      nativeAAC: false,
    };
    const [deviceProfile, codecs, h264Matrix, nativeAAC] = await Promise.all([
      this.engines.hardware.detectProfile().catch((error) => { this._emit('warning', { code: 'HARDWARE_PROFILE_PROBE_FAILED', error }); return null; }),
      capabilities.webCodecs ? getSupportedCodecs().catch((error) => { this._emit('warning', { code: 'CODEC_PROBE_FAILED', error }); return []; }) : [],
      capabilities.webCodecs ? this.engines.hardware.probeH264().catch((error) => { this._emit('warning', { code: 'H264_PROBE_FAILED', error }); return []; }) : [],
      capabilities.audioCodecs ? supportsNativeAAC().catch((error) => { this._emit('warning', { code: 'AAC_PROBE_FAILED', error }); return false; }) : false,
    ]);
    capabilities.deviceProfile = deviceProfile;
    capabilities.webCodecsCodecs = codecs;
    capabilities.h264Matrix = h264Matrix;
    capabilities.nativeAAC = nativeAAC;
    try { capabilities.webGL2 = Boolean(document.createElement('canvas').getContext('webgl2')); }
    catch (error) { this._emit('warning', { code: 'WEBGL2_PROBE_FAILED', error }); }
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          capabilities.webGPU = true;
          capabilities.webGPUAdapter = adapter;
          capabilities.webGPUAdapterInfo = {
            vendor: adapter.info?.vendor || 'unknown',
            architecture: adapter.info?.architecture || 'unknown',
            maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
            maxBufferSize: Number(adapter.limits.maxBufferSize),
          };
        }
      } catch (error) {
        this._emit('warning', { code: 'WEBGPU_ADAPTER_FAILED', error });
      }
    }
    return capabilities;
  }

  createJob(type, options = {}) {
    if (this.activeJobId) throw new Error('Only one processing job can run at a time');
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const job = {
      id,
      type,
      options: structuredCloneSafe(options),
      state: 'queued',
      progress: 0,
      stage: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      controller,
      pausePromise: null,
      resume: null,
      result: null,
      error: null,
    };
    this.jobs.set(id, job);
    this.activeJobId = id;
    this._emitJob(job);
    return this.publicJob(job);
  }

  createResumeJob(checkpoint, type = 'video-process-resume') {
    if (this.activeJobId) throw new Error('Only one processing job can run at a time');
    if (!checkpoint?.sessionId) throw new Error('Invalid resumable checkpoint');
    const id = checkpoint.sessionId;
    const controller = new AbortController();
    const options = structuredCloneSafe(checkpoint.jobOptions || checkpoint.metadata?.jobOptions || {});
    const job = {
      id, type, options, state: 'queued', progress: Number(checkpoint.progress || 0),
      stage: checkpoint.stage || 'resume-ready', createdAt: checkpoint.startedAt || Date.now(),
      updatedAt: Date.now(), controller, pausePromise: null, resume: null, result: null, error: null,
      resumedFromCheckpoint: true, resumeCheckpoint: checkpoint,
    };
    this.jobs.set(id, job);
    this.activeJobId = id;
    this._emitJob(job);
    return this.publicJob(job);
  }

  async runJob(jobId, processor) {
    const job = this._job(jobId);
    if (job.state !== 'queued') throw new Error(`Job ${jobId} is not queued`);
    job.state = 'running';
    job.startedAt = Date.now();
    this._emitJob(job);

    const workloadMB = estimateJobWorkloadMB(job.options);
    const heavyAi = hasHeavyAi(job.options);
    const doctorDecision = this.doctorControlPlane.assessRuntime({ capabilities: this.capabilities || {}, workloadMB, heavyAi, jobId });
    const runtimeDecision = doctorDecision.runtimeDecision;
    const resourceScope = new ResourceScope(`job:${jobId}`, {
      onFault: (fault) => this.faultReporter.warning(fault.code, { ...fault, jobId, source: 'ResourceScope' }),
    });
    let resourcesClosed = false;
    const context = {
      signal: job.controller.signal,
      engines: this.engines,
      capabilities: this.capabilities,
      runtimeGuard: this.runtimeGuard,
      runtimeDecision,
      doctorDecision,
      doctorControlPlane: this.doctorControlPlane,
      resources: resourceScope,
      trackResource: (resource) => resourceScope.track(resource),
      releaseResource: (resource) => resourceScope.release(resource),
      releaseResourceAsync: (resource) => resourceScope.releaseAsync(resource),
      createBoundedQueue: (capacity = runtimeDecision.queueCap) => new BoundedAsyncQueue(Math.min(Math.max(1, capacity), runtimeDecision.queueCap)),
      update: (patch) => this.updateJob(jobId, patch),
      checkpoint: (patch) => this.checkpoint(jobId, patch),
      waitIfPaused: () => this.waitIfPaused(jobId),
    };
    try {
      if (!runtimeDecision.allowNewHeavyAiWork) {
        this.updateJob(jobId, { stage: 'resource-guard' });
        const error = new Error('Heavy AI work is temporarily blocked by BARSA runtime protection');
        error.name = 'RecoverableResourcePressureError';
        error.code = 'MEMORY_PRESSURE';
        error.recoverable = true;
        error.decision = runtimeDecision;
        throw error;
      }
      if (runtimeDecision.state !== 'normal') {
        this._emit('warning', { code: 'RUNTIME_RESOURCE_GUARD', decision: runtimeDecision, jobId });
      }
      const result = await processor(context);
      if (job.controller.signal.aborted) {
        throw job.controller.signal.reason || new DOMException('Processing cancelled by user', 'AbortError');
      }
      await resourceScope.close();
      resourcesClosed = true;
      job.result = null;
      job.state = 'completed';
      job.progress = 1;
      job.stage = 'completed';
      job.completedAt = Date.now();
      return result;
    } catch (error) {
      job.error = serializeError(error);
      job.state = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.stage = job.state;
      if (!job.controller.signal.aborted) this._emit('error', { code: error?.code || 'JOB_FAILED', jobId, error });
      throw error;
    } finally {
      if (!resourcesClosed) {
        try {
          await resourceScope.close();
        } catch (cleanupError) {
          this.faultReporter.warning('RESOURCE_SCOPE_CLOSE_FAILED', { subsystem: 'lifecycle', jobId, error: cleanupError, source: 'EngineManager' });
        }
      }
      job.updatedAt = Date.now();
      if (this.activeJobId === job.id) this.activeJobId = null;
      this._emitJob(job);
      this._pruneJobHistory();
    }
  }

  updateJob(jobId, patch) {
    const job = this._job(jobId);
    if (TERMINAL_STATES.has(job.state)) return this.publicJob(job);
    if (patch.progress != null) job.progress = Math.max(job.progress, Math.min(1, patch.progress));
    if (patch.stage) job.stage = patch.stage;
    Object.assign(job, omit(patch, ['state', 'id', 'controller']));
    job.updatedAt = Date.now();
    this._emitJob(job);
    return this.publicJob(job);
  }

  async checkpoint(jobId, patch = {}) {
    const job = this._job(jobId);
    this.updateJob(jobId, patch);
    const existing = await this.engines.storage.getCheckpoint(jobId);
    if (existing) {
      await this.engines.storage.updateSession(jobId, {
        status: job.state === 'running' || job.state === 'paused' ? 'in_progress' : job.state,
        progress: job.progress,
        stage: job.stage,
        jobOptions: job.options,
        ...patch,
      });
    }
  }

  pauseJob(jobId = this.activeJobId) {
    const job = this._job(jobId);
    if (job.state !== 'running') return false;
    job.state = 'paused';
    job.pausePromise = new Promise((resolve) => { job.resume = resolve; });
    this._emitJob(job);
    return true;
  }

  resumeJob(jobId = this.activeJobId) {
    const job = this._job(jobId);
    if (job.state !== 'paused') return false;
    job.state = 'running';
    job.resume?.();
    job.resume = null;
    job.pausePromise = null;
    this._emitJob(job);
    return true;
  }

  async waitIfPaused(jobId = this.activeJobId) {
    const job = this._job(jobId);
    if (job.pausePromise) await job.pausePromise;
    if (job.controller.signal.aborted) throw job.controller.signal.reason;
  }

  cancelJob(jobId = this.activeJobId) {
    const job = this._job(jobId);
    if (TERMINAL_STATES.has(job.state)) return false;
    const error = new DOMException('Processing cancelled by user', 'AbortError');
    job.controller.abort(error);
    job.resume?.();
    job.state = 'cancelled';
    job.stage = 'cancelled';
    this._emitJob(job);
    return true;
  }

  async runCancelRestartSelfTest() {
    if (this.activeJobId) throw new Error('Cannot run cancel/restart self-test while another job is active');
    const first = this.createJob('self-test-cancel', {});
    const firstRun = this.runJob(first.id, async ({ signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('unexpected-timeout'), 2000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    })).catch((error) => error?.name === 'AbortError' ? 'cancelled' : Promise.reject(error));
    await Promise.resolve();
    this.cancelJob(first.id);
    const cancelled = await firstRun;
    if (cancelled !== 'cancelled' || this.activeJobId) throw new Error('Cancelled job did not release the active-job lock');
    const second = this.createJob('self-test-restart', {});
    const restarted = await this.runJob(second.id, async () => 'restarted');
    if (restarted !== 'restarted' || this.activeJobId) throw new Error('Fresh job could not complete after cancellation');
    return { cancelled: true, restarted: true };
  }

  async restoreInterruptedJob() {
    const checkpoint = await this.engines.storage.findResumableSession();
    if (!checkpoint) return null;
    return {
      id: checkpoint.sessionId,
      options: checkpoint.jobOptions || checkpoint.metadata?.jobOptions || {},
      progress: checkpoint.progress || 0,
      stage: checkpoint.stage || 'interrupted',
      framesWritten: checkpoint.framesWritten || 0,
      bytesWritten: checkpoint.bytesWritten || 0,
      updatedAt: checkpoint.updatedAt,
    };
  }

  publicJob(jobOrId) {
    const job = typeof jobOrId === 'string' ? this._job(jobOrId) : jobOrId;
    return omit(job, ['controller', 'pausePromise', 'resume']);
  }

  peekEngine(name) {
    const engine = this.engines?.[name];
    if (!engine) return null;
    if (engine.__lazyEngineHandle === true) return engine.__peek();
    return engine;
  }

  pickEffectsEngine() {
    if (!this.capabilities) throw new Error('EngineManager.initialize() must complete first');
    return this.capabilities.webGPU ? 'webgpu' : this.capabilities.webGL2 ? 'webgl2' : 'canvas2d';
  }

  summary() {
    if (!this.capabilities) return 'Capabilities have not been detected';
    const codecs = this.capabilities.webCodecsCodecs
      .filter((item) => item.encode)
      .map((item) => item.name)
      .join(', ') || 'none';
    return [
      `WebCodecs encoders: ${codecs}`,
      `WebGPU: ${this.capabilities.webGPU ? 'available' : 'unavailable'}`,
      `Device profile: ${this.capabilities.deviceProfile?.label || 'automatic'}`,
      ...this.capabilities.h264Matrix.map((item) => `H.264 ${item.label}: ${item.supported ? 'supported (hardware requested)' : 'unsupported'}`),
      `WebGL2 fallback: ${this.capabilities.webGL2 ? 'available' : 'unavailable'}`,
      `OPFS: ${this.capabilities.opfs ? 'available' : 'unavailable'}`,
      `Native AAC: ${this.capabilities.nativeAAC ? 'available' : 'FFmpeg fallback'}`,
      'Container demux: Mediabunny direct decode',
      `Performance mode: ${this.engines.performance.mode}`,
      `FFmpeg threads: ${this.capabilities.sharedArrayBuffer ? this.capabilities.hardwareConcurrency : 1}`,
      `Device memory: ${this.capabilities.deviceMemoryGB || 'not reported'} GB`,
    ].join('\n');
  }

  async destroy() {
    if (this.activeJobId) this.cancelJob(this.activeJobId);
    this.engines.performance.destroy();
    this.engines.codecs.close();
    this.engines.gpu.destroy();
    this.engines.webgl.destroy();
    for (const key of ['rife', 'upscale', 'face', 'faceDetector']) {
      const engine = this.peekEngine(key);
      if (engine) await engine.destroy?.();
    }
    this.engines.temporal.destroy();
    this.engines.qualityMetrics.destroy();
    this.engines.color.destroy();
    this.engines.blur.destroy();
    this.engines.audio.destroy();
    this.engines.ffmpeg.terminate();
    this.engines.media.destroy();
    await this.engines.deviceGuard.release();
    this.engines.models.close();
    this.engines.nihui.close();
    await this.engines.storage.close();
  }

  async _bestEffort(label, operation, fallback = null) {
    try {
      return await operation();
    } catch (error) {
      this._emit('warning', { code: 'BEST_EFFORT_OPERATION_FAILED', label, error });
      return fallback;
    }
  }

  _pruneJobHistory(maxTerminalJobs = 24) {
    const terminal = [...this.jobs.values()]
      .filter((job) => TERMINAL_STATES.has(job.state) && job.id !== this.activeJobId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const job of terminal.slice(maxTerminalJobs)) this.jobs.delete(job.id);
  }

  _job(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job: ${id}`);
    return job;
  }

  _emitJob(job) {
    this.dispatchEvent(new CustomEvent('jobchange', { detail: this.publicJob(job) }));
  }

  _emit(type, detail) {
    if (type === 'warning' || type === 'error') {
      const code = detail?.code || (type === 'error' ? 'RUNTIME_ERROR' : 'RUNTIME_WARNING');
      return this.faultReporter.report(type, code, detail || {});
    }
    this.dispatchEvent(new CustomEvent(type, { detail }));
    return detail;
  }
}

function createLazyEngineHandle(label, factory) {
  let instance = null;
  const ensure = () => {
    if (!instance) instance = factory();
    return instance;
  };
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === '__lazyEngineHandle') return true;
      if (property === '__peek') return () => instance;
      if (property === '__label') return label;
      if (property === 'then') return undefined;
      if (LAZY_CLEANUP_METHODS.has(property) && !instance) return () => undefined;
      const engine = ensure();
      const value = engine[property];
      return typeof value === 'function' ? value.bind(engine) : value;
    },
    set(_target, property, value) {
      ensure()[property] = value;
      return true;
    },
  });
}

function estimateJobWorkloadMB(options = {}) {
  const width = Math.max(1, Number(options.width || options.outputWidth || options.targetWidth || options.resolution?.width || 1920));
  const height = Math.max(1, Number(options.height || options.outputHeight || options.targetHeight || options.resolution?.height || 1080));
  const pixels = width * height;
  const frameMB = pixels * 4 / 1024 / 1024;
  const ai = hasHeavyAi(options) ? 3.5 : 1.5;
  const queue = Math.max(1, Number(options.queueDepth || options.codecQueue || 2));
  return Math.max(16, Math.round(frameMB * ai * queue));
}

function hasHeavyAi(options = {}) {
  const text = JSON.stringify(options || {}).toLowerCase();
  return /\"(upscale|rife|face|aienabled|upscaleenabled|rifeenabled|faceenabled)\"\s*:\s*(true|\"on\"|1)/.test(text);
}

function omit(object, keys) {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(object).filter(([key]) => !blocked.has(key)));
}

function structuredCloneSafe(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function serializeError(error) {
  return { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null, code: error?.code || null, recoverable: error?.recoverable === true };
}
