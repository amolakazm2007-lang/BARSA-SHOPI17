const ROLE_MAP = Object.freeze({
  upscale: { quick: 'quickUpscaleModel', source: 'upscaleModelProfile', state: 'upscaleModelState' },
  rife: { quick: 'quickRifeModel', source: 'rifeModelProfile', state: 'rifeModelState' },
  face: { quick: 'quickFaceModel', source: 'faceModelProfile', state: 'faceModelState' },
});

export class ModelQuickUI {
  constructor({ toast = () => {}, refresh = () => {} } = {}) {
    this.toast = toast;
    this.refresh = refresh;
    this.observers = [];
    this.progressClock = new Map();
  }

  mount() {
    for (const [role, cfg] of Object.entries(ROLE_MAP)) this._wireRole(role, cfg);
    this._id('quickModelsPrepare')?.addEventListener('click', () => this._id('fullModelsBtn')?.click());
    this._id('quickModelsManage')?.addEventListener('click', () => this._id('modelsBtn')?.click());
    this._id('quickModelsRepair')?.addEventListener('click', async () => {
      this.toast('يفتح مركز النماذج للإصلاح المتقدم؛ الاختيار يبقى يدوي 100%');
      this._id('modelsBtn')?.click();
    });
    this.refreshState();
  }

  refreshState() {
    for (const cfg of Object.values(ROLE_MAP)) {
      const source = this._id(cfg.source), quick = this._id(cfg.quick), state = this._id(cfg.state);
      if (source && quick) quick.value = source.value;
      const quickState = this._id(`${cfg.quick}State`);
      if (quickState && state) quickState.textContent = state.textContent || 'يفحص…';
    }
  }

  updateProgress(role, event = {}) {
    const cfg = ROLE_MAP[role];
    if (!cfg) return;
    const counter = this._id(`${cfg.quick}Progress`);
    const bar = this._id(`${cfg.quick}Bar`);
    const fill = bar?.querySelector('i');
    if (!counter || !bar) return;
    const pctRaw = Number(event.pct);
    const hasPct = Number.isFinite(pctRaw);
    const pct = hasPct ? Math.max(0, Math.min(100, Math.round(pctRaw * 100))) : null;
    const received = Number(event.received || 0);
    const total = Number(event.total || 0);
    const activeStages = new Set(['source', 'download', 'downloading', 'installing', 'verify', 'importing', 'trying']);
    const done = ['model-ready', 'ready', 'verified', 'complete'].includes(event.stage);
    const failed = ['model-error', 'error'].includes(event.stage);
    const active = activeStages.has(event.stage) || (hasPct && pct < 100);
    if (done) {
      counter.hidden = false; bar.hidden = false; bar.classList.remove('indeterminate');
      counter.textContent = '100% ✓'; if (fill) fill.style.width = '100%';
      setTimeout(() => { counter.hidden = true; bar.hidden = true; }, 1800);
      return;
    }
    if (failed) {
      counter.hidden = false; bar.hidden = true; counter.textContent = 'فشل';
      return;
    }
    if (!active) { counter.hidden = true; bar.hidden = true; return; }
    counter.hidden = false; bar.hidden = false;
    if (hasPct) {
      bar.classList.remove('indeterminate'); if (fill) fill.style.width = `${pct}%`;
      const eta = this._eta(role, received, total);
      counter.textContent = total > 0 && received > 0 ? `${pct}% · ${this._bytes(received)}/${this._bytes(total)}${eta ? ` · ${eta}` : ''}` : `${pct}%`;
    } else {
      bar.classList.add('indeterminate'); counter.textContent = received > 0 ? this._bytes(received) : '…';
    }
  }

  _eta(role, received, total) {
    if (!(received > 0 && total > received)) return '';
    const now = performance.now?.() || Date.now();
    const prev = this.progressClock.get(role);
    this.progressClock.set(role, { t: now, received });
    if (!prev || received <= prev.received || now <= prev.t) return '';
    const speed = (received - prev.received) / ((now - prev.t) / 1000);
    if (!(speed > 0)) return '';
    const seconds = Math.ceil((total - received) / speed);
    if (!Number.isFinite(seconds) || seconds > 24 * 3600) return '';
    if (seconds < 60) return `باقي ~${seconds}ث`;
    const minutes = Math.ceil(seconds / 60);
    return `باقي ~${minutes}د`;
  }

  _bytes(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 ** 2) return `${(n / (1024 ** 2)).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)}MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
    return `${n}B`;
  }

  _wireRole(role, cfg) {
    const source = this._id(cfg.source), quick = this._id(cfg.quick), state = this._id(cfg.state);
    if (!source || !quick) return;
    quick.innerHTML = source.innerHTML;
    quick.value = source.value;
    quick.addEventListener('change', () => {
      source.value = quick.value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
      this.toast(`تم اختيار نموذج ${this._label(quick)} يدوياً`);
      this.refresh?.();
    });
    source.addEventListener('change', () => { quick.value = source.value; });
    if (state && 'MutationObserver' in window) {
      const observer = new MutationObserver(() => this.refreshState());
      observer.observe(state, { childList: true, subtree: true, characterData: true });
      this.observers.push(observer);
    }
  }

  _label(select) { return select.options?.[select.selectedIndex]?.textContent?.trim() || select.value; }
  _id(id) { return document.getElementById(id); }
}
