/** Quality-neutral durable-write governor. It changes only queue depth. */
export class StorageGovernor {
  constructor({ passport = null } = {}) {
    this.passport = passport;
    this.ewmaWriteMs = null;
    this.ewmaMBps = null;
    this.fastStreak = 0;
    this.slowStreak = 0;
  }

  seedFromPassport() {
    const p = this.passport?.storageProfile?.() || {};
    this.ewmaWriteMs = Number.isFinite(Number(p.writeMs)) ? Number(p.writeMs) : null;
    this.ewmaMBps = Number.isFinite(Number(p.mbps)) ? Number(p.mbps) : null;
    return this.snapshot();
  }

  observeWrite(elapsedMs, bytes = 0) {
    const ms = Math.max(0.01, Number(elapsedMs) || 0.01);
    const mbps = bytes > 0 ? (bytes / 1048576) / (ms / 1000) : null;
    this.ewmaWriteMs = this.ewmaWriteMs == null ? ms : this.ewmaWriteMs * 0.82 + ms * 0.18;
    if (mbps != null) this.ewmaMBps = this.ewmaMBps == null ? mbps : this.ewmaMBps * 0.82 + mbps * 0.18;
    if (ms >= 40) { this.slowStreak++; this.fastStreak = 0; }
    else if (ms <= 12) { this.fastStreak++; this.slowStreak = 0; }
    else { this.fastStreak = Math.max(0, this.fastStreak - 1); this.slowStreak = Math.max(0, this.slowStreak - 1); }
    this.passport?.observeStorage?.({ writeMs: ms, bytes });
    return this.snapshot();
  }

  queueCap(defaultCap = 3) {
    const cap = Math.max(1, Number(defaultCap) || 1);
    if (this.slowStreak >= 2 || (this.ewmaWriteMs != null && this.ewmaWriteMs >= 35)) return 1;
    if (this.ewmaWriteMs != null && this.ewmaWriteMs >= 20) return Math.min(2, cap);
    return cap;
  }

  snapshot() { return { ewmaWriteMs: this.ewmaWriteMs, ewmaMBps: this.ewmaMBps, fastStreak: this.fastStreak, slowStreak: this.slowStreak }; }
}
