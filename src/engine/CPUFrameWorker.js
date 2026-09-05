/**
 * Moves expensive Canvas2D fallback pixel loops off the UI thread.
 * The caller performs canvas readback/upload; the worker owns the transferred
 * RGBA buffer while Quality/Color math runs. Only one bounded request is kept
 * in flight by VideoPipeline, so 4K fallback cannot create an unbounded queue.
 */
export class CPUFrameWorker {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
  }

  get supported() { return typeof Worker === 'function' && typeof ImageData === 'function'; }

  _ensure() {
    if (this.worker) return this.worker;
    if (!this.supported) return null;
    this.worker = new Worker(new URL('../workers/frame-effects.worker.js', import.meta.url), { type: 'module', name: 'barsa-frame-effects' });
    this.worker.onmessage = (event) => {
      const { id, ok, buffer, error } = event.data || {};
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (ok) entry.resolve(buffer); else entry.reject(new Error(error || 'CPU frame worker failed'));
    };
    this.worker.onerror = (event) => {
      const error = event.error || new Error(event.message || 'CPU frame worker crashed');
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
      this.destroy();
    };
    return this.worker;
  }

  async process(imageData, { effects = null, compiledColor = null, signal = null } = {}) {
    if (!(imageData instanceof ImageData)) throw new TypeError('CPUFrameWorker expects ImageData');
    if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');
    const worker = this._ensure();
    if (!worker) return null;
    const id = ++this.sequence;
    const buffer = imageData.data.buffer;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        reject(signal.reason || new DOMException('Operation cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (result) => { signal?.removeEventListener('abort', onAbort); resolve(new ImageData(new Uint8ClampedArray(result), imageData.width, imageData.height)); },
        reject: (error) => { signal?.removeEventListener('abort', onAbort); reject(error); },
      });
      worker.postMessage({ id, width: imageData.width, height: imageData.height, buffer, effects, compiledColor }, [buffer]);
    });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(new DOMException('Worker destroyed', 'AbortError'));
    this.pending.clear();
  }
}
