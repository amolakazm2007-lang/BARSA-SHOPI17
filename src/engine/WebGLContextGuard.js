import { BarsaError } from './CrashProofRuntime.js';

export class WebGLContextGuard extends EventTarget {
  constructor({ canvas, logger = console } = {}) {
    if (!canvas?.addEventListener) throw new TypeError('canvas with event support is required');
    super(); this.canvas = canvas; this.logger = logger; this.lost = false;
    this._onLost = (event) => { event.preventDefault?.(); this.lost = true; const error = new BarsaError('WEBGL_CONTEXT_LOST', 'WebGL context lost', { recoverable: true }); this.logger.error?.('[BARSA][webgl-context-lost]', error); this.dispatchEvent(new CustomEvent('lost', { detail: error })); };
    this._onRestored = () => { this.lost = false; this.logger.warn?.('[BARSA][webgl-context-restored]'); this.dispatchEvent(new CustomEvent('restored')); };
    canvas.addEventListener('webglcontextlost', this._onLost, false); canvas.addEventListener('webglcontextrestored', this._onRestored, false);
  }
  assertAvailable() { if (this.lost) throw new BarsaError('WEBGL_CONTEXT_LOST', 'WebGL context is unavailable', { recoverable: true }); }
  dispose() { this.canvas.removeEventListener('webglcontextlost', this._onLost, false); this.canvas.removeEventListener('webglcontextrestored', this._onRestored, false); }
}
