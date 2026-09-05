/**
 * FrameIntegrityMonitor
 * Constant-memory accounting for decoded -> processed -> encoded video.
 * It never attempts to "hide" missing frames. In strict mode any silent gap,
 * duplicate output timestamp, or frame-accounting mismatch aborts the job.
 */
export class FrameIntegrityMonitor {
  constructor({ sourceFps, targetFps, strict = true, gapToleranceUs = 2500 } = {}) {
    if (!(sourceFps > 0) || !(targetFps > 0)) throw new RangeError('sourceFps and targetFps must be positive');
    this.sourceFps = sourceFps;
    this.targetFps = targetFps;
    this.strict = strict !== false;
    this.gapToleranceUs = Math.max(250, Number(gapToleranceUs) || 2500);
    this.decoded = 0;
    this.processed = 0;
    this.encoded = 0;
    this.sourceFirstTimestamp = null;
    this.sourceLastTimestamp = null;
    this.sourceLastEnd = null;
    this.sourceGaps = 0;
    this.sourceGapUs = 0;
    this.sourceNonMonotonic = 0;
    this.outputLastTimestamp = null;
    this.outputNonMonotonic = 0;
    this.outputMissing = 0;
    this.expectedOutputDelta = 1_000_000 / targetFps;
  }

  seedResume({ decodedFrames = 0, processedFrames = decodedFrames, encodedFrames = 0, lastOutputTimestamp = null } = {}) {
    this.decoded = Math.max(0, Number(decodedFrames) || 0);
    this.processed = Math.max(0, Number(processedFrames) || 0);
    this.encoded = Math.max(0, Number(encodedFrames) || 0);
    this.outputLastTimestamp = Number.isFinite(Number(lastOutputTimestamp)) ? Number(lastOutputTimestamp) : null;
    this.resumed = this.encoded > 0 || this.decoded > 0;
  }

  observeDecoded(timestamp, duration) {
    const ts = Number(timestamp);
    const dur = Math.max(1, Number(duration) || (1_000_000 / this.sourceFps));
    if (!Number.isFinite(ts)) throw new Error('Decoded frame timestamp is not finite');
    if (this.sourceFirstTimestamp == null) this.sourceFirstTimestamp = ts;
    if (this.sourceLastTimestamp != null && ts < this.sourceLastTimestamp) this.sourceNonMonotonic++;
    if (this.sourceLastEnd != null && ts > this.sourceLastEnd + this.gapToleranceUs) {
      this.sourceGaps++;
      this.sourceGapUs += ts - this.sourceLastEnd;
    }
    this.sourceLastTimestamp = ts;
    this.sourceLastEnd = Math.max(this.sourceLastEnd ?? ts, ts + dur);
    this.decoded++;
  }

  observeProcessed() {
    this.processed++;
    if (this.processed > this.decoded) throw new Error('Frame accounting error: processed frames exceed decoded frames');
  }

  observeEncoded(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) throw new Error('Encoded frame timestamp is not finite');
    if (this.outputLastTimestamp != null) {
      const delta = ts - this.outputLastTimestamp;
      if (delta <= 0) this.outputNonMonotonic++;
      else if (delta > this.expectedOutputDelta * 1.5) {
        this.outputMissing += Math.max(1, Math.round(delta / this.expectedOutputDelta) - 1);
      }
    }
    this.outputLastTimestamp = ts;
    this.encoded++;
  }

  finalize({ outputDurationUs = null, blurEnabled = false } = {}) {
    if (!this.decoded) throw new Error('Frame-perfect render received no decoded video frames');
    if (this.processed !== this.decoded) {
      throw new Error(`Frame loss before sequencing: decoded=${this.decoded}, processed=${this.processed}`);
    }
    if (!this.encoded) throw new Error('Frame-perfect render encoded no video frames');
    if (this.outputNonMonotonic || this.outputMissing) {
      throw new Error(`Output frame integrity failed: ${this.outputNonMonotonic} non-monotonic, ${this.outputMissing} missing`);
    }
    // A source timeline gap can be legitimate VFR/edit-list timing. The CFR
    // sequencer fills the timeline rather than skipping output. Keep it in the
    // report but only fail non-monotonic source presentation ordering.
    if (this.strict && this.sourceNonMonotonic) {
      throw new Error(`Source frame order is invalid: ${this.sourceNonMonotonic} non-monotonic timestamps`);
    }
    if (Number.isFinite(outputDurationUs) && outputDurationUs > 0 && !blurEnabled) {
      const expected = Math.max(1, Math.floor((outputDurationUs - 1) / this.expectedOutputDelta) + 1);
      // Duration metadata may end between frame boundaries. Only a deficit is
      // dangerous; a single terminal frame difference is normal container math.
      if (this.strict && this.encoded + 1 < expected) {
        throw new Error(`Output frame count is short: encoded=${this.encoded}, expected≈${expected}`);
      }
    }
    return {
      valid: true,
      strict: this.strict,
      resumed: Boolean(this.resumed),
      decodedFrames: this.decoded,
      processedSourceFrames: this.processed,
      encodedFrames: this.encoded,
      sourceGaps: this.sourceGaps,
      sourceGapUs: Math.round(this.sourceGapUs),
      sourceNonMonotonic: this.sourceNonMonotonic,
      outputNonMonotonic: this.outputNonMonotonic,
      outputMissing: this.outputMissing,
    };
  }
}
