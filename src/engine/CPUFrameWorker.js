import { BarsaError } from './CrashProofRuntime.js';

/**
 * Moves expensive Canvas2D fallback pixel loops off the UI thread.
 * Every task has a hard timeout; a crashed/hung worker is terminated and
 * rebuilt on the next request instead of leaving a permanently pending Promise.
 */
export class CPUFrameWorker {
  constructor({ timeoutMs = 12000, logger = console, onFailure = null } = {}) {
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 12000);
    this.logger = logger;
    this.onFailure = onFailure;
  }

  get supported() { return typeof Worker === 'function' && typeof ImageData === 'function'; }

  _ensure() {
    if (this.worker) return this.worker;
    if (!this.supported) return null;
    const worker = new Worker(new URL('../workers/frame-effects.worker.js', import.meta.url), { type: 'module', name: 'barsa-frame-effects' });
    worker.onmessage = (event) => {
      const { id, ok, buffer, error } = event.data || {};
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      entry.cleanup();
      if (ok) entry.resolve(new ImageData(new Uint8ClampedArray(buffer), entry.width, entry.height));
      else entry.reject(new BarsaError('WORKER_FAILED', error || 'CPU frame worker failed', { recoverable: true }));
    };
    worker.onerror = (event) => {
      const error = new BarsaError('WORKER_CRASH', event.message || event.error?.message || 'CPU frame worker crashed', { recoverable: true, cause: event.error || null });
      this._failWorker(error);
    };
    worker.onmessageerror = (event) => {
      const error = new BarsaError('WORKER_MESSAGE_ERROR', 'CPU frame worker returned an unreadable message', { recoverable: true, details: { dataType: typeof event.data } });
      this._failWorker(error);
    };
    this.worker = worker;
    return worker;
  }

  _failWorker(error) {
    const worker = this.worker;
    this.worker = null;
    try { worker?.terminate?.(); } catch (terminateError) { this.logger.error?.('[BARSA][worker-terminate-failed]', terminateError); }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) { entry.cleanup(); entry.reject(error); }
    this.logger.error?.('[BARSA][worker-failed]', error);
    try { this.onFailure?.(error); } catch (callbackError) { this.logger.error?.('[BARSA][worker-failure-callback-failed]', callbackError); }
  }

  async process(imageData, { effects = null, compiledColor = null, signal = null, fallback = null, timeoutMs = this.timeoutMs } = {}) {
    if (!(imageData instanceof ImageData)) throw new TypeError('CPUFrameWorker expects ImageData');
    if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');
    const worker = this._ensure();
    if (!worker) return fallback ? fallback(new BarsaError('WORKER_UNAVAILABLE', 'Worker API unavailable', { recoverable: true })) : null;
    const id = ++this.sequence;
    const buffer = imageData.data.buffer;
    const request = new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        cleanup();
        reject(signal.reason || new DOMException('Operation cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        cleanup();
        const error = new BarsaError('WORKER_TIMEOUT', `CPU frame worker made no reply within ${timeoutMs} ms`, { recoverable: true, details: { id, timeoutMs } });
        reject(error);
        this._failWorker(error);
      }, Math.max(1000, Number(timeoutMs) || this.timeoutMs));
      this.pending.set(id, { resolve, reject, cleanup, width: imageData.width, height: imageData.height });
      try {
        worker.postMessage({ id, width: imageData.width, height: imageData.height, buffer, effects, compiledColor }, [buffer]);
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        reject(new BarsaError('WORKER_POST_FAILED', `CPU frame worker postMessage failed: ${error?.message || error}`, { recoverable: true, cause: error }));
      }
    });
    try { return await request; }
    catch (error) {
      this.logger.error?.('[BARSA][worker-task-failed]', error);
      if (fallback) return fallback(error);
      throw error;
    }
  }

  destroy(reason = new DOMException('Worker destroyed', 'AbortError')) {
    const worker = this.worker;
    this.worker = null;
    try { worker?.terminate?.(); } catch (error) { this.logger.error?.('[BARSA][worker-terminate-failed]', error); }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) { entry.cleanup(); entry.reject(reason); }
  }
}
