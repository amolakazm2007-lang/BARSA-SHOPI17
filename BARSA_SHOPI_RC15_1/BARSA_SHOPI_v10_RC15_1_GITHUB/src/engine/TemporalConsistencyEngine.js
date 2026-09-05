/**
 * Motion-adaptive temporal denoise and exposure-flicker suppression.
 *
 * The engine deliberately keeps a bounded, downscaled history surface instead
 * of a full 4K/8K frame. This caps persistent RAM while still removing random
 * frame-to-frame noise in static areas. Scene changes and strong motion disable
 * blending automatically to avoid ghost trails.
 */
export class TemporalConsistencyEngine {
  constructor({ sampleWidth = 64, sampleHeight = 36, maxHistoryPixels = 2_073_600 } = {}) {
    this.sampleWidth = sampleWidth;
    this.sampleHeight = sampleHeight;
    this.maxHistoryPixels = maxHistoryPixels;
    this.sampleCanvas = null;
    this.sampleContext = null;
    this.historyCanvas = null;
    this.historyContext = null;
    this.previousSample = null;
    this.previousMean = null;
    this.historyWidth = 0;
    this.historyHeight = 0;
    this.framesProcessed = 0;
  }

  /**
   * Mutates the supplied canvas in place and returns diagnostic information.
   * @param {OffscreenCanvas|HTMLCanvasElement} canvas
   * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
   * @param {{denoise?:number, antiFlicker?:number, detailStability?:number, sceneThreshold?:number, sceneCut?:boolean}} options
   */
  process(canvas, context, { denoise = 0, antiFlicker = 0, detailStability = 0, sceneThreshold = 0.22, sceneCut: forcedSceneCut = false } = {}) {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height || (!denoise && !antiFlicker && !detailStability)) {
      return { blend: 0, detailBlend: 0, difference: 0, sceneCut: false, exposureCorrection: 1 };
    }
    if (forcedSceneCut) this.reset();
    this._ensureSurfaces(width, height);
    const sample = this._captureSample(canvas);
    const mean = meanLuma(sample);
    const difference = this.previousSample ? meanAbsoluteDifference(sample, this.previousSample) : 0;
    const sceneCut = Boolean(forcedSceneCut || (this.previousSample && difference >= sceneThreshold));
    let exposureCorrection = 1;
    let blend = 0;
    let detailBlend = 0;

    if (this.previousSample && !sceneCut) {
      exposureCorrection = calculateExposureCorrection(mean, this.previousMean, antiFlicker, difference);
      if (Math.abs(exposureCorrection - 1) > 0.002) {
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = exposureCorrection > 1 ? '#fff' : '#000';
        context.globalAlpha = exposureCorrection > 1
          ? Math.min(0.08, exposureCorrection - 1)
          : Math.min(0.08, 1 - exposureCorrection);
        context.fillRect(0, 0, width, height);
        context.restore();
      }

      blend = calculateTemporalBlend(difference, denoise, sceneThreshold);
      detailBlend = calculateTemporalDetailBlend(difference, detailStability, sceneThreshold);
      blend = Math.max(blend, detailBlend);
      if (blend > 0.001) {
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = blend;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(this.historyCanvas, 0, 0, this.historyWidth, this.historyHeight, 0, 0, width, height);
        context.restore();
      }
    }

    this.historyContext.save();
    this.historyContext.setTransform(1, 0, 0, 1, 0, 0);
    this.historyContext.globalCompositeOperation = 'copy';
    this.historyContext.imageSmoothingEnabled = true;
    this.historyContext.imageSmoothingQuality = 'high';
    this.historyContext.drawImage(canvas, 0, 0, width, height, 0, 0, this.historyWidth, this.historyHeight);
    this.historyContext.restore();
    this.previousSample = sample;
    this.previousMean = mean;
    this.framesProcessed++;
    return { blend, detailBlend, difference, sceneCut, exposureCorrection };
  }

  reset() {
    this.previousSample = null;
    this.previousMean = null;
    this.framesProcessed = 0;
    this.historyContext?.clearRect(0, 0, this.historyWidth, this.historyHeight);
  }

  destroy() {
    for (const canvas of [this.sampleCanvas, this.historyCanvas]) {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
    this.sampleCanvas = null;
    this.sampleContext = null;
    this.historyCanvas = null;
    this.historyContext = null;
    this.previousSample = null;
  }

  _ensureSurfaces(width, height) {
    if (!this.sampleCanvas) {
      this.sampleCanvas = makeCanvas(this.sampleWidth, this.sampleHeight);
      this.sampleContext = this.sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    }
    const scale = Math.min(1, Math.sqrt(this.maxHistoryPixels / Math.max(1, width * height)));
    const historyWidth = Math.max(2, Math.round(width * scale / 2) * 2);
    const historyHeight = Math.max(2, Math.round(height * scale / 2) * 2);
    if (!this.historyCanvas || historyWidth !== this.historyWidth || historyHeight !== this.historyHeight) {
      this.historyCanvas = makeCanvas(historyWidth, historyHeight);
      this.historyContext = this.historyCanvas.getContext('2d', { alpha: false });
      this.historyWidth = historyWidth;
      this.historyHeight = historyHeight;
      this.previousSample = null;
    }
  }

  _captureSample(canvas) {
    this.sampleContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, this.sampleWidth, this.sampleHeight);
    return new Uint8ClampedArray(this.sampleContext.getImageData(0, 0, this.sampleWidth, this.sampleHeight).data);
  }
}

/** Motion-adaptive blend. Values are normalized to 0..1. */
export function calculateTemporalBlend(difference, strength, sceneThreshold = 0.22) {
  const amount = clamp(strength, 0, 1);
  if (!amount || difference >= sceneThreshold) return 0;
  const motionGate = 1 - smoothstep(0.018, Math.min(0.12, sceneThreshold), difference);
  return clamp(amount * 0.42 * motionGate, 0, 0.42);
}

/** A restrained history blend for suppressing frame-to-frame detail shimmer. */
export function calculateTemporalDetailBlend(difference, strength, sceneThreshold = 0.22) {
  const amount = clamp(strength, 0, 1);
  if (!amount || difference >= sceneThreshold) return 0;
  const motionGate = 1 - smoothstep(0.012, Math.min(0.075, sceneThreshold), difference);
  return clamp(amount * 0.2 * motionGate, 0, 0.2);
}

/** Restricts anti-flicker to small global exposure changes, not real cuts. */
export function calculateExposureCorrection(currentMean, previousMean, strength, difference) {
  const amount = clamp(strength, 0, 1);
  if (!amount || !Number.isFinite(previousMean) || currentMean < 0.02 || difference > 0.12) return 1;
  const raw = previousMean / currentMean;
  const maximum = 0.08 * amount;
  return clamp(1 + (raw - 1) * amount, 1 - maximum, 1 + maximum);
}

export function meanAbsoluteDifference(a, b) {
  if (!a?.length || a.length !== b?.length) return 1;
  let total = 0;
  for (let index = 0; index < a.length; index += 4) {
    const ay = (a[index] * 54 + a[index + 1] * 183 + a[index + 2] * 19) / (256 * 255);
    const by = (b[index] * 54 + b[index + 1] * 183 + b[index + 2] * 19) / (256 * 255);
    total += Math.abs(ay - by);
  }
  return total / (a.length / 4);
}

function meanLuma(sample) {
  let total = 0;
  for (let index = 0; index < sample.length; index += 4) {
    total += (sample[index] * 54 + sample[index + 1] * 183 + sample[index + 2] * 19) / (256 * 255);
  }
  return total / (sample.length / 4);
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
