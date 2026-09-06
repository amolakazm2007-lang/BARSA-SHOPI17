export class BarsaError extends Error {
  constructor(code, message, { recoverable = false, details = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'BarsaError';
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }
}

export function classifyFailure(error, fallbackCode = 'UNKNOWN_FAILURE') {
  if (error instanceof BarsaError) return error;
  const text = String(error?.message || error || '').toLowerCase();
  let code = fallbackCode;
  if (text.includes('device') && text.includes('lost')) code = 'GPU_DEVICE_LOST';
  else if (text.includes('context') && text.includes('lost')) code = 'WEBGL_CONTEXT_LOST';
  else if (text.includes('worker')) code = 'WORKER_FAILED';
  else if (text.includes('memory') || text.includes('out of memory') || text.includes('oom')) code = 'MEMORY_PRESSURE';
  else if (text.includes('timeout') || text.includes('timed out')) code = 'OPERATION_TIMEOUT';
  else if (text.includes('encoder')) code = 'ENCODER_FAILED';
  else if (text.includes('decoder')) code = 'DECODER_FAILED';
  return new BarsaError(code, error?.message || String(error), { recoverable: true, cause: error });
}

export async function withHardTimeout(operation, {
  timeoutMs,
  label = 'operation',
  signal = null,
  onTimeout = null,
} = {}) {
  const ms = Math.max(1, Number(timeoutMs || 0));
  if (!Number.isFinite(ms)) throw new TypeError('timeoutMs must be finite');
  if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');

  let timeoutId;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      try { await onTimeout?.(); } catch (cleanupError) { console.error('[BARSA][timeout-cleanup-failed]', label, cleanupError); }
      reject(new BarsaError('OPERATION_TIMEOUT', `${label} timed out after ${ms}ms`, { recoverable: true, details: { label, timeoutMs: ms } }));
    }, ms);
  });
  const abortPromise = signal ? new Promise((_, reject) => {
    abortHandler = () => reject(signal.reason || new DOMException('Operation cancelled', 'AbortError'));
    signal.addEventListener('abort', abortHandler, { once: true });
  }) : null;

  try {
    const task = typeof operation === 'function' ? Promise.resolve().then(operation) : Promise.resolve(operation);
    return await Promise.race(abortPromise ? [task, timeoutPromise, abortPromise] : [task, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
  }
}

export async function runFallbackChain(stages, {
  label = 'fallback-chain',
  onFailure = null,
  onFallback = null,
} = {}) {
  const failures = [];
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    try {
      return await stage.run();
    } catch (rawError) {
      const error = classifyFailure(rawError, stage.code || 'STAGE_FAILED');
      failures.push({ name: stage.name, error });
      console.error(`[BARSA][${label}] ${stage.name} failed`, error);
      await onFailure?.({ stage: stage.name, error, index });
      if (index < stages.length - 1) {
        const next = stages[index + 1];
        console.warn(`[BARSA][${label}] falling back ${stage.name} -> ${next.name}`);
        await stage.cleanup?.(error);
        await onFallback?.({ from: stage.name, to: next.name, error });
      }
    }
  }
  throw new AggregateError(failures.map((item) => item.error), `${label} exhausted all fallbacks`);
}

export class ProgressWatchdog extends EventTarget {
  constructor({ timeoutMs = 15000, pollMs = 1000, label = 'render-stage', onStall = null } = {}) {
    super();
    this.timeoutMs = Math.max(1000, Number(timeoutMs));
    this.pollMs = Math.max(100, Number(pollMs));
    this.label = label;
    this.onStall = onStall;
    this.lastProgressAt = 0;
    this.lastCount = 0;
    this.timer = null;
    this.stalled = false;
  }

  start(initialCount = 0) {
    this.stop();
    this.lastCount = Number(initialCount) || 0;
    this.lastProgressAt = performance.now();
    this.stalled = false;
    this.timer = setInterval(() => this._check(), this.pollMs);
    return this;
  }

  progress(count) {
    const value = Number(count) || 0;
    if (value > this.lastCount) {
      this.lastCount = value;
      this.lastProgressAt = performance.now();
      this.dispatchEvent(new CustomEvent('progress', { detail: { count: value, label: this.label } }));
    }
  }

  async _check() {
    if (this.stalled) return;
    const stalledForMs = performance.now() - this.lastProgressAt;
    if (stalledForMs < this.timeoutMs) return;
    this.stalled = true;
    const error = new BarsaError('PIPELINE_STALLED', `${this.label} made no frame progress for ${Math.round(stalledForMs)}ms`, {
      recoverable: true,
      details: { label: this.label, lastCount: this.lastCount, stalledForMs },
    });
    console.error('[BARSA][watchdog-stall]', error);
    try { await this.onStall?.(error); } catch (cleanupError) { console.error('[BARSA][watchdog-cleanup-failed]', cleanupError); }
    this.dispatchEvent(new CustomEvent('stall', { detail: error }));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset(count = this.lastCount) {
    this.lastCount = Number(count) || 0;
    this.lastProgressAt = performance.now();
    this.stalled = false;
  }
}

export function installGlobalCrashTelemetry({ report = console.error } = {}) {
  if (typeof window === 'undefined') return () => {};
  const onError = (event) => report('[BARSA][window-error]', event.error || event.message);
  const onRejection = (event) => report('[BARSA][unhandled-rejection]', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
