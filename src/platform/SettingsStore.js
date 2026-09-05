const KEY = 'barsa.shopi.settings.v8';
const VERSION = 1;

export class SettingsStore {
  constructor({ key = KEY } = {}) { this.key = key; this.timer = null; }

  save(payload) {
    if (!payload || typeof payload !== 'object') return false;
    try {
      localStorage.setItem(this.key, JSON.stringify({ version: VERSION, savedAt: Date.now(), payload }));
      return true;
    } catch { return false; }
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== VERSION || !parsed?.payload) return null;
      return parsed.payload;
    } catch { return null; }
  }

  clear() {
    try { localStorage.removeItem(this.key); return true; } catch { return false; }
  }

  schedule(payloadFactory, delay = 450) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try { this.save(payloadFactory()); } catch {}
    }, delay);
  }
}

export const SETTINGS_STORE_KEY = KEY;
