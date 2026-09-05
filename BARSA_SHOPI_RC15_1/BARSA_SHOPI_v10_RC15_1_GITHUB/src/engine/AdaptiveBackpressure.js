/** Small feedback controller for encoder -> durable writer pressure. */
export class AdaptiveBackpressure {
  constructor({ maxLimit = 3, minLimit = 1, targetWriteMs = 12 } = {}) {
    this.maxLimit = Math.max(1, maxLimit | 0);
    this.minLimit = Math.max(1, Math.min(this.maxLimit, minLimit | 0));
    this.targetWriteMs = Math.max(1, Number(targetWriteMs) || 12);
    this.limit = this.maxLimit;
    this.emaWriteMs = 0;
    this.samples = 0;
    this.fastStreak = 0;
  }

  observeWrite(elapsedMs) {
    const ms = Math.max(0, Number(elapsedMs) || 0);
    this.emaWriteMs = this.samples ? this.emaWriteMs * 0.82 + ms * 0.18 : ms;
    this.samples++;
    if (this.emaWriteMs > this.targetWriteMs * 2.2) {
      this.limit = this.minLimit;
      this.fastStreak = 0;
    } else if (this.emaWriteMs > this.targetWriteMs * 1.35) {
      this.limit = Math.max(this.minLimit, this.limit - 1);
      this.fastStreak = 0;
    } else if (this.emaWriteMs < this.targetWriteMs * 0.7) {
      this.fastStreak++;
      if (this.fastStreak >= 8) {
        this.limit = Math.min(this.maxLimit, this.limit + 1);
        this.fastStreak = 0;
      }
    } else {
      this.fastStreak = 0;
    }
    return this.limit;
  }

  clamp(maxLimit) {
    this.maxLimit = Math.max(this.minLimit, Number(maxLimit) || this.maxLimit);
    this.limit = Math.min(this.limit, this.maxLimit);
    return this.limit;
  }
}
