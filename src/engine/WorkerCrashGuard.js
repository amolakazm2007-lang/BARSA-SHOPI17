import { BarsaError, withHardTimeout } from './CrashProofRuntime.js';

export class WorkerCrashGuard extends EventTarget {
  constructor({ workerFactory, timeoutMs = 12000, logger = console } = {}) {
    if (typeof workerFactory !== 'function') throw new TypeError('workerFactory is required');
    super();
    this.workerFactory = workerFactory;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 12000);
    this.logger = logger;
    this.worker = null;
    this.generation = 0;
    this.pending = new Map();
  }

  ensure() {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    const generation = ++this.generation;
    worker.addEventListener?.('error', (event) => this._crash(event.error || new Error(event.message || 'Worker crashed'), generation));
    worker.addEventListener?.('messageerror', (event) => this._crash(new BarsaError('WORKER_MESSAGE_ERROR', 'Worker message could not be deserialized', { recoverable: true, details: event.data }), generation));
    this.worker = worker;
    return worker;
  }

  async run({ id, post, wait, fallback = null, label = 'worker task' } = {}) {
    const worker = this.ensure();
    try {
      post(worker);
      return await withHardTimeout(wait, {
        timeoutMs: this.timeoutMs,
        label,
        onTimeout: async () => this._crash(new BarsaError('WORKER_TIMEOUT', `${label} timed out`, { recoverable: true }), this.generation),
      });
    } catch (error) {
      this.logger.error?.('[BARSA][worker-failed]', { id, label, error });
      if (fallback) return fallback(error);
      throw error;
    }
  }

  _crash(error, generation) {
    if (generation !== this.generation) return;
    this.logger.error?.('[BARSA][worker-crash]', error);
    const doomed = this.worker;
    this.worker = null;
    try { doomed?.terminate?.(); } catch (terminateError) { this.logger.error?.('[BARSA][worker-terminate-failed]', terminateError); }
    for (const entry of this.pending.values()) entry.reject?.(error);
    this.pending.clear();
    this.dispatchEvent(new CustomEvent('crash', { detail: error }));
  }

  destroy(reason = new DOMException('Worker guard destroyed', 'AbortError')) {
    try { this.worker?.terminate?.(); } catch (error) { this.logger.error?.('[BARSA][worker-terminate-failed]', error); }
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject?.(reason);
    this.pending.clear();
  }
}
