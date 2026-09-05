/**
 * Lightweight output integrity audit. It samples tiny downscaled frames so
 * clipping, luminance and detail can be monitored without retaining video
 * frames or disturbing the render pipeline.
 */
export class QualityMetricsEngine {
  constructor({ width = 96, height = 54, interval = 30 } = {}) {
    this.width = width;
    this.height = height;
    this.interval = Math.max(1, interval);
    this.canvas = null;
    this.context = null;
    this.reset();
  }

  sample(source, frameIndex) {
    if (frameIndex % this.interval !== 0) return null;
    this.canvas ||= new OffscreenCanvas(this.width, this.height);
    this.context ||= this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.context.drawImage(source, 0, 0, this.width, this.height);
    const metric = analyzeImageData(this.context.getImageData(0, 0, this.width, this.height));
    this.samples.push(metric);
    return metric;
  }

  finalize() {
    return summarizeMetrics(this.samples);
  }

  reset() {
    this.samples = [];
    if (this.context) this.context.clearRect(0, 0, this.width, this.height);
  }

  destroy() {
    this.reset();
    if (this.canvas) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
    this.canvas = null;
    this.context = null;
  }
}

export function analyzeImageData(imageData) {
  const { data, width, height } = imageData;
  if (!data?.length || width < 2 || height < 2) throw new Error('Quality analysis requires a non-empty image');
  const luma = new Float32Array(width * height);
  let total = 0;
  let clipped = 0;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    const value = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    luma[pixel] = value;
    total += value;
    if (value <= 2 || value >= 253) clipped++;
  }
  let edges = 0;
  let laplacian = 0;
  let comparisons = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      edges += Math.abs(luma[index] - luma[index - 1]) + Math.abs(luma[index] - luma[index - width]);
      laplacian += Math.abs(4 * luma[index] - luma[index - 1] - luma[index + 1] - luma[index - width] - luma[index + width]);
      comparisons++;
    }
  }
  return {
    meanLuma: total / luma.length / 255,
    clippingRatio: clipped / luma.length,
    detailIndex: edges / Math.max(1, comparisons * 2) / 255,
    highFrequencyIndex: laplacian / Math.max(1, comparisons) / 255,
  };
}

export function summarizeMetrics(samples) {
  if (!samples.length) return { sampledFrames: 0, score: null, warnings: ['لم تتوفر عينات كافية لتدقيق الصورة'] };
  const average = (key) => samples.reduce((sum, item) => sum + item[key], 0) / samples.length;
  const clippingRatio = average('clippingRatio');
  const meanLuma = average('meanLuma');
  const detailIndex = average('detailIndex');
  const highFrequencyIndex = average('highFrequencyIndex');
  const warnings = [];
  if (clippingRatio > 0.035) warnings.push('قصّ واضح في الظلال أو الإضاءات');
  if (meanLuma < 0.12) warnings.push('الصورة داكنة جداً');
  if (meanLuma > 0.88) warnings.push('الصورة ساطعة جداً');
  if (highFrequencyIndex > 0.32) warnings.push('احتمال حدة أو ضوضاء زائدة');
  const score = Math.round(Math.max(0, Math.min(100,
    100 - clippingRatio * 420 - Math.max(0, highFrequencyIndex - 0.28) * 90
    - Math.max(0, 0.1 - meanLuma) * 120 - Math.max(0, meanLuma - 0.9) * 120,
  )));
  return {
    sampledFrames: samples.length,
    score,
    clippingPercent: clippingRatio * 100,
    meanLuma,
    detailIndex,
    highFrequencyIndex,
    warnings,
    note: 'مؤشر سلامة تقني للعينة وليس VMAF أو حكماً جمالياً على الفيديو',
  };
}
