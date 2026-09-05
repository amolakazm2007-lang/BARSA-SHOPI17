/** Constant-memory diagnostics for long renders. It samples counters only. */
export class RenderStabilityMonitor {
  constructor({ sampleEveryFrames = 120 } = {}) {
    this.sampleEveryFrames = Math.max(1, sampleEveryFrames);
    this.startedAt = performance.now();
    this.startHeapMB = heapMB();
    this.peakHeapMB = this.startHeapMB;
    this.lastHeapMB = this.startHeapMB;
    this.samples = 0;
    this.frames = 0;
    this.peakEncoderQueue = 0;
  }

  sample(frameIndex, encoderQueue = 0) {
    this.frames = Math.max(this.frames, frameIndex);
    this.peakEncoderQueue = Math.max(this.peakEncoderQueue, Number(encoderQueue) || 0);
    if (frameIndex % this.sampleEveryFrames !== 0) return;
    const current = heapMB();
    if (current != null) {
      this.lastHeapMB = current;
      this.peakHeapMB = Math.max(this.peakHeapMB ?? current, current);
    }
    this.samples++;
  }

  finalize() {
    const endHeapMB = heapMB();
    const heapGrowthMB = this.startHeapMB != null && endHeapMB != null ? endHeapMB - this.startHeapMB : null;
    return {
      elapsedSeconds: (performance.now() - this.startedAt) / 1000,
      frames: this.frames,
      samples: this.samples,
      startHeapMB: this.startHeapMB,
      endHeapMB,
      peakHeapMB: this.peakHeapMB,
      heapGrowthMB,
      peakEncoderQueue: this.peakEncoderQueue,
      memoryMeasurement: this.startHeapMB == null ? 'browser-unavailable' : 'performance.memory',
    };
  }
}

function heapMB() {
  const bytes = performance.memory?.usedJSHeapSize;
  return Number.isFinite(bytes) ? bytes / 1048576 : null;
}
