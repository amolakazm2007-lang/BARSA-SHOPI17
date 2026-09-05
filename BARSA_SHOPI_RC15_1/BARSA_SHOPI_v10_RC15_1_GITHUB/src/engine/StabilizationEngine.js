/**
 * Lightweight global-motion video stabilizer for mobile/web runtimes.
 * Estimates frame-to-frame translation on a bounded luma sample using SAD,
 * smooths the camera path, then applies the inverse correction with a small
 * safety zoom. It never buffers full video frames.
 */
export class StabilizationEngine {
  constructor({ sampleWidth = 64, sampleHeight = 36 } = {}) {
    this.sampleWidth = sampleWidth;
    this.sampleHeight = sampleHeight;
    this.sampleCanvas = null;
    this.sampleContext = null;
    this.previous = null;
    this.cameraX = 0;
    this.cameraY = 0;
    this.smoothX = 0;
    this.smoothY = 0;
    this.tempCanvas = null;
    this.tempContext = null;
    this.frames = 0;
  }

  process(canvas, context, { enabled = false, strength = 0.55, crop = 0.035, maxShift = 14, smoothing = 0.88, sceneThreshold = 0.20 } = {}) {
    if (!enabled || !canvas?.width || !canvas?.height) return { applied: false, dx: 0, dy: 0, sceneCut: false };
    this._ensure(canvas.width, canvas.height);
    const current = this._sample(canvas);
    if (!this.previous) {
      this.previous = current;
      this.frames++;
      return { applied: false, dx: 0, dy: 0, sceneCut: false };
    }
    const estimate = estimateTranslation(this.previous, current, this.sampleWidth, this.sampleHeight, Math.max(1, Math.round(maxShift * this.sampleWidth / canvas.width)));
    const sceneCut = estimate.normalizedError > sceneThreshold;
    if (sceneCut) {
      this.resetPath();
      this.previous = current;
      this.frames++;
      return { applied: false, dx: 0, dy: 0, sceneCut: true };
    }
    const scaleX = canvas.width / this.sampleWidth;
    const scaleY = canvas.height / this.sampleHeight;
    this.cameraX += estimate.dx * scaleX;
    this.cameraY += estimate.dy * scaleY;
    const smooth = clamp(smoothing, 0.5, 0.98);
    this.smoothX = this.smoothX * smooth + this.cameraX * (1 - smooth);
    this.smoothY = this.smoothY * smooth + this.cameraY * (1 - smooth);
    const amount = clamp(strength, 0, 1);
    const correctionX = (this.smoothX - this.cameraX) * amount;
    const correctionY = (this.smoothY - this.cameraY) * amount;
    const zoom = 1 + clamp(crop, 0, 0.12) * amount;

    this.tempContext.setTransform(1, 0, 0, 1, 0, 0);
    this.tempContext.globalCompositeOperation = 'copy';
    this.tempContext.drawImage(canvas, 0, 0);
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'copy';
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2 + correctionX, canvas.height / 2 + correctionY);
    context.scale(zoom, zoom);
    context.drawImage(this.tempCanvas, -canvas.width / 2, -canvas.height / 2);
    context.restore();

    this.previous = current;
    this.frames++;
    return { applied: Math.abs(correctionX) > .05 || Math.abs(correctionY) > .05, dx: correctionX, dy: correctionY, zoom, sceneCut: false, error: estimate.normalizedError };
  }

  resetPath() { this.cameraX = this.cameraY = this.smoothX = this.smoothY = 0; }
  reset() { this.previous = null; this.resetPath(); this.frames = 0; }
  destroy() { this.reset(); for (const c of [this.sampleCanvas, this.tempCanvas]) if (c) { c.width = 1; c.height = 1; } }

  _ensure(width, height) {
    if (!this.sampleCanvas) {
      this.sampleCanvas = makeCanvas(this.sampleWidth, this.sampleHeight);
      this.sampleContext = this.sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    }
    if (!this.tempCanvas || this.tempCanvas.width !== width || this.tempCanvas.height !== height) {
      this.tempCanvas = makeCanvas(width, height);
      this.tempContext = this.tempCanvas.getContext('2d', { alpha: false });
      this.reset();
    }
  }

  _sample(canvas) {
    this.sampleContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, this.sampleWidth, this.sampleHeight);
    const rgba = this.sampleContext.getImageData(0, 0, this.sampleWidth, this.sampleHeight).data;
    const luma = new Uint8Array(this.sampleWidth * this.sampleHeight);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) luma[p] = (rgba[i] * 54 + rgba[i + 1] * 183 + rgba[i + 2] * 19) >> 8;
    return luma;
  }
}

export function estimateTranslation(previous, current, width, height, radius = 2) {
  let best = { dx: 0, dy: 0, error: Infinity };
  const margin = radius + 2;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    let total = 0, count = 0;
    for (let y = margin; y < height - margin; y += 2) for (let x = margin; x < width - margin; x += 2) {
      const a = previous[y * width + x];
      const b = current[(y + dy) * width + (x + dx)];
      total += Math.abs(a - b); count++;
    }
    const error = total / Math.max(1, count);
    if (error < best.error) best = { dx, dy, error };
  }
  return { ...best, normalizedError: best.error / 255 };
}

function makeCanvas(width, height) { if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height); const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
