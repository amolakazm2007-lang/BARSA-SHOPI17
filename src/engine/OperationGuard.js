const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  const timer = setTimeout(resolve, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
  signal?.addEventListener?.('abort', onAbort, { once: true });
});

export async function withTimeout(operation, { timeoutMs = 30_000, label = 'operation', signal = null } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason || new DOMException('Aborted', 'AbortError'));
  signal?.addEventListener?.('abort', onAbort, { once: true });
  let timer = null;
  const timeoutError = new DOMException(`${label} timed out after ${timeoutMs}ms`, 'TimeoutError');
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, Math.max(1, timeoutMs));
  });
  try {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const operationPromise = Promise.resolve().then(() => operation(controller.signal));
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timer != null) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export async function retryTransient(operation, {
  attempts = 4,
  baseDelayMs = 250,
  maxDelayMs = 4_000,
  jitterMs = 100,
  signal = null,
  isRetryable = defaultRetryable,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    try {
      return await operation({ attempt, signal });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !isRetryable(error)) throw error;
      const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt)) + Math.random() * Math.max(0, jitterMs);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

export class CircuitBreaker {
  constructor({ failureThreshold = 4, cooldownMs = 30_000 } = {}) {
    this.failureThreshold = Math.max(1, failureThreshold);
    this.cooldownMs = Math.max(1, Number(cooldownMs) || 1);
    this.failures = 0;
    this.openUntil = 0;
    this.state = 'closed';
  }

  async execute(operation) {
    const now = Date.now();
    if (this.state === 'open' && now < this.openUntil) {
      const error = new Error('Circuit breaker is open');
      error.code = 'CIRCUIT_OPEN';
      error.recoverable = true;
      throw error;
    }
    if (this.state === 'open') this.state = 'half-open';
    try {
      const result = await operation();
      this.failures = 0;
      this.openUntil = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold || this.state === 'half-open') {
        this.state = 'open';
        this.openUntil = Date.now() + this.cooldownMs;
      }
      throw error;
    }
  }
}

export function defaultRetryable(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  if (error.code === 'MODEL_SHA_MISMATCH' || error.code === 'MODEL_INVALID' || error.code === 'UNSUPPORTED_CODEC') return false;
  if (error.name === 'TimeoutError' || error.name === 'TypeError') return true;
  const status = Number(error.status || error.statusCode || 0);
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  const message = String(error.message || '').toLowerCase();
  return /temporary|network|offline|connection|fetch|timeout|timed out/.test(message);
}
