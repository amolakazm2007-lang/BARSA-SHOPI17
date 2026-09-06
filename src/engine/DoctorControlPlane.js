function clampInt(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function freezeDeepDecision(decision) {
  Object.freeze(decision.observe);
  Object.freeze(decision.predict);
  Object.freeze(decision.gate);
  Object.freeze(decision.throttle);
  Object.freeze(decision.repair);
  Object.freeze(decision.verify);
  Object.freeze(decision.commit);
  return Object.freeze(decision);
}

/**
 * BARSA Doctor runtime control plane.
 *
 * The control plane does not alter final-render quality. It converts runtime
 * telemetry into one deterministic policy consumed by the render manager:
 * Observe -> Predict -> Gate -> Throttle -> Repair -> Verify -> Commit/Rollback.
 */
export class DoctorControlPlane {
  constructor({ runtimeGuard, performance = null, storage = null, passport = null } = {}) {
    if (!runtimeGuard) throw new Error('DoctorControlPlane requires RuntimeHealthGuard');
    this.runtimeGuard = runtimeGuard;
    this.performance = performance;
    this.storage = storage;
    this.passport = passport;
    this.lastDecision = null;
    this.sequence = 0;
  }

  assessRuntime({ capabilities = {}, workloadMB = 0, heavyAi = false, jobId = null } = {}) {
    const runtime = this.runtimeGuard.evaluate({ capabilities, workloadMB, heavyAi });
    const telemetry = { ...(this.performance?.telemetry || {}) };
    const pressure = runtime.state || 'normal';
    const thermalStatus = Number.isFinite(Number(telemetry.thermalStatus)) ? Number(telemetry.thermalStatus) : null;
    const storagePressure = this._storagePressure();
    const critical = pressure === 'critical' || storagePressure === 'critical';
    const high = critical || pressure === 'high' || storagePressure === 'high';
    const allowed = runtime.allowNewHeavyAiWork !== false && storagePressure !== 'critical';

    const decision = freezeDeepDecision({
      id: `doctor-${Date.now()}-${++this.sequence}`,
      jobId,
      qualityLocked: true,
      runtimeDecision: runtime,
      observe: {
        pressure,
        heapRatio: Number(runtime.heapRatio || 0),
        gpuRatio: Number(runtime.gpuRatio || 0),
        thermalStatus,
        storagePressure,
        workloadMB: Math.max(0, Number(workloadMB || 0)),
      },
      predict: {
        risk: critical ? 'critical' : high ? 'elevated' : 'normal',
        nextHeavyAllocationRisk: heavyAi && (critical || high) ? 'elevated' : 'normal',
        stallRisk: critical ? 'elevated' : 'normal',
      },
      gate: {
        allowNewWork: allowed,
        allowNewHeavyAiWork: allowed && runtime.allowNewHeavyAiWork !== false,
        checkpointBeforeHeavyWork: Boolean(runtime.checkpointNow || critical),
        reason: allowed ? null : storagePressure === 'critical' ? 'STORAGE_PRESSURE_CRITICAL' : runtime.reason,
      },
      throttle: {
        concurrencyCap: clampInt(runtime.concurrencyCap, 1, 8),
        queueCap: clampInt(runtime.queueCap, 1, 16),
        previewEnabled: runtime.previewEnabled !== false && !critical,
        // Preview is the only frame-rate-like value Doctor may reduce.
        previewFpsCap: critical ? 2 : high ? 5 : 12,
        finalResolutionLocked: true,
        finalFpsLocked: true,
        finalBitrateLocked: true,
        finalModelLocked: true,
      },
      repair: {
        requested: critical || high,
        actions: [
          ...(critical || high ? ['RELEASE_IDLE_TRANSIENT_RESOURCES'] : []),
          ...(runtime.checkpointNow ? ['CHECKPOINT_NOW'] : []),
          ...(storagePressure !== 'normal' ? ['STORAGE_RECONCILE_SAFE_CACHE'] : []),
        ],
      },
      verify: {
        requirePressureRecheck: critical || high,
        requireQualityLock: true,
        requireCheckpointIntegrity: Boolean(runtime.checkpointNow || critical),
      },
      commit: {
        outcome: allowed ? 'COMMIT_POLICY' : 'ROLLBACK_OR_PAUSE',
        finalQualityMutationAllowed: false,
      },
    });

    this.lastDecision = decision;
    return decision;
  }

  verifyQualityLock(before = {}, after = {}) {
    const fields = ['width', 'height', 'fps', 'bitrate', 'bitrateK', 'modelId', 'upscaleModel', 'rifeModel', 'faceModel'];
    const violations = [];
    for (const field of fields) {
      if (!(field in before) || !(field in after)) continue;
      if (before[field] !== after[field]) violations.push({ field, before: before[field], after: after[field] });
    }
    return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
  }

  _storagePressure() {
    const telemetry = this.storage?.lastUsage || this.storage?.usage || null;
    if (!telemetry) return 'normal';
    const quota = Number(telemetry.quotaBytes || telemetry.quota || 0);
    const used = Number(telemetry.usageBytes || telemetry.usage || 0);
    if (!(quota > 0) || !Number.isFinite(used)) return 'normal';
    const ratio = used / quota;
    if (ratio >= 0.94) return 'critical';
    if (ratio >= 0.82) return 'high';
    return 'normal';
  }
}
