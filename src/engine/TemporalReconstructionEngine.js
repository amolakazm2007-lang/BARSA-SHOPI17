import { MotionFieldEngine } from './MotionFieldEngine.js';

/**
 * Motion-aligned multi-frame reconstruction pass.
 * It accumulates a bounded history surface and aligns previous frames with a
 * coarse block-motion field before blending. It is not a neural SR model; its
 * purpose is to feed the existing AI upscaler a cleaner, temporally consistent
 * source with less random noise and shimmer.
 */
export class TemporalReconstructionEngine {
  constructor({ maxHistory = 3, maxHistoryPixels = 1_500_000 } = {}) {
    this.maxHistory = maxHistory;
    this.maxHistoryPixels = maxHistoryPixels;
    this.motion = new MotionFieldEngine();
    this.history = [];
    this.workCanvas = null;
    this.workContext = null;
    this.historyWidth = 0;
    this.historyHeight = 0;
    this.frames = 0;
  }

  process(canvas, context, { enabled = false, strength = 0.45, historyFrames = 3, motionProtection = 0.75, sceneCut = false } = {}) {
    if (!enabled || !canvas?.width || !canvas?.height || strength <= 0) return { applied: false, samples: 0, confidence: 0, motion: 0 };
    if (sceneCut) this.reset();
    this._ensure(canvas.width, canvas.height);
    const field = this.motion.analyze(canvas);
    const historyLimit = Math.max(1, Math.min(this.maxHistory, Math.round(historyFrames || 3)));
    let applied = false;
    if (field.ready && this.history.length && field.confidence > 0.12) {
      const scaleX = canvas.width / this.motion.sampleWidth;
      const scaleY = canvas.height / this.motion.sampleHeight;
      const dx = field.globalDx * scaleX;
      const dy = field.globalDy * scaleY;
      const gate = Math.max(0, 1 - field.motion / Math.max(0.5, 4 * Math.max(0.15, motionProtection)));
      const base = Math.min(0.32, Math.max(0, strength) * 0.28 * gate * field.confidence);
      if (base > 0.002) {
        context.save();
        context.setTransform(1,0,0,1,0,0);
        context.globalCompositeOperation = 'source-over';
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        const usable = this.history.slice(-historyLimit);
        for (let i = 0; i < usable.length; i++) {
          const age = usable.length - i;
          context.globalAlpha = base / age;
          const hx = dx * age;
          const hy = dy * age;
          context.drawImage(usable[i], 0, 0, this.historyWidth, this.historyHeight, hx, hy, canvas.width, canvas.height);
        }
        context.restore();
        applied = true;
      }
    }
    this._store(canvas, historyLimit);
    this.frames++;
    return { applied, samples: this.history.length, confidence: field.confidence || 0, motion: field.motion || 0, dx: field.globalDx || 0, dy: field.globalDy || 0 };
  }

  reset() { this.history.length = 0; this.motion.reset(); this.frames = 0; }
  destroy() { this.reset(); this.motion.destroy(); if (this.workCanvas) { this.workCanvas.width = 1; this.workCanvas.height = 1; } this.workCanvas = this.workContext = null; }

  _ensure(width, height) {
    const scale = Math.min(1, Math.sqrt(this.maxHistoryPixels / Math.max(1, width * height)));
    const w = Math.max(2, Math.round(width * scale / 2) * 2);
    const h = Math.max(2, Math.round(height * scale / 2) * 2);
    if (!this.workCanvas || w !== this.historyWidth || h !== this.historyHeight) {
      this.workCanvas = makeCanvas(w,h);
      this.workContext = this.workCanvas.getContext('2d', { alpha:false });
      this.historyWidth = w; this.historyHeight = h; this.reset();
    }
  }

  _store(canvas, limit) {
    const copy = makeCanvas(this.historyWidth, this.historyHeight);
    const ctx = copy.getContext('2d', { alpha:false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, this.historyWidth, this.historyHeight);
    this.history.push(copy);
    while (this.history.length > limit) { const old = this.history.shift(); old.width = 1; old.height = 1; }
  }
}

function makeCanvas(width,height){ if(typeof OffscreenCanvas==='function') return new OffscreenCanvas(width,height); const c=document.createElement('canvas'); c.width=width;c.height=height;return c; }
