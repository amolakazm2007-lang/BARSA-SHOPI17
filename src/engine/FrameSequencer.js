// FrameSequencer — pure ordering logic for AI frame interpolation.
// Given a sequence of source frames and an interpolation factor (2 or 4),
// produces the exact plan of what to emit and in what order: original
// frames interleaved with generated ones. Kept separate from any actual
// video/canvas/model code so the ordering logic itself can be unit tested
// directly (see the Node test run alongside this file in development) —
// an off-by-one here would show up as stutter or duplicate/dropped frames
// in the exported video, which is hard to spot by eye but easy to verify
// as an exact sequence of labels.

/**
 * Returns an array describing every frame to emit, in order, for source
 * frames indexed 0..sourceFrameCount-1 at the given interpolation factor.
 * Each entry is either { type: 'source', index: N } or
 * { type: 'generated', betweenIndex: N, t: 0.5|0.25|0.75 } meaning "insert
 * here, generated from source frames N and N+1 at parameter t".
 *
 * For factor=2: source, mid, source, mid, source, ...
 * For factor=4: source, q1, mid, q3, source, q1, mid, q3, source, ...
 * The last source frame has no trailing generated frames (nothing to
 * interpolate toward).
 */
export function planFrameSequence(sourceFrameCount, factor) {
  if (![2, 4].includes(factor)) throw new Error(`Unsupported interpolation factor: ${factor} (only 2 or 4 supported)`);
  if (sourceFrameCount < 1) return [];

  const plan = [];
  for (let i = 0; i < sourceFrameCount; i++) {
    plan.push({ type: 'source', index: i });
    if (i < sourceFrameCount - 1) {
      if (factor === 2) {
        plan.push({ type: 'generated', betweenIndex: i, t: 0.5 });
      } else {
        plan.push({ type: 'generated', betweenIndex: i, t: 0.25 });
        plan.push({ type: 'generated', betweenIndex: i, t: 0.5 });
        plan.push({ type: 'generated', betweenIndex: i, t: 0.75 });
      }
    }
  }
  return plan;
}

/**
 * Executes a plan against real frame data. `getSourceFrame(i)` and
 * `interpolate(i, t)` (called for generated entries — i is the earlier
 * of the pair) are caller-supplied so this stays testable with mocks and
 * usable with real video frames / RIFEEngine in production.
 * `onFrame(frameData, planEntry)` is called once per emitted frame, in
 * order — this is what the caller feeds to the encoder.
 */
export async function executeFrameSequence(sourceFrameCount, factor, { getSourceFrame, interpolate, onFrame }) {
  const plan = planFrameSequence(sourceFrameCount, factor);
  // Cache each source frame only as long as it's needed (current pair),
  // never the whole video — matches the project's memory rules.
  let cached = { index: -1, data: null };
  async function frame(i) {
    if (cached.index === i) return cached.data;
    const data = await getSourceFrame(i);
    cached = { index: i, data };
    return data;
  }

  for (const entry of plan) {
    if (entry.type === 'source') {
      const data = await frame(entry.index);
      await onFrame(data, entry);
    } else {
      const a = await frame(entry.betweenIndex);
      const b = await frame(entry.betweenIndex + 1);
      const generated = await interpolate(a, b, entry.t);
      await onFrame(generated, entry);
    }
  }
}

/**
 * Bounded timestamp-aware queue used by the live processing pipeline.
 * Timestamps are expressed in microseconds, matching WebCodecs.
 */
export class FrameSequencer {
  constructor({ sourceFps, targetFps = sourceFps, maxQueueSize = 4 } = {}) {
    if (!(sourceFps > 0) || !(targetFps > 0)) throw new RangeError('sourceFps and targetFps must be positive');
    this.sourceFps = sourceFps;
    this.targetFps = targetFps;
    this.sourceDurationUs = 1_000_000 / sourceFps;
    this.targetDurationUs = 1_000_000 / targetFps;
    this.maxQueueSize = Math.max(2, maxQueueSize);
    this.queue = [];
    this.nextOutputTimestamp = 0;
    this.closed = false;
    this._waiters = [];
  }

  async push(frame, { timestamp = frame.timestamp, duration = frame.duration } = {}) {
    if (this.closed) throw new Error('FrameSequencer is closed');
    while (this.queue.length >= this.maxQueueSize) {
      await new Promise((resolve) => this._waiters.push(resolve));
    }
    const entry = {
      frame,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      duration: Number.isFinite(duration) ? duration : this.sourceDurationUs,
    };
    const index = this.queue.findIndex((item) => item.timestamp > entry.timestamp);
    if (index === -1) this.queue.push(entry);
    else this.queue.splice(index, 0, entry);
  }

  /**
   * Emits output points that lie between two source frames. The caller owns
   * returned frames and must close them. interpolate receives t in [0, 1].
   */
  async drainPair(interpolate = null) {
    if (this.queue.length < 2) return [];
    const a = this.queue[0];
    const b = this.queue[1];
    const output = [];
    if (this.nextOutputTimestamp < a.timestamp) this.nextOutputTimestamp = a.timestamp;

    while (this.nextOutputTimestamp < b.timestamp - 0.5) {
      const t = Math.max(0, Math.min(1, (this.nextOutputTimestamp - a.timestamp) / Math.max(1, b.timestamp - a.timestamp)));
      let frame;
      let generated = false;
      if (t < 1e-6) frame = a.frame.clone();
      else if (interpolate) {
        frame = await interpolate(a.frame, b.frame, t, this.nextOutputTimestamp);
        generated = true;
      } else {
        frame = (t < 0.5 ? a.frame : b.frame).clone();
      }
      output.push({
        frame,
        timestamp: Math.round(this.nextOutputTimestamp),
        duration: Math.round(this.targetDurationUs),
        generated,
        t,
      });
      this.nextOutputTimestamp += this.targetDurationUs;
    }

    const consumed = this.queue.shift();
    consumed.frame.close();
    this._waiters.shift()?.();
    return output;
  }

  async flush(interpolate = null) {
    const output = [];
    while (this.queue.length >= 2) output.push(...await this.drainPair(interpolate));
    if (this.queue.length === 1) {
      const last = this.queue.shift();
      if (this.nextOutputTimestamp <= last.timestamp + last.duration) {
        output.push({
          frame: last.frame.clone(),
          timestamp: Math.round(Math.max(this.nextOutputTimestamp, last.timestamp)),
          duration: Math.round(this.targetDurationUs),
          generated: false,
          t: 0,
        });
      }
      last.frame.close();
    }
    this.closed = true;
    this._waiters.splice(0).forEach((resolve) => resolve());
    return output;
  }

  cancel() {
    this.closed = true;
    this.queue.splice(0).forEach(({ frame }) => frame.close());
    this._waiters.splice(0).forEach((resolve) => resolve());
  }

  static estimateOutputFrameCount(sourceFrameCount, sourceFps, targetFps) {
    if (sourceFrameCount <= 0) return 0;
    return Math.max(1, Math.round((sourceFrameCount - 1) * targetFps / sourceFps) + 1);
  }
}
