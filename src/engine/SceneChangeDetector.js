/** Lightweight scene-cut protection for optical-flow interpolation. */
export class SceneChangeDetector {
  constructor({ width = 48, height = 27, threshold = 0.34 } = {}) {
    this.width = width;
    this.height = height;
    this.threshold = threshold;
    this.canvas = new OffscreenCanvas(width, height);
    this.context = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.lastKey = '';
    this.lastResult = false;
    this.lastScore = 0;
  }

  analyze(a, b) {
    const key = `${a.timestamp ?? ''}:${b.timestamp ?? ''}`;
    if (key === this.lastKey) return { score: this.lastScore, cut: this.lastResult };
    this.context.drawImage(a, 0, 0, this.width, this.height);
    const first = this.context.getImageData(0, 0, this.width, this.height);
    this.context.drawImage(b, 0, 0, this.width, this.height);
    const second = this.context.getImageData(0, 0, this.width, this.height);
    this.lastKey = key;
    this.lastScore = sceneChangeScore(first.data, second.data);
    this.lastResult = this.lastScore >= this.threshold;
    return { score: this.lastScore, cut: this.lastResult };
  }

  isSceneCut(a, b) {
    return this.analyze(a, b).cut;
  }

  destroy() {
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.lastKey = '';
    this.lastScore = 0;
  }
}

/** Returns a normalized 0..1 score combining pixel and histogram changes. */
export function sceneChangeScore(first, second) {
  if (first.length !== second.length || first.length < 4) throw new RangeError('Frames must have equal non-empty RGBA buffers');
  const histogramA = new Float64Array(32);
  const histogramB = new Float64Array(32);
  let absoluteDifference = 0;
  const pixels = first.length / 4;
  for (let i = 0; i < first.length; i += 4) {
    const a = Math.round(first[i] * 0.2126 + first[i + 1] * 0.7152 + first[i + 2] * 0.0722);
    const b = Math.round(second[i] * 0.2126 + second[i + 1] * 0.7152 + second[i + 2] * 0.0722);
    absoluteDifference += Math.abs(a - b);
    histogramA[Math.min(31, a >> 3)]++;
    histogramB[Math.min(31, b >> 3)]++;
  }
  let histogramDistance = 0;
  let cumulativeA = 0;
  let cumulativeB = 0;
  for (let i = 0; i < 32; i++) {
    cumulativeA += histogramA[i];
    cumulativeB += histogramB[i];
    histogramDistance += Math.abs(cumulativeA - cumulativeB);
  }
  const pixelScore = absoluteDifference / (pixels * 255);
  const histogramScore = histogramDistance / (pixels * 31);
  return Math.min(1, pixelScore * 0.68 + histogramScore * 0.32);
}
