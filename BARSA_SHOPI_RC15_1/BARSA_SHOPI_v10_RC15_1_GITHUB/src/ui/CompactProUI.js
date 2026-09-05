const GROUPS = Object.freeze({
  restore: {
    toggle: 'cp-restore-on', strength: 'cp-restore-strength', output: 'cp-restore-out',
    stages: {
      denoise: .90, temporalDenoise: .82, deblock: .84, deband: .66,
      artifactRemoval: .88, chromaDenoise: .80, mosquitoNoise: .76, compressionRecovery: 1.00,
    },
  },
  detail: {
    toggle: 'cp-detail-on', strength: 'cp-detail-strength', output: 'cp-detail-out',
    stages: {
      detailRecovery: 1.00, fineDetailRecovery: .94, textureRecovery: .96, microTexture: .90,
      structureRecovery: .96, detailFusion: 1.00, edgeRecovery: .82,
    },
  },
  sharp: {
    toggle: 'cp-sharp-on', strength: 'cp-sharp-strength', output: 'cp-sharp-out',
    stages: { clarity: .62, localContrast: .52, smartSharpen: .76, dehalo: .42, antiRinging: .48 },
  },
});

const STACK = Object.freeze([
  ['restore','تنظيف الجودة','cp-restore-on'],
  ['detail','استعادة التفاصيل','cp-detail-on'],
  ['sharp','الحدة والوضوح','cp-sharp-on'],
  ['face','الوجوه والبورتريه','cp-face-on'],
  ['motion','الحركة والنعومة','cp-motion-on'],
  ['stabilize','تثبيت الفيديو','cp-stabilize-on'],
  ['color','الألوان','cp-color-on'],
]);

export class CompactProUI {
  constructor({ labs, toast = () => {}, onChange = () => {} } = {}) {
    this.labs = labs;
    this.toast = toast;
    this.onChange = onChange;
  }

  mount() {
    for (const [name, cfg] of Object.entries(GROUPS)) {
      this._wireRange(cfg, value => this._applyQualityGroup(name, value));
      const toggle = this._id(cfg.toggle);
      toggle?.addEventListener('change', () => this._applyQualityGroup(name, this._value(cfg.strength)));
      this._applyQualityGroup(name, this._value(cfg.strength), false);
    }
    this._wireFace();
    this._wireMotion();
    this._wireStabilization();
    this._wireColor();
    document.querySelectorAll('[data-compact-advanced]').forEach(button => button.addEventListener('click', () => {
      document.body.classList.add('show-advanced-enhance');
      this.labs?.setActiveLab(button.dataset.compactAdvanced || 'quality');
      document.getElementById('engineLabsMount')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    this._id('compactAdvancedToggle')?.addEventListener('click', () => {
      const enabled = document.body.classList.toggle('show-advanced-enhance');
      this._id('compactAdvancedToggle').textContent = enabled ? 'إخفاء جميع الإعدادات المتقدمة' : 'إظهار جميع الإعدادات المتقدمة';
      if (enabled) document.getElementById('engineLabsMount')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    this._renderStack();
  }

  _wireRange(cfg, apply) {
    const range = this._id(cfg.strength), out = this._id(cfg.output);
    if (!range) return;
    const sync = () => { if (out) out.value = `${Math.round(this._value(cfg.strength))}%`; apply(this._value(cfg.strength)); };
    range.addEventListener('input', sync);
    range.addEventListener('change', sync);
    sync();
  }

  _applyQualityGroup(name, percent, notify = true) {
    const cfg = GROUPS[name];
    if (!cfg) return;
    const enabled = this._checked(cfg.toggle);
    const strength = Math.max(0, Math.min(1, Number(percent || 0) / 100));
    for (const [id, target] of Object.entries(cfg.stages)) this._setStage(id, enabled, Math.min(1, target * (.55 + .62 * strength)));
    if (notify) this._changed();
  }

  _wireFace() {
    const toggle = this._id('cp-face-on'), range = this._id('cp-face-strength'), out = this._id('cp-face-out');
    const apply = () => {
      const enabled = !!toggle?.checked, s = Math.max(0, Math.min(1, Number(range?.value || 0) / 100));
      if (out) out.value = `${Math.round(s * 100)}%`;
      this._check('faceEnabled', enabled); this._check('fl-detection', enabled);
      const map = { detail: .98, cleanup: .62, smoothing: .24, microcontrast: .72, toneprotect: 1.00, eyedetail: .90, hairdetail: .84 };
      for (const [id, target] of Object.entries(map)) this._setStage(`fl-${id}`, enabled, target * (.45 + .65 * s), true);
      this._setValue('faceStrength', enabled ? .55 + .42 * s : 0);
      this._changed();
    };
    toggle?.addEventListener('change', apply); range?.addEventListener('input', apply); range?.addEventListener('change', apply); apply();
  }

  _wireMotion() {
    const toggle = this._id('cp-motion-on'), range = this._id('cp-motion-strength'), out = this._id('cp-motion-out');
    const apply = () => {
      const enabled = !!toggle?.checked, s = Math.max(0, Math.min(1, Number(range?.value || 0) / 100));
      if (out) out.value = `${Math.round(s * 100)}%`;
      this._check('rifeEnabled', enabled); this._check('protectSceneCuts', true);
      this._check('temporalMasterEnabled', enabled); this._setValue('temporalMasterStrength', .48 + .48 * s);
      this._check('tr-enabled', enabled); this._setValue('tr-strength', .38 + .52 * s);
      this._setStage('antiFlicker', enabled, .44 + .46 * s);
      this._setStage('temporalDetailStability', enabled, .58 + .40 * s);
      this._changed();
    };
    toggle?.addEventListener('change', apply); range?.addEventListener('input', apply); range?.addEventListener('change', apply); apply();
  }

  _wireStabilization() {
    const toggle = this._id('cp-stabilize-on'), range = this._id('cp-stabilize-strength'), out = this._id('cp-stabilize-out');
    const apply = () => {
      const enabled = !!toggle?.checked, s = Math.max(0, Math.min(1, Number(range?.value || 0) / 100));
      if (out) out.value = `${Math.round(s * 100)}%`;
      this._check('st-enabled', enabled); this._setValue('st-strength', .34 + .64 * s);
      this._setValue('st-crop', .025 + .045 * s); this._setValue('st-max-shift', Math.round(10 + 22 * s)); this._setValue('st-smoothing', .80 + .17 * s);
      this._changed();
    };
    toggle?.addEventListener('change', apply); range?.addEventListener('input', apply); range?.addEventListener('change', apply); apply();
  }

  _wireColor() {
    const toggle = this._id('cp-color-on'), range = this._id('cp-color-strength'), out = this._id('cp-color-out');
    const apply = () => {
      const enabled = !!toggle?.checked, s = Math.max(0, Math.min(1, Number(range?.value || 0) / 100));
      if (out) out.value = `${Math.round(s * 100)}%`;
      this._check('cl-enabled', enabled);
      this._setValue('cl-contrast', enabled ? 1 + .12 * s : 1);
      this._setValue('cl-vibrance', enabled ? .20 * s : 0);
      this._setValue('cl-saturation', enabled ? 1 + .06 * s : 1);
      this._setValue('cl-clarity', enabled ? .18 * s : 0);
      this._setValue('cl-dehaze', enabled ? .10 * s : 0);
      this._changed();
    };
    toggle?.addEventListener('change', apply); range?.addEventListener('input', apply); range?.addEventListener('change', apply); apply();
  }

  _setStage(id, enabled, value, fullId = false) {
    const base = fullId ? id : `ql-${id}`;
    this._check(`${base}-on`, enabled);
    this._setValue(base, value);
    const num = document.querySelector(`[data-sync-range="${base}"]`);
    if (num) num.value = Number(value).toFixed(2);
    const out = this._id(`${base}-out`); if (out) out.value = Number(value).toFixed(2);
  }

  _setValue(id, value) {
    const el = this._id(id); if (!el) return;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _check(id, checked) { const el = this._id(id); if (!el) return; el.checked = !!checked; el.dispatchEvent(new Event('change', { bubbles: true })); }
  _value(id) { return Number(this._id(id)?.value || 0); }
  _checked(id) { return !!this._id(id)?.checked; }
  _id(id) { return document.getElementById(id); }
  _changed() { this._renderStack(); this.onChange?.(); }

  _renderStack() {
    const host = this._id('compactActiveStack');
    const count = this._id('compactActiveCount');
    if (!host) return;
    const active = STACK.filter(([, , toggle]) => this._checked(toggle));
    host.innerHTML = active.length
      ? active.map(([key, label]) => `<span class="compact-stack-chip" data-stack="${key}">${label}</span>`).join('<i>←</i>')
      : '<span class="compact-stack-empty">لا توجد معالجة مفعّلة</span>';
    if (count) count.textContent = `${active.length} مفعّل`;
  }
}
