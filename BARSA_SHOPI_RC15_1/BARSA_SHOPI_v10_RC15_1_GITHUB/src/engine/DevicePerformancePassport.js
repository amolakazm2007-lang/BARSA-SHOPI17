const STORAGE_KEY = 'barsa-device-performance-passport-v1';

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function ewma(previous, sample, alpha = 0.2) {
  const s = finite(sample);
  if (s == null) return finite(previous);
  const p = finite(previous);
  return p == null ? s : p + alpha * (s - p);
}
function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Local-only, quality-neutral per-device learning cache.
 * It stores measured execution/storage/provider behavior, never media content.
 */
export class DevicePerformancePassport {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
    this.deviceKey = 'unknown';
    this.data = { version: 1, devices: {} };
    this._load();
  }

  identify(capabilities = {}) {
    const info = capabilities.webGPUAdapterInfo || {};
    const profile = capabilities.deviceProfile || {};
    const parts = [
      profile.id || profile.label || 'generic',
      capabilities.hardwareConcurrency || 1,
      capabilities.deviceMemoryGB || 'na',
      info.vendor || 'nogpu',
      info.architecture || 'na',
      info.maxTextureDimension2D || 'na',
    ];
    this.deviceKey = parts.map(v => String(v).replace(/[^a-z0-9_.-]+/gi, '_')).join('|');
    this._entry();
    this._save();
    return this.deviceKey;
  }

  _entry() {
    const devices = this.data.devices ||= {};
    const entry = devices[this.deviceKey] ||= {
      updatedAt: Date.now(), samples: 0, storage: {}, pressure: {}, providers: {}, stages: {}, failures: {}, codec: {},
    };
    return entry;
  }

  observeStorage({ writeMs, bytes = 0 } = {}) {
    const e = this._entry();
    const ms = Math.max(0.01, finite(writeMs, 0.01));
    const mbps = bytes > 0 ? (bytes / 1048576) / (ms / 1000) : null;
    e.storage.writeMs = ewma(e.storage.writeMs, ms, 0.18);
    if (mbps != null) e.storage.mbps = ewma(e.storage.mbps, mbps, 0.18);
    e.storage.samples = (e.storage.samples || 0) + 1;
    e.updatedAt = Date.now(); e.samples++;
    this._saveMaybe(e.storage.samples);
    return this.storageProfile();
  }

  observePressure({ heapRatio = 0, gpuRatio = 0, thermalRatio = 0 } = {}) {
    const e = this._entry();
    const score = clamp(Math.max(finite(heapRatio, 0), finite(gpuRatio, 0), finite(thermalRatio, 0)), 0, 1);
    e.pressure.ewma = ewma(e.pressure.ewma, score, 0.12);
    e.pressure.peak = Math.max(finite(e.pressure.peak, 0), score);
    e.pressure.samples = (e.pressure.samples || 0) + 1;
    e.updatedAt = Date.now(); e.samples++;
    this._saveMaybe(e.pressure.samples);
    return this.pressureProfile();
  }

  recordProvider(modelId, provider, { latencyMs = null, success = true } = {}) {
    if (!modelId || !provider) return null;
    const e = this._entry();
    const key = `${modelId}::${provider}`;
    const p = e.providers[key] ||= { successes: 0, failures: 0, latencyMs: null, confidence: 0.5 };
    if (success) p.successes++; else p.failures++;
    if (latencyMs != null) p.latencyMs = ewma(p.latencyMs, latencyMs, 0.25);
    const total = p.successes + p.failures;
    const reliability = total ? p.successes / total : 0.5;
    const evidence = 1 - Math.exp(-total / 5);
    p.confidence = Number((0.5 * (1 - evidence) + reliability * evidence).toFixed(4));
    p.updatedAt = Date.now(); e.updatedAt = Date.now(); e.samples++;
    this._save();
    return { ...p };
  }

  noteFailure(component, fingerprint = 'generic') {
    const e = this._entry();
    const key = `${component || 'unknown'}::${fingerprint || 'generic'}`;
    const f = e.failures[key] ||= { count: 0, firstAt: Date.now(), lastAt: null };
    f.count++; f.lastAt = Date.now(); e.updatedAt = Date.now();
    this._save();
    return { ...f };
  }

  storageProfile() { return { ...(this._entry().storage || {}) }; }
  pressureProfile() { return { ...(this._entry().pressure || {}) }; }
  providerProfile() { return { ...(this._entry().providers || {}) }; }

  bestProvider(modelId, candidates = []) {
    const providers = this._entry().providers || {};
    const scored = candidates.map(provider => {
      const p = providers[`${modelId}::${provider}`];
      if (!p || !p.successes) return { provider, score: -Infinity, known: false };
      const latency = Math.max(0.01, finite(p.latencyMs, 1e9));
      const score = (finite(p.confidence, 0.5) * 1000) / latency;
      return { provider, score, known: true, ...p };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.known ? scored[0] : null;
  }

  snapshot() {
    const e = this._entry();
    return structuredCloneSafe({ deviceKey: this.deviceKey, ...e });
  }

  _load() {
    try {
      const parsed = safeJsonParse(this.storage?.getItem?.(STORAGE_KEY), null);
      if (parsed?.version === 1 && parsed.devices && typeof parsed.devices === 'object') this.data = parsed;
    } catch {}
  }
  _saveMaybe(samples) { if ((samples || 0) % 8 === 0) this._save(); }
  _save() { try { this.storage?.setItem?.(STORAGE_KEY, JSON.stringify(this.data)); } catch {} }
}

function structuredCloneSafe(value) {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}
