/** Keeps long local renders awake without blocking normal page lifecycle. */
export class DeviceGuard {
  constructor() {
    this.active = false;
    this.lock = null;
    this._onVisibility = () => { if (this.active && document.visibilityState === 'visible') this._request().catch(() => {}); };
  }

  async acquire() {
    this.active = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    await this._request();
    return Boolean(this.lock);
  }

  async _request() {
    if (!navigator.wakeLock?.request || this.lock) return;
    this.lock = await navigator.wakeLock.request('screen').catch(() => null);
    this.lock?.addEventListener('release', () => { this.lock = null; }, { once: true });
  }

  async release() {
    this.active = false;
    document.removeEventListener('visibilitychange', this._onVisibility);
    await this.lock?.release().catch(() => {});
    this.lock = null;
  }
}
