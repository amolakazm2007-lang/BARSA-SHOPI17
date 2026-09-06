function serializeError(error) {
  if (!error) return null;
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || null,
    code: error?.code || null,
    recoverable: error?.recoverable === true,
  };
}

export function inferRuntimeSubsystem(code) {
  const value = String(code || '').toUpperCase();
  if (value.includes('GPU') || value.includes('WEBGL')) return 'gpu';
  if (value.includes('CODEC') || value.includes('ENCODER') || value.includes('DECODER')) return 'webcodecs';
  if (value.includes('FFMPEG') || value.includes('REMUX')) return 'ffmpeg';
  if (value.includes('MODEL') || value.includes('ORT') || value.includes('ONNX') || value.includes('AI_')) return 'ai';
  if (value.includes('STORAGE') || value.includes('OPFS') || value.includes('CHECKPOINT')) return 'storage';
  if (value.includes('MEMORY') || value.includes('THERMAL') || value.includes('PRESSURE')) return 'resources';
  if (value.includes('WORKER')) return 'worker';
  if (value.includes('DOCTOR')) return 'doctor';
  if (value.includes('RESOURCE') || value.includes('CLEANUP') || value.includes('DISPOSE')) return 'lifecycle';
  return 'runtime';
}

/**
 * Single runtime fault contract for BARSA SHOPI.
 *
 * Responsibilities:
 * - normalize every warning/error into one immutable shape;
 * - persist it to RuntimeFaultLedger;
 * - fan it out to EventTarget observers;
 * - never throw while reporting an already-failing path.
 *
 * Reporting is intentionally side-effect-safe: failures in telemetry must never
 * mask or replace the original application error.
 */
export class RuntimeFaultReporter {
  constructor({ ledger = null, eventTarget = null, source = 'runtime', getActiveJobId = null } = {}) {
    this.ledger = ledger;
    this.eventTarget = eventTarget;
    this.source = source;
    this.getActiveJobId = typeof getActiveJobId === 'function' ? getActiveJobId : () => null;
    this.reportingFailures = 0;
  }

  warning(code, details = {}) {
    return this.report('warning', code, details);
  }

  error(code, details = {}) {
    return this.report('error', code, details);
  }

  report(level, code, details = {}) {
    const type = level === 'error' ? 'error' : 'warning';
    const error = details?.error instanceof Error ? details.error : null;
    const normalized = Object.freeze({
      ...details,
      code: String(code || details?.code || (type === 'error' ? 'RUNTIME_ERROR' : 'RUNTIME_WARNING')),
      subsystem: details?.subsystem || inferRuntimeSubsystem(code || details?.code),
      severity: type === 'error' ? 'error' : details?.severity || 'warning',
      jobId: details?.jobId || this.getActiveJobId() || null,
      recoverable: details?.recoverable ?? error?.recoverable ?? null,
      error: error ? serializeError(error) : details?.error || null,
      at: Date.now(),
    });

    try {
      this.ledger?.record?.({
        code: normalized.code,
        subsystem: normalized.subsystem,
        severity: normalized.severity,
        jobId: normalized.jobId,
        recoverable: normalized.recoverable,
        message: normalized.message || normalized.error?.message || normalized.label || normalized.code,
        details: normalized,
        source: details?.source || this.source,
      });
    } catch {
      this.reportingFailures += 1;
    }

    try {
      this.eventTarget?.dispatchEvent?.(new CustomEvent(type, { detail: normalized }));
    } catch {
      this.reportingFailures += 1;
    }

    return normalized;
  }

  snapshot() {
    return Object.freeze({ reportingFailures: this.reportingFailures });
  }
}
