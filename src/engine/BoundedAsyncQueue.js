function abortError(signal) {
  return signal?.reason || new DOMException('Operation aborted', 'AbortError');
}

/** A small bounded FIFO used to prevent decode/AI/encode stages from outrunning each other. */
export class BoundedAsyncQueue {
  constructor(capacity = 2) {
    this.capacity = Math.max(1, Number(capacity) || 1);
    this.items = [];
    this.pushWaiters = [];
    this.popWaiters = [];
    this.closed = false;
    this.closeReason = null;
  }

  get size() { return this.items.length; }

  async push(value, { signal } = {}) {
    this._throwIfClosed();
    if (signal?.aborted) throw abortError(signal);
    while (this.items.length >= this.capacity) {
      await this._wait(this.pushWaiters, signal);
      this._throwIfClosed();
    }
    this.items.push(value);
    this._wakeOne(this.popWaiters);
  }

  async pop({ signal } = {}) {
    if (signal?.aborted) throw abortError(signal);
    while (!this.items.length) {
      if (this.closed) return null;
      await this._wait(this.popWaiters, signal);
    }
    const value = this.items.shift();
    this._wakeOne(this.pushWaiters);
    return value;
  }

  close(reason = null) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    this._wakeAll(this.pushWaiters);
    this._wakeAll(this.popWaiters);
  }

  clear(dispose = null) {
    if (typeof dispose === 'function') {
      for (const item of this.items) {
        try { dispose(item); } catch {}
      }
    }
    this.items.length = 0;
    this._wakeAll(this.pushWaiters);
  }

  _throwIfClosed() {
    if (!this.closed) return;
    if (this.closeReason instanceof Error) throw this.closeReason;
    throw new Error(this.closeReason ? String(this.closeReason) : 'Queue is closed');
  }

  _wait(list, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.('abort', onAbort);
        fn(value);
      };
      const waiter = () => finish(resolve);
      const onAbort = () => {
        const index = list.indexOf(waiter);
        if (index >= 0) list.splice(index, 1);
        finish(reject, abortError(signal));
      };
      list.push(waiter);
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  _wakeOne(list) { list.shift()?.(); }
  _wakeAll(list) { while (list.length) list.shift()?.(); }
}
