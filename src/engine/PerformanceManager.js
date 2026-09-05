/**
 * Runtime performance telemetry and adaptive workload control.
 * Browsers intentionally do not expose exact VRAM usage; `gpuBudgetMB`
 * is a conservative budget derived from adapter limits and device memory,
 * while allocated GPU bytes are tracked exactly by the processing engines.
 */
export class PerformanceManager extends EventTarget {
  constructor(engineManager = null) {
    super();
    this.engineManager = engineManager;
    this.tier = 'LOW';
    this.mode = 'auto';
    this.deviceProfile = null;
    this.lastBenchmark = null;
    this.telemetry = {
      fps: 0,
      frameTimeMs: 0,
      jsHeapUsedMB: null,
      jsHeapLimitMB: null,
      gpuAllocatedMB: 0,
      gpuBudgetMB: 256,
      storageUsedMB: null,
      storageQuotaMB: null,
      tileSize: 128,
      batchSize: 1,
      thermalStatus: null,
      thermalHeadroom: null,
    };
    this._frameTimes = [];
    this._timer = null;
    this._lastFrameAt = 0;
    this._pressureState = 'normal';
    this._lastPressureEmitAt = 0;
    this._sampleInFlight = null;
  }

  async initialize(adapter = null, deviceProfile = null) {
    this.deviceProfile = deviceProfile;
    const deviceMemoryGB = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 2;
    this.tier = deviceMemoryGB >= 8 && cores >= 8 ? 'HIGH' : deviceMemoryGB >= 4 && cores >= 4 ? 'MEDIUM' : 'LOW';
    const maxBuffer = Number(adapter?.limits?.maxBufferSize || 256 * 1024 * 1024);
    const limitBudget = Math.max(128, Math.min(2048, maxBuffer / 1048576 * 2));
    this.telemetry.gpuBudgetMB = Math.round(Math.min(limitBudget, deviceMemoryGB * 256));
    if (deviceProfile?.recommendedMode === 'poco-f6') this.mode = 'poco-f6';
    const settings = this.getAdaptiveSettings();
    this.telemetry.tileSize = settings.tileSize;
    this.telemetry.batchSize = settings.batchSize;
    await this.sample();
    return this.telemetry;
  }

  async runBenchmark({ testVideoBytes, webgpuEngine, canvas } = {}) {
    const result = {
      decodeFps: null,
      webgpuFrameMs: null,
      memoryEstimateMB: performance.memory?.jsHeapSizeLimit
        ? Math.round(performance.memory.jsHeapSizeLimit / 1048576)
        : null,
      timestamp: Date.now(),
    };
    if (testVideoBytes && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      result.decodeFps = await this._benchmarkDecode(testVideoBytes).catch(() => null);
    }
    if (webgpuEngine?.device && canvas) {
      result.webgpuFrameMs = await this._benchmarkWebGPU(webgpuEngine, canvas).catch(() => null);
    }
    this.lastBenchmark = result;
    this.tier = this._classify(result);
    const settings = this.getAdaptiveSettings();
    this.telemetry.tileSize = settings.tileSize;
    this.telemetry.batchSize = settings.batchSize;
    this._emit();
    return { tier: this.tier, result };
  }

  startMonitoring(intervalMs = 1000) {
    this.stopMonitoring();
    this._timer = setInterval(() => this.sample().catch(() => {}), intervalMs);
    this.sample().catch(() => {});
  }

  stopMonitoring() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  recordFrame(now = performance.now()) {
    if (this._lastFrameAt) {
      const delta = now - this._lastFrameAt;
      if (delta > 0 && delta < 5000) {
        this._frameTimes.push(delta);
        if (this._frameTimes.length > 60) this._frameTimes.shift();
        const average = this._frameTimes.reduce((sum, value) => sum + value, 0) / this._frameTimes.length;
        this.telemetry.frameTimeMs = average;
        this.telemetry.fps = 1000 / average;
      }
    }
    this._lastFrameAt = now;
  }


  setThermalInfo(info = null) {
    this.telemetry.thermalStatus = info?.status == null ? null : Number(info.status);
    this.telemetry.thermalHeadroom = info?.headroom == null ? null : Number(info.headroom);
    this._adaptForPressure();
    this._emit();
  }

  setGPUAllocation(bytes) {
    this.telemetry.gpuAllocatedMB = Math.max(0, bytes / 1048576);
    this._adaptForPressure();
  }

  async sample() {
    if (this._sampleInFlight) return this._sampleInFlight;
    this._sampleInFlight = this._sampleOnce().finally(() => { this._sampleInFlight = null; });
    return this._sampleInFlight;
  }

  async _sampleOnce() {
    if (performance.memory) {
      this.telemetry.jsHeapUsedMB = performance.memory.usedJSHeapSize / 1048576;
      this.telemetry.jsHeapLimitMB = performance.memory.jsHeapSizeLimit / 1048576;
    } else if (performance.measureUserAgentSpecificMemory && crossOriginIsolated) {
      const result = await performance.measureUserAgentSpecificMemory().catch(() => null);
      if (result) this.telemetry.jsHeapUsedMB = result.bytes / 1048576;
    }
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      this.telemetry.storageUsedMB = estimate.usage == null ? null : estimate.usage / 1048576;
      this.telemetry.storageQuotaMB = estimate.quota == null ? null : estimate.quota / 1048576;
    }
    this._adaptForPressure();
    this._emit();
    return { ...this.telemetry };
  }

  _adaptForPressure() {
    const gpuRatio = this.telemetry.gpuAllocatedMB / Math.max(1, this.telemetry.gpuBudgetMB);
    const heapRatio = this.telemetry.jsHeapUsedMB && this.telemetry.jsHeapLimitMB
      ? this.telemetry.jsHeapUsedMB / this.telemetry.jsHeapLimitMB
      : 0;
    const thermalStatus = Number(this.telemetry.thermalStatus);
    const thermalRatio = Number.isFinite(thermalStatus) && thermalStatus >= 0 ? Math.min(1, thermalStatus / 5) : 0;
    const baseline = this._baselineSettings();
    const previousTileSize = this.telemetry.tileSize || baseline.tileSize;
    const previousBatchSize = this.telemetry.batchSize || baseline.batchSize;
    const adapted = computePressureAdaptation({
      tileSize: previousTileSize,
      batchSize: previousBatchSize,
      baselineTileSize: baseline.tileSize,
      baselineBatchSize: baseline.batchSize,
      gpuRatio, heapRatio, thermalRatio, pressureState: this._pressureState,
    });
    this.telemetry.tileSize = adapted.tileSize;
    this.telemetry.batchSize = adapted.batchSize;
    this._pressureState = adapted.pressureState;
    if (adapted.tileSize !== previousTileSize || adapted.batchSize !== previousBatchSize) {
      this.engineManager?.engines?.tiles?.configure(this.getAdaptiveSettings());
    }
    if (adapted.emitPressure) {
      const now = Date.now();
      if (now - this._lastPressureEmitAt >= 5000) {
        this._lastPressureEmitAt = now;
        this.dispatchEvent(new CustomEvent('pressure', {
          detail: { gpuRatio, heapRatio, thermalRatio, severity: adapted.pressureState, settings: this.getAdaptiveSettings() },
        }));
      }
    }
  }

  _classify({ webgpuFrameMs, memoryEstimateMB }) {
    if (webgpuFrameMs == null) return 'LOW';
    if (webgpuFrameMs < 4 && (memoryEstimateMB == null || memoryEstimateMB >= 3000)) return 'ULTRA';
    if (webgpuFrameMs < 9) return 'HIGH';
    if (webgpuFrameMs < 18) return 'MEDIUM';
    return 'LOW';
  }

  _baselineSettings() {
    const table = {
      LOW: { previewScale: 0.5, workerCount: 1, tileSize: 128, batchSize: 1, modelPrecision: 'int8' },
      MEDIUM: { previewScale: 0.75, workerCount: 2, tileSize: 256, batchSize: 1, modelPrecision: 'fp16' },
      HIGH: { previewScale: 1, workerCount: 3, tileSize: 384, batchSize: 2, modelPrecision: 'fp16' },
      ULTRA: { previewScale: 1, workerCount: 4, tileSize: 512, batchSize: 3, modelPrecision: 'fp16' },
      POCO_F6: { previewScale: 0.9, workerCount: 3, tileSize: 256, batchSize: 1, modelPrecision: 'fp16' },
    };
    const forcedTier = this.mode === 'mobile'
      ? 'LOW'
      : this.mode === 'quality'
        ? (this.tier === 'LOW' ? 'MEDIUM' : this.tier)
        : this.mode === 'poco-f6'
          ? 'POCO_F6'
          : this.tier;
    return table[forcedTier] || table.LOW;
  }

  getAdaptiveSettings() {
    const baseline = this._baselineSettings();
    return {
      ...baseline,
      tileSize: Math.min(baseline.tileSize, this.telemetry.tileSize || baseline.tileSize),
      batchSize: Math.min(baseline.batchSize, this.telemetry.batchSize || baseline.batchSize),
    };
  }

  setMode(mode = 'auto') {
    if (!['auto', 'mobile', 'quality', 'poco-f6'].includes(mode)) throw new RangeError(`Unknown performance mode: ${mode}`);
    this.mode = mode;
    const settings = this.getAdaptiveSettings();
    this.telemetry.tileSize = settings.tileSize;
    this.telemetry.batchSize = settings.batchSize;
    this.engineManager?.engines?.tiles?.configure(settings);
    this._emit();
    return settings;
  }

  async _benchmarkDecode(bytes) {
    const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes]));
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    try {
      await eventOnce(video, 'loadedmetadata', 'error');
      let frames = 0;
      const startedAt = performance.now();
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timeout); callback(value); };
        const timeout = setTimeout(() => finish(resolve), 4000);
        const step = (_now, metadata) => {
          if (settled) return;
          frames++;
          if (metadata.mediaTime >= video.duration - 0.03) finish(resolve);
          else video.requestVideoFrameCallback(step);
        };
        video.requestVideoFrameCallback(step);
        video.play().catch((error) => finish(reject, error));
      });
      return frames / Math.max(0.001, (performance.now() - startedAt) / 1000);
    } finally {
      video.pause();
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
    }
  }

  async _benchmarkWebGPU(engine, canvas) {
    const size = Math.max(64, Math.min(512, canvas.width || 256, canvas.height || 256));
    const source = new OffscreenCanvas(size, size);
    source.getContext('2d').fillRect(0, 0, size, size);
    const bitmap = await createImageBitmap(source);
    const frame = new VideoFrame(bitmap, { timestamp: 0 });
    const iterations = 20;
    const startedAt = performance.now();
    try {
      for (let i = 0; i < iterations; i++) engine.renderFrame(frame, {}, { width: size, height: size });
      await engine.device.queue.onSubmittedWorkDone();
    } finally {
      frame.close();
      bitmap.close?.();
    }
    return (performance.now() - startedAt) / iterations;
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('telemetry', { detail: { ...this.telemetry, tier: this.tier, mode: this.mode } }));
  }

  destroy() {
    this.stopMonitoring();
    this._frameTimes.length = 0;
  }
}

export function computePressureAdaptation({ tileSize, batchSize, baselineTileSize, baselineBatchSize, gpuRatio = 0, heapRatio = 0, thermalRatio = 0, pressureState = 'normal' }) {
  const ratio = Math.max(Number(gpuRatio) || 0, Number(heapRatio) || 0);
  const baselineTile = Math.max(96, Number(baselineTileSize) || 128);
  const baselineBatch = Math.max(1, Number(baselineBatchSize) || 1);
  let nextTile = Math.max(96, Number(tileSize) || baselineTile);
  let nextBatch = Math.max(1, Number(batchSize) || baselineBatch);
  let nextState = pressureState;
  let emitPressure = false;
  if (ratio >= 0.9) {
    nextState = 'critical';
    nextTile = Math.max(96, Math.floor(nextTile * 0.72 / 16) * 16);
    nextBatch = 1;
    emitPressure = true;
  } else if (ratio >= 0.82) {
    nextState = 'high';
    nextTile = Math.max(96, Math.floor(nextTile * 0.85 / 16) * 16);
    nextBatch = Math.min(nextBatch, 1);
    emitPressure = true;
  } else if (ratio <= 0.62) {
    nextState = 'normal';
    if (nextTile < baselineTile) nextTile = Math.min(baselineTile, nextTile + 32);
    if (nextTile >= baselineTile && nextBatch < baselineBatch) nextBatch += 1;
  }
  return { tileSize: Math.min(baselineTile, nextTile), batchSize: Math.min(baselineBatch, nextBatch), pressureState: nextState, emitPressure };
}

function eventOnce(target, success, failure) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { target.removeEventListener(success, onSuccess); target.removeEventListener(failure, onFailure); };
    const onSuccess = (event) => { cleanup(); resolve(event); };
    const onFailure = () => { cleanup(); reject(new Error(`Media event failed: ${failure}`)); };
    target.addEventListener(success, onSuccess, { once: true });
    target.addEventListener(failure, onFailure, { once: true });
  });
}
