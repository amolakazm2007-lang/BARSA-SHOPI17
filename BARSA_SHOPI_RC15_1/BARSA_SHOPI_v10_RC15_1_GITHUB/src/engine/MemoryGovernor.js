function finiteRatio(a, b) {
  a = Number(a); b = Number(b);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? Math.max(0, a / b) : 0;
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

/** Quality-neutral global working-set governor with hysteresis. */
export class MemoryGovernor {
  constructor({ minBudgetMB = 256, maxBudgetMB = 2048 } = {}) {
    this.minBudgetMB = minBudgetMB;
    this.maxBudgetMB = maxBudgetMB;
    this.state = 'normal';
    this.last = null;
  }

  evaluate({ telemetry = {}, capabilities = {}, workloadMB = 0 } = {}) {
    const deviceMemoryMB = Math.max(1024, Number(capabilities.deviceMemoryGB || 4) * 1024);
    const heapLimitMB = Number(telemetry.jsHeapLimitMB || Infinity);
    const observedAvailableMB = Number(telemetry.availableMemoryMB || Infinity);
    const hard = Math.min(deviceMemoryMB * 0.30, heapLimitMB * 0.58, observedAvailableMB * 0.30);
    const safeBudgetMB = Math.round(clamp(Number.isFinite(hard) ? hard : deviceMemoryMB * 0.22, this.minBudgetMB, this.maxBudgetMB));
    const heapRatio = finiteRatio(telemetry.jsHeapUsedMB, telemetry.jsHeapLimitMB);
    const gpuRatio = finiteRatio(telemetry.gpuAllocatedMB, telemetry.gpuBudgetMB);
    const workingRatio = safeBudgetMB > 0 ? Math.max(0, Number(workloadMB || 0) / safeBudgetMB) : 0;
    const pressure = Math.max(heapRatio, gpuRatio, workingRatio);

    // Hysteresis prevents queue/concurrency oscillation around one threshold.
    if (this.state === 'critical') {
      if (pressure < 0.72) this.state = 'high';
    } else if (this.state === 'high') {
      if (pressure >= 0.92) this.state = 'critical';
      else if (pressure < 0.62) this.state = 'normal';
    } else if (pressure >= 0.92) this.state = 'critical';
    else if (pressure >= 0.78) this.state = 'high';

    const concurrencyCap = this.state === 'critical' ? 1 : this.state === 'high' ? 1 : 2;
    const queueCap = this.state === 'critical' ? 1 : this.state === 'high' ? 2 : 3;
    this.last = { safeBudgetMB, heapRatio, gpuRatio, workingRatio, pressure, state: this.state, concurrencyCap, queueCap };
    return { ...this.last };
  }
}
