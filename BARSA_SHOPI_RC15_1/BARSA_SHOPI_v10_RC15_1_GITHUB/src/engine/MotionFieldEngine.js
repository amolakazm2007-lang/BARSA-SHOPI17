/**
 * Bounded block-matching motion field for mobile video processing.
 * Produces a coarse local motion grid plus a robust global translation.
 * This is intentionally CPU-bounded and does not retain full video frames.
 */
export class MotionFieldEngine {
  constructor({ sampleWidth = 96, sampleHeight = 54, blockSize = 8, searchRadius = 3 } = {}) {
    this.sampleWidth = sampleWidth;
    this.sampleHeight = sampleHeight;
    this.blockSize = blockSize;
    this.searchRadius = searchRadius;
    this.canvas = null;
    this.context = null;
    this.previous = null;
  }

  analyze(canvas, { searchRadius = this.searchRadius } = {}) {
    const current = this._sample(canvas);
    if (!this.previous) {
      this.previous = current;
      return { ready: false, globalDx: 0, globalDy: 0, confidence: 0, motion: 0, vectors: [] };
    }
    const result = estimateMotionField(this.previous, current, this.sampleWidth, this.sampleHeight, {
      blockSize: this.blockSize,
      searchRadius,
    });
    this.previous = current;
    return { ready: true, ...result };
  }

  reset() { this.previous = null; }
  destroy() { this.reset(); if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; } this.canvas = this.context = null; }

  _sample(canvas) {
    if (!this.canvas) {
      this.canvas = makeCanvas(this.sampleWidth, this.sampleHeight);
      this.context = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    }
    this.context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, this.sampleWidth, this.sampleHeight);
    const rgba = this.context.getImageData(0, 0, this.sampleWidth, this.sampleHeight).data;
    const luma = new Uint8Array(this.sampleWidth * this.sampleHeight);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) luma[p] = (rgba[i] * 54 + rgba[i + 1] * 183 + rgba[i + 2] * 19) >> 8;
    return luma;
  }
}

export function estimateMotionField(previous, current, width, height, { blockSize = 8, searchRadius = 3 } = {}) {
  if (!previous?.length || previous.length !== current?.length || previous.length !== width * height) throw new Error('Motion field requires equal luma planes');
  const vectors = [];
  const half = Math.max(2, Math.floor(blockSize / 2));
  for (let cy = half + searchRadius; cy < height - half - searchRadius; cy += blockSize) {
    for (let cx = half + searchRadius; cx < width - half - searchRadius; cx += blockSize) {
      let best = { dx: 0, dy: 0, error: Infinity };
      for (let dy = -searchRadius; dy <= searchRadius; dy++) for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        let total = 0, count = 0;
        for (let y = -half; y < half; y += 2) for (let x = -half; x < half; x += 2) {
          total += Math.abs(previous[(cy + y) * width + (cx + x)] - current[(cy + y + dy) * width + (cx + x + dx)]);
          count++;
        }
        const error = total / Math.max(1, count);
        if (error < best.error) best = { dx, dy, error };
      }
      vectors.push({ x: cx, y: cy, ...best, confidence: clamp01(1 - best.error / 48) });
    }
  }
  const reliable = vectors.filter(v => v.confidence >= 0.18);
  const pool = reliable.length >= 3 ? reliable : vectors;
  const globalDx = median(pool.map(v => v.dx));
  const globalDy = median(pool.map(v => v.dy));
  const confidence = pool.length ? pool.reduce((s, v) => s + v.confidence, 0) / pool.length : 0;
  const motion = pool.length ? pool.reduce((s, v) => s + Math.hypot(v.dx, v.dy), 0) / pool.length : 0;
  return { vectors, globalDx, globalDy, confidence, motion };
}

function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a,b)=>a-b); const m = sorted.length >> 1; return sorted.length % 2 ? sorted[m] : (sorted[m-1] + sorted[m]) / 2; }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function makeCanvas(width, height) { if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height); const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
