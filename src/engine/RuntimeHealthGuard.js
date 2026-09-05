function ratio(used, limit) {
  const a = Number(used), b = Number(limit);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? Math.max(0, a / b) : 0;
}

/**
 * Proactive runtime guard. It never changes requested final quality.
 * It only constrains concurrency/queues/preview and can block new heavy AI work
 * while the device is already under critical pressure.
 */
export class RuntimeHealthGuard {
  constructor({ memoryGovernor, performance = null, storageGovernor = null } = {}) {
    this.memoryGovernor = memoryGovernor;
    this.performance = performance;
    this.storageGovernor = storageGovernor;
    this.lastDecision = null;
  }

  evaluate({ capabilities = {}, workloadMB = 0, heavyAi = false } = {}) {
    const telemetry = this.performance?.telemetry || {};
    const memory = this.memoryGovernor?.evaluate?.({ telemetry, capabilities, workloadMB }) || {
      state: 'normal', concurrencyCap: 2, queueCap: 3, pressure: 0,
    };
    const heapRatio = ratio(telemetry.jsHeapUsedMB, telemetry.jsHeapLimitMB);
    const gpuRatio = ratio(telemetry.gpuAllocatedMB, telemetry.gpuBudgetMB);
    const thermalStatus = Number(telemetry.thermalStatus);
    const thermalCritical = Number.isFinite(thermalStatus) && thermalStatus >= 5;
    const storageQueueCap = this.storageGovernor?.queueCap?.(memory.queueCap) || memory.queueCap;
    const critical = memory.state === 'critical' || thermalCritical || heapRatio >= 0.94 || gpuRatio >= 0.94;
    const high = critical || memory.state === 'high' || heapRatio >= 0.80 || gpuRatio >= 0.80;

    const decision = Object.freeze({
      state: critical ? 'critical' : high ? 'high' : 'normal',
      allowNewHeavyAiWork: !(critical && heavyAi),
      concurrencyCap: critical ? 1 : Math.max(1, Number(memory.concurrencyCap || 1)),
      queueCap: critical ? 1 : Math.max(1, Math.min(Number(memory.queueCap || 1), Number(storageQueueCap || 1))),
      previewEnabled: !critical,
      checkpointNow: critical,
      qualityLocked: true,
      heapRatio,
      gpuRatio,
      workloadMB: Math.max(0, Number(workloadMB || 0)),
      reason: critical ? 'RESOURCE_PRESSURE_CRITICAL' : high ? 'RESOURCE_PRESSURE_HIGH' : 'HEALTHY',
    });
    this.lastDecision = decision;
    return decision;
  }

  assertCanStartHeavyAi(context = {}) {
    const decision = this.evaluate({ ...context, heavyAi: true });
    if (!decision.allowNewHeavyAiWork) {
      const error = new Error('Heavy AI work is temporarily blocked by BARSA runtime protection');
      error.name = 'RecoverableResourcePressureError';
      error.code = 'MEMORY_PRESSURE';
      error.recoverable = true;
      error.decision = decision;
      throw error;
    }
    return decision;
  }
}
