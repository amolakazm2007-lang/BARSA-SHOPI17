/**
 * BARSA Dynamic Render Fabric
 *
 * Produces a conservative per-job execution plan by combining the static
 * safety governor with live device telemetry. It never changes requested
 * output resolution/FPS/quality. Only queue depth, concurrency, preview load,
 * checkpoint cadence and tile sizing are adapted.
 */
export class DynamicRenderFabric {
  constructor({ performance = null, capabilities = null, passport = null, memoryGovernor = null, storageGovernor = null } = {}) {
    this.performance = performance;
    this.capabilities = capabilities;
    this.passport = passport;
    this.memoryGovernor = memoryGovernor;
    this.storageGovernor = storageGovernor;
    this.lastPlan = null;
    this._history = [];
  }

  updateCapabilities(capabilities) {
    this.capabilities = capabilities || null;
  }

  plan({ safetyPlan, width, height, fps, aiUpscale = false, rife = false, face = false } = {}) {
    if (!safetyPlan) throw new Error('DynamicRenderFabric requires a safetyPlan');
    const telemetry = this.performance?.telemetry || {};
    const capabilities = this.capabilities || {};
    const pixels = Math.max(1, Number(width) * Number(height));
    const megapixels = pixels / 1_000_000;
    const rate = Math.max(1, Number(fps) || 30);
    const heapRatio = finiteRatio(telemetry.jsHeapUsedMB, telemetry.jsHeapLimitMB);
    const gpuRatio = finiteRatio(telemetry.gpuAllocatedMB, telemetry.gpuBudgetMB);
    const thermalStatus = Number(telemetry.thermalStatus);
    const thermalHeadroom = Number(telemetry.thermalHeadroom);
    const thermalPressure = Number.isFinite(thermalStatus) ? Math.max(0, Math.min(1, thermalStatus / 5)) : 0;
    const passportPressure = Number(this.passport?.pressureProfile?.().ewma || 0);
    const pressure = Math.max(heapRatio, gpuRatio, thermalPressure, Math.min(1, passportPressure || 0));
    this.passport?.observePressure?.({ heapRatio, gpuRatio, thermalRatio: thermalPressure });
    const deviceMemory = Number(capabilities.deviceMemoryGB || globalThis.navigator?.deviceMemory || 4) || 4;
    const cores = Math.max(1, Number(capabilities.hardwareConcurrency || globalThis.navigator?.hardwareConcurrency || 2) || 2);
    const hasWebGPU = Boolean(capabilities.webGPU);
    const aiWeight = (aiUpscale ? 1.7 : 0) + (rife ? 1.35 : 0) + (face ? 0.75 : 0);
    const computeScore = megapixels * (rate / 30) * (1 + aiWeight);

    const legacyMemoryBudgetMB = clamp(
      Math.min(
        deviceMemory * 1024 * 0.18,
        Number(telemetry.jsHeapLimitMB || Infinity) * 0.55,
      ),
      384,
      2048,
    );
    const memoryDecision = this.memoryGovernor?.evaluate?.({ telemetry, capabilities, workloadMB: 0 }) || null;
    const memoryBudgetMB = memoryDecision?.safeBudgetMB || legacyMemoryBudgetMB;

    let tileSize = Number(this.performance?.getAdaptiveSettings?.().tileSize || 256);
    let tileConcurrency = safetyPlan.tileConcurrency;
    let codecQueue = safetyPlan.codecQueue;
    let writeBacklog = safetyPlan.writeBacklog;
    let previewMaxFps = safetyPlan.tier === 'EXTREME' ? 4 : safetyPlan.tier === 'HEAVY' ? 7 : 12;
    let previewLongEdge = safetyPlan.tier === 'EXTREME' ? 640 : safetyPlan.tier === 'HEAVY' ? 800 : 960;
    if (memoryDecision) {
      tileConcurrency = Math.min(tileConcurrency, memoryDecision.concurrencyCap);
      codecQueue = Math.min(codecQueue, memoryDecision.queueCap);
      writeBacklog = Math.min(writeBacklog, memoryDecision.queueCap);
    }
    writeBacklog = Math.min(writeBacklog, this.storageGovernor?.queueCap?.(writeBacklog) || writeBacklog);

    // Compute headroom can safely raise throughput, but never beyond the
    // original governor's memory-safe queue widths.
    const strongDevice = deviceMemory >= 8 && cores >= 8;
    if (strongDevice && hasWebGPU && pressure < 0.58 && computeScore < 12) {
      tileSize = Math.max(tileSize, 384);
      tileConcurrency = Math.min(2, safetyPlan.tileConcurrency + 1);
      previewMaxFps = Math.max(previewMaxFps, 10);
    }

    // High pressure scales only resource parallelism, never requested quality.
    if (pressure >= 0.82) {
      tileSize = Math.min(tileSize, 192);
      tileConcurrency = 1;
      codecQueue = 1;
      writeBacklog = 1;
      previewMaxFps = 3;
      previewLongEdge = 540;
    } else if (pressure >= 0.68) {
      tileSize = Math.min(tileSize, 256);
      tileConcurrency = 1;
      codecQueue = Math.min(codecQueue, 2);
      writeBacklog = Math.min(writeBacklog, 2);
      previewMaxFps = Math.min(previewMaxFps, 6);
      previewLongEdge = Math.min(previewLongEdge, 720);
    }

    // Keep tiles aligned for model reuse / fixed-shape execution paths.
    tileSize = snapTile(tileSize);
    const checkpointEvery = Math.max(
      safetyPlan.checkpointEvery,
      Math.round(rate * (pressure >= 0.82 ? 1.25 : pressure >= 0.68 ? 1 : 0.75)),
    );

    const plan = Object.freeze({
      ...safetyPlan,
      fabric: true,
      qualityLocked: true,
      tileSize,
      tileConcurrency,
      codecQueue,
      writeBacklog,
      checkpointEvery,
      previewMaxFps,
      previewLongEdge,
      memoryBudgetMB: Math.round(memoryBudgetMB),
      memoryState: memoryDecision?.state || null,
      storageProfile: this.storageGovernor?.snapshot?.() || null,
      learnedProfile: this.passport?.snapshot?.() ? true : false,
      pressureScore: Number(pressure.toFixed(3)),
      thermalStatus: Number.isFinite(thermalStatus) ? thermalStatus : null,
      thermalHeadroom: Number.isFinite(thermalHeadroom) ? thermalHeadroom : null,
      computeScore: Number(computeScore.toFixed(2)),
      deviceClass: strongDevice ? 'STRONG' : deviceMemory <= 4 ? 'LOW_MEMORY' : 'BALANCED',
      enginePreference: hasWebGPU ? 'WEBGPU_FIRST' : 'CPU_SAFE',
    });
    this.lastPlan = plan;
    this._history.push({ at: Date.now(), plan });
    if (this._history.length > 12) this._history.shift();
    return plan;
  }

  getHistory() {
    return this._history.slice();
  }
}

export function snapTile(value) {
  const candidates = [128, 192, 256, 384, 512];
  const numeric = Math.max(64, Number(value) || 256);
  return candidates.reduce((best, item) => Math.abs(item - numeric) < Math.abs(best - numeric) ? item : best, candidates[0]);
}

export function finiteRatio(used, limit) {
  const a = Number(used), b = Number(limit);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? Math.max(0, a / b) : 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
