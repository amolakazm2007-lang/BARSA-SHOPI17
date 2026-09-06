export class BarsaError extends Error {
  constructor(code, message, { recoverable = false, cause = null, details = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BarsaError'; this.code = code; this.recoverable = Boolean(recoverable); this.details = details;
  }
}

export async function withHardTimeout(operation, { timeoutMs = 10000, label = 'operation', signal = null, onTimeout = null } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal.reason || new DOMException('Operation cancelled', 'AbortError'));
  signal?.addEventListener('abort', relayAbort, { once: true });
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      const error = new BarsaError('OPERATION_TIMEOUT', `${label} exceeded ${timeoutMs} ms`, { recoverable: true, details: { label, timeoutMs } });
      controller.abort(error);
      try { await onTimeout?.(error); } catch (cleanupError) { console.error('[BARSA][timeout-cleanup-failed]', cleanupError); }
      reject(error);
    }, timeoutMs);
  });
  try {
    const work = typeof operation === 'function' ? Promise.resolve().then(() => operation(controller.signal)) : Promise.resolve(operation);
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

export async function runFallbackChain(stages, { label = 'fallback-chain', onFallback = null } = {}) {
  const failures = [];
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];
    try { return await stage.run(); }
    catch (error) {
      failures.push({ name: stage.name, error });
      try { await stage.cleanup?.(error); } catch (cleanupError) { console.error(`[BARSA][${label}][cleanup-failed]`, cleanupError); }
      const next = stages[i + 1];
      if (next) { console.warn(`[BARSA][${label}] ${stage.name} -> ${next.name}`, error); await onFallback?.({ from: stage.name, to: next.name, error }); }
    }
  }
  throw new AggregateError(failures.map((entry) => entry.error), `${label} exhausted all fallbacks`);
}

export class ProgressWatchdog {
  constructor({ timeoutMs = 15000, pollMs = 500, label = 'render', onStall = null } = {}) {
    this.timeoutMs = Math.max(1000, timeoutMs); this.pollMs = Math.max(100, pollMs); this.label = label; this.onStall = onStall;
    this.lastCount = 0; this.lastProgressAt = 0; this.timer = null; this.stalled = false;
  }
  start(initialCount = 0) { this.stop(); this.lastCount = Number(initialCount) || 0; this.lastProgressAt = performance.now(); this.stalled = false; this.timer = setInterval(() => { void this._check(); }, this.pollMs); return this; }
  progress(count) { const next = Number(count) || 0; if (next > this.lastCount) { this.lastCount = next; this.lastProgressAt = performance.now(); this.stalled = false; } }
  async _check() { if (this.stalled || !this.timer) return; if (performance.now() - this.lastProgressAt < this.timeoutMs) return; this.stalled = true; const error = new BarsaError('PIPELINE_STALLED', `${this.label} made no frame progress for ${this.timeoutMs} ms`, { recoverable: true, details: { lastCount: this.lastCount, timeoutMs: this.timeoutMs } }); console.error('[BARSA][watchdog-stall]', error); await this.onStall?.(error); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
