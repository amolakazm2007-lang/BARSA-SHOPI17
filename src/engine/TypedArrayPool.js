/**
 * Small bounded typed-array pool for hot per-frame/per-tile paths.
 * It only reuses exact-length buffers, so it cannot change tensor shapes,
 * arithmetic, resolution or export quality. Large pools are intentionally
 * capped to avoid trading GC churn for permanent RAM growth.
 */
export class TypedArrayPool {
  constructor({ maxPerLength = 4, maxRetainedBytes = 32 * 1024 * 1024 } = {}) {
    this.maxPerLength = Math.max(1, Math.floor(maxPerLength));
    this.maxRetainedBytes = Math.max(0, Math.floor(maxRetainedBytes));
    this.buckets = new Map();
    this.retainedBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  acquire(Type, length) {
    const n = Math.max(0, Math.floor(Number(length) || 0));
    const key = `${Type.name}:${n}`;
    const bucket = this.buckets.get(key);
    if (bucket?.length) {
      const array = bucket.pop();
      this.retainedBytes -= array.byteLength;
      this.hits++;
      if (!bucket.length) this.buckets.delete(key);
      return array;
    }
    this.misses++;
    return new Type(n);
  }

  release(array) {
    if (!array?.constructor || !Number.isFinite(array.byteLength) || array.byteLength <= 0) return false;
    if (array.byteLength > this.maxRetainedBytes) return false;
    const key = `${array.constructor.name}:${array.length}`;
    const bucket = this.buckets.get(key) || [];
    if (bucket.length >= this.maxPerLength) return false;
    while (this.retainedBytes + array.byteLength > this.maxRetainedBytes) {
      if (!this._evictOne()) return false;
    }
    bucket.push(array);
    this.buckets.set(key, bucket);
    this.retainedBytes += array.byteLength;
    return true;
  }

  clear() {
    this.buckets.clear();
    this.retainedBytes = 0;
  }

  stats() {
    return { hits: this.hits, misses: this.misses, retainedBytes: this.retainedBytes, bucketCount: this.buckets.size };
  }

  _evictOne() {
    for (const [key, bucket] of this.buckets) {
      const array = bucket.pop();
      if (!array) { this.buckets.delete(key); continue; }
      this.retainedBytes -= array.byteLength;
      if (!bucket.length) this.buckets.delete(key);
      return true;
    }
    return false;
  }
}
