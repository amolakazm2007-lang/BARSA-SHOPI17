/**
 * Internal render resilience controller.
 * This is deliberately deterministic and frame-safe: it never drops frames
 * or changes output geometry/FPS. Under pressure it only lowers concurrency,
 * queue depth, preview burden and prefers safer backends.
 */
export class RenderResilienceEngine {
  constructor({ sampleEveryFrames = 30 } = {}) {
    this.sampleEveryFrames = Math.max(1, sampleEveryFrames);
    this.reset();
  }

  reset() {
    this.actions = [];
    this.lastTier = 'NORMAL';
    this.peakHeapRatio = 0;
    this.backendFallbacks = 0;
    this.recoveryCount = 0;
    return this;
  }

  evaluate({ frameIndex = 0, codecQueue = 0, writeBacklog = 0, plan = null } = {}) {
    if (frameIndex > 0 && frameIndex % this.sampleEveryFrames !== 0) return null;
    const memory = readMemoryPressure();
    this.peakHeapRatio = Math.max(this.peakHeapRatio, memory.ratio || 0);
    const queuePressure = Math.max(
      Number(codecQueue) / Math.max(1, Number(plan?.codecQueue) || 1),
      Number(writeBacklog) / Math.max(1, Number(plan?.writeBacklog) || 1),
    );
    const score = Math.max(memory.ratio || 0, Math.min(1.5, queuePressure / 1.5));
    const tier = score >= .9 ? 'CRITICAL' : score >= .72 ? 'HIGH' : score >= .55 ? 'ELEVATED' : 'NORMAL';
    this.lastTier = tier;
    if (tier === 'NORMAL') return { tier, score, memory };
    const action = {
      tier,
      score,
      memory,
      codecQueue: 1,
      writeBacklog: 1,
      tileConcurrency: 1,
      forceYield: tier === 'CRITICAL',
      preferSafeBackend: tier === 'CRITICAL',
    };
    this.actions.push({ frameIndex, tier, score: Number(score.toFixed(3)) });
    if (this.actions.length > 64) this.actions.shift();
    this.recoveryCount++;
    return action;
  }

  noteBackendFallback() { this.backendFallbacks++; }

  diagnostics() {
    return {
      tier: this.lastTier,
      peakHeapRatio: Number(this.peakHeapRatio.toFixed(3)),
      recoveryCount: this.recoveryCount,
      backendFallbacks: this.backendFallbacks,
      recentActions: [...this.actions],
      policy: 'never-drop-frames-never-change-output',
    };
  }
}

function readMemoryPressure() {
  const memory = performance.memory;
  if (!memory?.usedJSHeapSize || !memory?.jsHeapSizeLimit) return { ratio: null, usedMB: null, limitMB: null, source: 'unavailable' };
  return {
    ratio: memory.usedJSHeapSize / memory.jsHeapSizeLimit,
    usedMB: memory.usedJSHeapSize / 1048576,
    limitMB: memory.jsHeapSizeLimit / 1048576,
    source: 'performance.memory',
  };
}
