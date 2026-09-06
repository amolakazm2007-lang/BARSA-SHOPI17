function normalizeSeverity(value) {
  const severity = String(value || 'warning').toLowerCase();
  if (severity === 'fatal' || severity === 'critical' || severity === 'error') return 'error';
  if (severity === 'info') return 'info';
  return 'warning';
}

function safeDetails(details) {
  if (details == null) return null;
  try { return structuredClone(details); }
  catch {
    try { return JSON.parse(JSON.stringify(details)); }
    catch { return { value: String(details) }; }
  }
}

export class RuntimeFaultLedger {
  constructor({ maxEntries = 200, maxGroups = 80 } = {}) {
    this.maxEntries = Math.max(20, Math.min(1000, Number(maxEntries) || 200));
    this.maxGroups = Math.max(10, Math.min(500, Number(maxGroups) || 80));
    this.entries = [];
    this.groups = new Map();
    this.sequence = 0;
  }

  record({ code = 'UNKNOWN_RUNTIME_FAULT', subsystem = 'runtime', severity = 'warning', jobId = null, recoverable = null, message = '', details = null, source = null } = {}) {
    const now = Date.now();
    const normalizedCode = String(code || 'UNKNOWN_RUNTIME_FAULT').slice(0, 160);
    const normalizedSubsystem = String(subsystem || 'runtime').slice(0, 80);
    const key = `${normalizedSubsystem}:${normalizedCode}`;
    const entry = Object.freeze({
      id: ++this.sequence,
      at: now,
      code: normalizedCode,
      subsystem: normalizedSubsystem,
      severity: normalizeSeverity(severity),
      jobId: jobId || null,
      recoverable: recoverable == null ? null : Boolean(recoverable),
      message: String(message || normalizedCode).slice(0, 800),
      source: source ? String(source).slice(0, 120) : null,
      details: safeDetails(details),
    });
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);

    const group = this.groups.get(key) || {
      key, code: normalizedCode, subsystem: normalizedSubsystem, severity: entry.severity,
      count: 0, firstSeenAt: now, lastSeenAt: now, lastJobId: null, recoverable: entry.recoverable,
      resolvedAt: null, lastMessage: '',
    };
    group.count += 1;
    group.lastSeenAt = now;
    group.lastJobId = entry.jobId;
    group.recoverable = entry.recoverable;
    group.severity = entry.severity === 'error' ? 'error' : group.severity;
    group.lastMessage = entry.message;
    group.resolvedAt = null;
    this.groups.set(key, group);
    this._trimGroups();
    return entry;
  }

  resolve({ code, subsystem = 'runtime' } = {}) {
    const key = `${String(subsystem || 'runtime')}:${String(code || '')}`;
    const group = this.groups.get(key);
    if (!group) return false;
    group.resolvedAt = Date.now();
    return true;
  }

  snapshot({ recentLimit = 40, includeResolved = false } = {}) {
    const groups = [...this.groups.values()]
      .filter((row) => includeResolved || !row.resolvedAt)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((row) => Object.freeze({ ...row }));
    const recent = this.entries.slice(-Math.max(1, Number(recentLimit) || 40)).reverse();
    return Object.freeze({
      totalEvents: this.sequence,
      retainedEvents: this.entries.length,
      activeGroups: groups.length,
      errorGroups: groups.filter((row) => row.severity === 'error').length,
      groups: Object.freeze(groups),
      recent: Object.freeze(recent),
    });
  }

  clear() {
    this.entries.length = 0;
    this.groups.clear();
  }

  _trimGroups() {
    if (this.groups.size <= this.maxGroups) return;
    const oldest = [...this.groups.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    for (const [key] of oldest.slice(0, this.groups.size - this.maxGroups)) this.groups.delete(key);
  }
}
