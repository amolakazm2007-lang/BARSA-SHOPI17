const DEFAULT_KEY = 'barsa-crash-loop-v1';
const WINDOW_MS = 10 * 60 * 1000;
const FAILURE_THRESHOLD = 3;

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function defaultState() {
  return { failures: [], phase: 'idle', bootId: null, startedAt: 0, lastHealthyAt: 0, lastFailure: null };
}

export class CrashLoopSafeMode {
  constructor({ storage = globalThis.localStorage, key = DEFAULT_KEY, now = () => Date.now() } = {}) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.bootId = null;
    this.safeMode = false;
    this.reason = null;
  }

  beginBoot() {
    const now = this.now();
    const state = this._read();
    let failures = (state.failures || []).filter((time) => now - Number(time) <= WINDOW_MS);
    if (state.phase === 'booting' && state.startedAt && now - Number(state.startedAt) <= WINDOW_MS) {
      failures.push(Number(state.startedAt));
    }
    if (state.phase === 'failed' && state.startedAt && now - Number(state.startedAt) <= WINDOW_MS && !failures.includes(Number(state.startedAt))) {
      failures.push(Number(state.startedAt));
    }
    failures = [...new Set(failures)].sort((a, b) => a - b).slice(-FAILURE_THRESHOLD);
    this.safeMode = failures.length >= FAILURE_THRESHOLD;
    this.reason = this.safeMode ? 'CRASH_LOOP_THRESHOLD' : null;
    this.bootId = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    this._write({ ...state, failures, phase: 'booting', bootId: this.bootId, startedAt: now, lastFailure: state.lastFailure || null });
    return Object.freeze({ safeMode: this.safeMode, reason: this.reason, failures: failures.length, bootId: this.bootId });
  }

  markBootHealthy() {
    const now = this.now();
    const state = this._read();
    if (this.bootId && state.bootId && state.bootId !== this.bootId) return false;
    this._write({ ...state, failures: [], phase: 'healthy', bootId: this.bootId, lastHealthyAt: now, lastFailure: null });
    return true;
  }

  markBootFailure(error, subsystem = 'startup') {
    const now = this.now();
    const state = this._read();
    const startedAt = Number(state.startedAt || now);
    const failures = [...new Set([...(state.failures || []).filter((time) => now - Number(time) <= WINDOW_MS), startedAt])]
      .sort((a, b) => a - b)
      .slice(-FAILURE_THRESHOLD);
    this._write({
      ...state,
      failures,
      phase: 'failed',
      bootId: this.bootId || state.bootId || null,
      lastFailure: {
        at: now,
        subsystem,
        code: error?.code || error?.name || 'STARTUP_FAILURE',
        message: String(error?.message || error || 'Startup failure').slice(0, 500),
      },
    });
    return failures.length;
  }

  snapshot() {
    const state = this._read();
    return Object.freeze({ ...state, safeMode: this.safeMode, reason: this.reason });
  }

  _read() {
    try {
      return { ...defaultState(), ...safeParse(this.storage?.getItem?.(this.key) || '', {}) };
    } catch (error) {
      console.warn('[BARSA][safe-mode][state-read-failed]', error);
      return defaultState();
    }
  }

  _write(state) {
    try {
      this.storage?.setItem?.(this.key, JSON.stringify(state));
    } catch (error) {
      console.warn('[BARSA][safe-mode][state-write-failed]', error);
    }
  }
}

export const CRASH_LOOP_WINDOW_MS = WINDOW_MS;
export const CRASH_LOOP_FAILURE_THRESHOLD = FAILURE_THRESHOLD;
