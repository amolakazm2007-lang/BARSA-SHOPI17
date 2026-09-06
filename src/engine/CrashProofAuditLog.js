export class CrashProofAuditLog {
  constructor({ sink = console, maxEntries = 500 } = {}) {
    this.sink = sink;
    this.maxEntries = Math.max(50, Number(maxEntries) || 500);
    this.entries = [];
  }

  record(level, code, message, details = null) {
    const entry = Object.freeze({
      at: new Date().toISOString(),
      level,
      code,
      message,
      details,
    });
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    this.sink?.[fn]?.(`[BARSA][${code}] ${message}`, details || '');
    return entry;
  }

  info(code, message, details) { return this.record('info', code, message, details); }
  warn(code, message, details) { return this.record('warn', code, message, details); }
  error(code, message, details) { return this.record('error', code, message, details); }

  snapshot() { return this.entries.slice(); }
  clear() { this.entries.length = 0; }
}
