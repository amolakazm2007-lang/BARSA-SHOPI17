import { STAGE_DEFAULTS } from '../engine/QualityEngine.js';

const QUALITY_مراحل = [
  ['denoise', 'إزالة الضوضاء', 1],
  ['temporalDenoise', 'إزالة الضوضاء الزمنية', 1],
  ['deblock', 'إزالة تكسّر الضغط', 1],
  ['deband', 'تنعيم التدرجات', 1],
  ['artifactRemoval', 'إزالة آثار الضغط', 1],
  ['chromaDenoise', 'إزالة ضوضاء اللون V3', 1],
  ['mosquitoNoise', 'إزالة ضوضاء الحواف V3', 1],
  ['compressionRecovery', 'إنقاذ الضغط V3', 1.5],
  ['detailRecovery', 'استعادة التفاصيل', 1.5],
  ['fineDetailRecovery', 'استعادة التفاصيل الدقيقة', 1.5],
  ['textureRecovery', 'استعادة النسيج', 1.5],
  ['microTexture', 'النسيج الدقيق V2', 1.5],
  ['structureRecovery', 'استعادة البنية V2', 1.5],
  ['detailFusion', 'دمج التفاصيل متعدد المقاييس V3', 1.5],
  ['edgeRecovery', 'استعادة الحواف', 1.5],
  ['clarity', 'الوضوح', 1],
  ['localContrast', 'التباين الموضعي', 1],
  ['smartSharpen', 'حدة ذكية', 1.5],
  ['dehalo', 'إزالة الهالات', 1],
  ['antiRinging', 'منع الرنين حول الحواف', 1],
  ['antiFlicker', 'منع الوميض', 1],
  ['temporalDetailStability', 'ثبات التفاصيل زمنياً', 1],
];

const DEFAULT_ON = new Set(['denoise', 'temporalDenoise', 'detailRecovery', 'smartSharpen', 'antiFlicker']);
const QUALITY_GROUPS = [
  { id: 'restore', title: 'الاستعادة', subtitle: 'تنظيف المصدر وإزالة الضغط', stages: ['denoise','temporalDenoise','deblock','deband','artifactRemoval','chromaDenoise','mosquitoNoise','compressionRecovery'] },
  { id: 'detail', title: 'التفاصيل', subtitle: 'استعادة التفاصيل والملمس', stages: ['detailRecovery','fineDetailRecovery','textureRecovery','microTexture','structureRecovery','detailFusion','edgeRecovery'] },
  { id: 'clarity', title: 'الوضوح', subtitle: 'وضوح وتباين محلي', stages: ['clarity','localContrast'] },
  { id: 'sharp', title: 'الحدة', subtitle: 'حدة ذكية وحماية الحواف', stages: ['smartSharpen','dehalo','antiRinging'] },
  { id: 'stability', title: 'الثبات', subtitle: 'ثبات زمني ومنع الوميض', stages: ['antiFlicker','temporalDetailStability'] },
];


const COLOR_LOOKS = Object.freeze({
  natural: { exposure: 0, contrast: 1, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, saturation: 1, vibrance: 0, lift: 0, gamma: 1, gain: 1, clarity: 0, dehaze: 0 },
  clean: { exposure: 0.04, contrast: 1.05, highlights: -0.06, shadows: 0.05, whites: 0.03, blacks: -0.02, temperature: 0, tint: 0, saturation: 1.01, vibrance: 0.08, lift: 0, gamma: 1, gain: 1, clarity: 0.08, dehaze: 0.04 },
  sports: { exposure: 0.04, contrast: 1.09, highlights: -0.08, shadows: 0.05, whites: 0.06, blacks: -0.05, temperature: 0, tint: 0, saturation: 1.04, vibrance: 0.14, lift: 0, gamma: 1, gain: 1, clarity: 0.16, dehaze: 0.08 },
  cinema: { exposure: -0.03, contrast: 1.12, highlights: -0.16, shadows: 0.07, whites: -0.02, blacks: -0.07, temperature: 0.09, tint: 0.02, saturation: 0.94, vibrance: 0.1, lift: -0.01, gamma: 1.03, gain: 0.99, clarity: 0.05, dehaze: 0.05 },
  warm: { temperature: 0.16, tint: 0.02, saturation: 1.02, vibrance: 0.08 },
  cool: { temperature: -0.15, tint: -0.01, saturation: 0.99, vibrance: 0.06 },
  vivid: { contrast: 1.08, saturation: 1.12, vibrance: 0.22, clarity: 0.1 },
  contrast: { contrast: 1.18, highlights: -0.08, shadows: 0.08, whites: 0.05, blacks: -0.1, clarity: 0.08 },
  night: { exposure: 0.12, contrast: 1.04, highlights: -0.18, shadows: 0.16, blacks: -0.03, temperature: -0.04, saturation: 0.96, clarity: 0.04, dehaze: 0.09 },
});

const COLOR_CONTROLS = [
  ['exposure', 'التعريض', -2, 2, 0, 0.05], ['contrast', 'التباين', 0.5, 1.8, 1, 0.01],
  ['highlights', 'الإضاءات', -1, 1, 0, 0.01], ['shadows', 'الظلال', -1, 1, 0, 0.01],
  ['whites', 'البياض', -1, 1, 0, 0.01], ['blacks', 'السواد', -1, 1, 0, 0.01],
  ['temperature', 'حرارة اللون', -1, 1, 0, 0.01], ['tint', 'الصبغة', -1, 1, 0, 0.01],
  ['saturation', 'التشبع', 0, 2, 1, 0.01], ['vibrance', 'الحيوية', -1, 1, 0, 0.01],
  ['lift', 'رفع الظلال', -0.5, 0.5, 0, 0.01], ['gamma', 'جاما · الدرجات الوسطى', 0.1, 3, 1, 0.01],
  ['gain', 'كسب الإضاءة', 0.1, 3, 1, 0.01], ['clarity', 'الوضوح', 0, 1, 0, 0.01],
  ['dehaze', 'إزالة الضباب', 0, 1, 0, 0.01],
];

const BLUR_PRESETS = Object.freeze({
  low: { amount: .28, shutterAngle: 100, outputFps: 'source', weighting: 'gaussian_sym', gamma: 1, interpolation: true, preInterpolation: false, interpolationFps: 'source', interpolationMultiplier: 3, deduplicate: true },
  medium: { amount: .5, shutterAngle: 180, outputFps: 'source', weighting: 'gaussian_sym', gamma: 1, interpolation: true, preInterpolation: false, interpolationFps: 'source', interpolationMultiplier: 4, deduplicate: true },
  natural: { amount: 1, shutterAngle: 360, outputFps: 'source', weighting: 'gaussian_sym', gamma: 1, interpolation: true, preInterpolation: true, interpolationFps: 'source', interpolationMultiplier: 5, deduplicate: true },
  gameplay: { amount: .6, shutterAngle: 216, outputFps: '60', weighting: 'gaussian_sym', gamma: 1, interpolation: true, preInterpolation: false, interpolationFps: 'source', interpolationMultiplier: 5, deduplicate: true },
  cinematic: { amount: .5, shutterAngle: 180, outputFps: '24', weighting: 'gaussian_sym', gamma: 1, interpolation: true, preInterpolation: true, interpolationFps: 'source', interpolationMultiplier: 4, deduplicate: false },
});

export class EngineLabsUI {
  constructor(manager, root = document.getElementById('engineLabsMount')) {
    this.manager = manager;
    this.root = root;
    this.lutInfo = null;
    this.onChange = null;
    this.onToast = null;
  }

  mount({ onChange = null, onToast = null } = {}) {
    if (!this.root) return;
    this.onChange = onChange;
    this.onToast = onToast;
    this.root.innerHTML = `${labNavigation()}<section class="lab-panel active" data-lab-panel="quality">${qualityMarkup()}</section><section class="lab-panel" data-lab-panel="face" hidden>${faceMarkup()}</section><section class="lab-panel" data-lab-panel="blur" hidden>${blurMarkup()}</section><section class="lab-panel" data-lab-panel="color" hidden>${colorMarkup()}</section>`;
    this._wireLabNavigation();
    this._wireRanges();
    this._wireToggles();
    this._wireBlur();
    this._wireColor();
    this._hideSupersededLegacyControls();
    this._updateVisibility();
  }

  collect() {
    const stages = Object.fromEntries(QUALITY_مراحل.map(([id]) => [id, {
      enabled: this._checked(`ql-${id}-on`),
      strength: this._number(`ql-${id}`, STAGE_DEFAULTS[id] || 0),
    }]));
    const colorLab = {
      enabled: this._checked('cl-enabled'),
      ...Object.fromEntries(COLOR_CONTROLS.map(([id, , , , fallback]) => [id, this._number(`cl-${id}`, fallback)])),
      curves: {
        luma: this._value('cl-curve-luma', '0:0,1:1'), red: this._value('cl-curve-red', '0:0,1:1'),
        green: this._value('cl-curve-green', '0:0,1:1'), blue: this._value('cl-curve-blue', '0:0,1:1'),
      },
      lutStrength: this._number('cl-lut-strength', 0),
      lutHash: this.lutInfo?.sha256 || null,
      lutName: this.lutInfo?.name || null,
      offset: this._number('cl-v3-offset',0), hueRotate: this._number('cl-v3-hue',0),
      shadowSat: this._number('cl-v3-shadow-sat',1), midSat: this._number('cl-v3-mid-sat',1), highlightSat: this._number('cl-v3-highlight-sat',1),
      redSat: this._number('cl-v3-red-sat',1), greenSat: this._number('cl-v3-green-sat',1), blueSat: this._number('cl-v3-blue-sat',1),
      rgbMixer: {
        rr:this._number('cl-mix-rr',1), rg:this._number('cl-mix-rg',0), rb:this._number('cl-mix-rb',0),
        gr:this._number('cl-mix-gr',0), gg:this._number('cl-mix-gg',1), gb:this._number('cl-mix-gb',0),
        br:this._number('cl-mix-br',0), bg:this._number('cl-mix-bg',0), bb:this._number('cl-mix-bb',1),
      },
    };
    return {
      temporalReconstruction: { enabled:this._checked('tr-enabled'), strength:this._number('tr-strength',.45), historyFrames:this._number('tr-history',3), motionProtection:this._number('tr-motion-protect',.75) },
      stabilization: { enabled:this._checked('st-enabled'), strength:this._number('st-strength',.55), crop:this._number('st-crop',.035), maxShift:this._number('st-max-shift',14), smoothing:this._number('st-smoothing',.88) },
      qualityLab: { sceneAware: this._checked('ql-scene-aware'), mode: this._value('ql-mode', 'natural'), stages },
      faceLab: {
        faceDetection: this._checked('fl-detection'),
        faceDetail: stageValue(this, 'fl-detail'),
        skinCleanup: stageValue(this, 'fl-cleanup'),
        skinSmoothing: stageValue(this, 'fl-smoothing'),
        microContrast: stageValue(this, 'fl-microcontrast'),
        skinToneProtect: stageValue(this, 'fl-toneprotect'),
        eyeDetail: stageValue(this, 'fl-eyedetail'),
        hairDetail: stageValue(this, 'fl-hairdetail'),
      },
      blur: {
        enabled: this._checked('blur-enabled'),
        shutterAngle: this._checked('blur-shutter-on') ? this._number('blur-shutter-angle', 360) : null,
        amount: this._checked('blur-shutter-on') ? Math.max(0, Math.min(4, this._number('blur-shutter-angle', 360) / 360)) : (this._checked('blur-amount-on') ? this._number('blur-amount', 1) : 0),
        outputFps: this._checked('blur-output-on') ? this._value('blur-output-fps', 'source') : 'source',
        customOutputFps: this._number('blur-custom-output', 60),
        weighting: this._checked('blur-weighting-on') ? this._value('blur-weighting', 'gaussian_sym') : 'equal',
        gamma: this._checked('blur-gamma-on') ? this._number('blur-gamma', 1) : 1,
        customWeights: this._value('blur-custom-weights', ''),
        gaussian: this._checked('blur-gaussian-on')
          ? { stdDev: this._number('blur-gaussian-stddev', 1), mean: this._number('blur-gaussian-mean', 0), bound: this._value('blur-gaussian-bound', '-2,2') }
          : { stdDev: 1, mean: 0, bound: '-2,2' },
        interpolation: this._checked('blur-interpolation'),
        preInterpolation: this._checked('blur-pre-interpolation'),
        interpolationFps: this._value('blur-interpolation-fps', 'source'),
        customInterpolationFps: this._number('blur-custom-interpolation', 120),
        interpolationMultiplier: this._checked('blur-multiplier-on') ? this._number('blur-multiplier', 2) : 1,
        interpolationMethod: 'rife',
        deduplicate: this._checked('blur-deduplicate'),
        deduplicateRange: this._checked('blur-dedupe-range-on') ? this._number('blur-dedupe-range', 2) : 2,
        deduplicateThreshold: this._checked('blur-dedupe-threshold-on') ? this._number('blur-dedupe-threshold', 0.006) : 0.006,
        deduplicateMethod: this._value('blur-dedupe-method', 'skip'),
        encoderSelection: this._value('blur-encoder', 'auto'),
        renderQualityCrf: this._number('blur-render-crf', 16),
        renderPreset: this._value('blur-render-preset', 'balanced'),
        detailedFilenames: this._checked('blur-detailed-filenames'),
        copyDates: this._checked('blur-copy-dates'),
        gpuDecoding: this._checked('blur-gpu-decode'),
        gpuInterpolation: this._checked('blur-gpu-interpolation'),
        gpuEncoding: this._checked('blur-gpu-encode'),
        filtersEnabled: this._checked('blur-filters-enabled'),
        filterBrightness: this._number('blur-filter-brightness', 1),
        filterSaturation: this._number('blur-filter-saturation', 1),
        filterContrast: this._number('blur-filter-contrast', 1),
        mobileSafeMode: this._checked('blur-mobile-safe'),
      },
      colorLab,
    };
  }

  previewEffects(baseEffects) {
    const settings = this.collect();
    const effects = this.manager.engines.quality.resolve(baseEffects, settings.qualityLab);
    if (!settings.colorLab.enabled) return effects;
    const color = settings.colorLab;
    return { ...effects, exposure: color.exposure, contrast: color.contrast, highlights: color.highlights, shadows: color.shadows, whites: color.whites, blacks: color.blacks, temperature: color.temperature, saturation: color.saturation, vibrance: color.vibrance, gamma: color.gamma, clarity: color.clarity, dehaze: color.dehaze, tint: color.tint, lift: color.lift, gain: color.gain };
  }

  applySmartPlan(plan) {
    if (!plan?.stages) return;
    this._setValue('ql-mode', plan.mode || 'natural');
    for (const [id, stage] of Object.entries(plan.stages)) {
      this._setChecked(`ql-${id}-on`, stage.enabled);
      this._setValue(`ql-${id}`, stage.strength);
      this._updateOutput(`ql-${id}`);
    }
    this._updateVisibility();
    this.root.querySelector('#ql-summary').textContent = plan.summary || '';
    this.onChange?.();
  }

  applySettings(settings = {}) {
    const quality = settings.qualityLab;
    if (quality) {
      this._setChecked('ql-scene-aware', quality.sceneAware !== false);
      this._setValue('ql-mode', quality.mode || 'natural');
      for (const [id, stage] of Object.entries(quality.stages || {})) {
        this._setChecked(`ql-${id}-on`, stage.enabled !== false);
        this._setValue(`ql-${id}`, stage.strength);
      }
    }
    const face = settings.faceLab;
    if (face) {
      this._setChecked('fl-detection', face.faceDetection !== false);
      applyStageSetting(this, 'fl-detail', face.faceDetail);
      applyStageSetting(this, 'fl-cleanup', face.skinCleanup);
      applyStageSetting(this, 'fl-smoothing', face.skinSmoothing);
      applyStageSetting(this, 'fl-microcontrast', face.microContrast);
      applyStageSetting(this, 'fl-toneprotect', face.skinToneProtect);
      applyStageSetting(this, 'fl-eyedetail', face.eyeDetail);
      applyStageSetting(this, 'fl-hairdetail', face.hairDetail);
    }
    const temporalReconstruction = settings.temporalReconstruction;
    if (temporalReconstruction) {
      this._setChecked('tr-enabled', temporalReconstruction.enabled !== false);
      for (const [id,value] of Object.entries({'tr-strength':temporalReconstruction.strength,'tr-history':temporalReconstruction.historyFrames,'tr-motion-protect':temporalReconstruction.motionProtection})) this._setValue(id,value);
    }
    const stabilization = settings.stabilization;
    if (stabilization) {
      this._setChecked('st-enabled', stabilization.enabled !== false);
      for (const [id,value] of Object.entries({'st-strength':stabilization.strength,'st-crop':stabilization.crop,'st-max-shift':stabilization.maxShift,'st-smoothing':stabilization.smoothing})) this._setValue(id,value);
    }
    const blur = settings.blur;
    if (blur) {
      for (const [id, value] of Object.entries({ 'blur-enabled': blur.enabled, 'blur-shutter-on': blur.shutterAngle != null, 'blur-interpolation': blur.interpolation, 'blur-pre-interpolation': blur.preInterpolation, 'blur-deduplicate': blur.deduplicate, 'blur-detailed-filenames': blur.detailedFilenames, 'blur-copy-dates': blur.copyDates, 'blur-gpu-decode': blur.gpuDecoding !== false, 'blur-gpu-interpolation': blur.gpuInterpolation !== false, 'blur-gpu-encode': blur.gpuEncoding !== false, 'blur-filters-enabled': blur.filtersEnabled, 'blur-mobile-safe': blur.mobileSafeMode !== false })) this._setChecked(id, Boolean(value));
      for (const id of ['blur-amount-on','blur-output-on','blur-weighting-on','blur-gamma-on','blur-gaussian-on','blur-multiplier-on','blur-dedupe-range-on','blur-dedupe-threshold-on']) this._setChecked(id, true);
      for (const [id, value] of Object.entries({ 'blur-amount': blur.amount, 'blur-amount-num': blur.amount, 'blur-shutter-angle': blur.shutterAngle ?? Math.round((Number(blur.amount) || 1) * 360), 'blur-shutter-num': blur.shutterAngle ?? Math.round((Number(blur.amount) || 1) * 360), 'blur-output-fps': blur.outputFps, 'blur-custom-output': blur.customOutputFps, 'blur-weighting': blur.weighting, 'blur-gamma': blur.gamma, 'blur-custom-weights': blur.customWeights, 'blur-interpolation-fps': blur.interpolationFps, 'blur-custom-interpolation': blur.customInterpolationFps, 'blur-multiplier': blur.interpolationMultiplier, 'blur-dedupe-range': blur.deduplicateRange, 'blur-dedupe-threshold': blur.deduplicateThreshold, 'blur-dedupe-method': blur.deduplicateMethod, 'blur-encoder': blur.encoderSelection, 'blur-render-crf': blur.renderQualityCrf, 'blur-render-preset': blur.renderPreset, 'blur-filter-brightness': blur.filterBrightness, 'blur-filter-saturation': blur.filterSaturation, 'blur-filter-contrast': blur.filterContrast, 'blur-gaussian-stddev': blur.gaussian?.stdDev, 'blur-gaussian-mean': blur.gaussian?.mean, 'blur-gaussian-bound': Array.isArray(blur.gaussian?.bound)?blur.gaussian.bound.join(','):blur.gaussian?.bound })) this._setValue(id, value);
    }
    const color = settings.colorLab;
    if (color) {
      this._setChecked('cl-enabled', color.enabled !== false);
      for (const [id] of COLOR_CONTROLS) this._setValue(`cl-${id}`, color[id]);
      for (const channel of ['luma', 'red', 'green', 'blue']) this._setValue(`cl-curve-${channel}`, color.curves?.[channel]);
      this._setValue('cl-lut-strength', color.lutStrength);
      for (const [id,value] of Object.entries(color.rgbMixer||{})) this._setValue(`cl-mix-${id}`, value);
      for (const [id,value] of Object.entries({offset:color.offset,hue:color.hueRotate,'shadow-sat':color.shadowSat,'mid-sat':color.midSat,'highlight-sat':color.highlightSat,'red-sat':color.redSat,'green-sat':color.greenSat,'blue-sat':color.blueSat})) this._setValue(`cl-v3-${id}`, value);
      if (color.lutHash) this.root.querySelector('#cl-lut-status').textContent = 'LUT must be re-imported to verify its hash';
    }
    this.root.querySelectorAll('input[type="range"]').forEach((input) => this._updateOutput(input.id));
    this.root.querySelectorAll('[data-sync-range]').forEach((number)=>{const range=this.root.querySelector(`#${number.dataset.syncRange}`);if(range)number.value=range.value});
    this._updateVisibility();
  }


  setActiveLab(name = 'quality') {
    this.activateLab?.(name);
  }

  _wireLabNavigation() {
    const buttons = [...this.root.querySelectorAll('[data-lab-target]')];
    const panels = [...this.root.querySelectorAll('[data-lab-panel]')];
    const activate = (name) => {
      buttons.forEach((button) => button.classList.toggle('active', button.dataset.labTarget === name));
      panels.forEach((panel) => {
        const active = panel.dataset.labPanel === name;
        panel.hidden = !active;
        panel.classList.toggle('active', active);
      });
      try { localStorage.setItem('barsa.activeLab', name); } catch {}
      this.activeLab = name;
    };
    this.activateLab = activate;
    buttons.forEach((button) => button.addEventListener('click', () => activate(button.dataset.labTarget)));
    let initial = 'quality';
    try { initial = localStorage.getItem('barsa.activeLab') || initial; } catch {}
    if (!buttons.some((button) => button.dataset.labTarget === initial)) initial = 'quality';
    activate(initial);
  }

  _wireRanges() {
    this.root.querySelectorAll('input[type="range"]').forEach((input) => input.addEventListener('input', () => {
      this._updateOutput(input.id);
      const number = this.root.querySelector(`[data-sync-range="${input.id}"]`);
      if (number) number.value = input.value;
      this.onChange?.();
    }));
    this.root.querySelectorAll('[data-sync-range]').forEach((number) => number.addEventListener('input', () => {
      const range = this.root.querySelector(`#${number.dataset.syncRange}`);
      if (range) { range.value = number.value; this._updateOutput(range.id); }
      this.onChange?.();
    }));
    this.root.querySelectorAll('input[type="number"],input[type="text"],select').forEach((input) => input.addEventListener('change', () => { this._updateVisibility(); this.onChange?.(); }));
  }

  _wireToggles() {
    this.root.querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener('change', () => { this._updateVisibility(); this.onChange?.(); }));
  }

  _wireBlur() {
    const pairs = [['blur-amount','blur-amount-num'],['blur-gamma','blur-gamma-num']];
    for (const [rangeId, numberId] of pairs) {
      const range = this.root.querySelector(`#${rangeId}`), number = this.root.querySelector(`#${numberId}`);
      if (range && number) {
        range.addEventListener('input', () => { number.value = range.value; this.onChange?.(); });
        number.addEventListener('input', () => { range.value = number.value; this._updateOutput(rangeId); this.onChange?.(); });
      }
    }
    const shutterRange=this.root.querySelector('#blur-shutter-angle'),shutterNumber=this.root.querySelector('#blur-shutter-num');
    const syncShutter=()=>{if(!shutterRange||!shutterNumber)return;shutterNumber.value=shutterRange.value;const amount=Math.max(0,Math.min(4,Number(shutterRange.value)/360));this._setValue('blur-amount',amount);this._setValue('blur-amount-num',amount);this._updateOutput('blur-amount');this.onChange?.();};
    shutterRange?.addEventListener('input',syncShutter);
    shutterNumber?.addEventListener('input',()=>{shutterRange.value=shutterNumber.value;syncShutter()});
    this.root.querySelectorAll('[data-blur-preset]').forEach(button=>button.addEventListener('click',()=>{const preset=BLUR_PRESETS[button.dataset.blurPreset];if(!preset)return;this.applySettings({blur:{...defaultBlur(),...preset,enabled:true}});this._setChecked('blur-enabled',true);this._setChecked('blur-shutter-on',true);this._updateVisibility();this.onChange?.();this.onToast?.(`تم تطبيق ${button.textContent.trim()}`)}));
    this.root.querySelector('#blur-save').addEventListener('click', () => {
      localStorage.setItem('vtp-blur-preset-v1', JSON.stringify(this.collect().blur));
      this.onToast?.('تم حفظ إعداد البلور محليًا');
    });
    this.root.querySelector('#blur-load').addEventListener('click', () => {
      try { this.applySettings({ blur: JSON.parse(localStorage.getItem('vtp-blur-preset-v1') || 'null') }); this.onChange?.(); }
      catch { this.onToast?.('إعداد البلور المحفوظ غير صالح'); }
    });
    this.root.querySelector('#blur-export-cfg')?.addEventListener('click', () => {
      const cfg = serializeF0eBlurConfig(this.collect().blur);
      const blob = new Blob([cfg], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'blur.cfg'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.onToast?.('تم تصدير blur.cfg متوافق بالإعدادات المدعومة');
    });
    this.root.querySelector('#blur-import-cfg')?.addEventListener('click', () => this.root.querySelector('#blur-import-cfg-file')?.click());
    this.root.querySelector('#blur-import-cfg-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try { this.applySettings({ blur: parseF0eBlurConfig(await file.text()) }); this.onChange?.(); this.onToast?.('تم استيراد إعدادات blur.cfg المدعومة'); }
      catch (error) { this.onToast?.(`تعذر استيراد blur.cfg: ${error.message}`); }
      finally { event.target.value = ''; }
    });
    this.root.querySelector('#blur-defaults').addEventListener('click', () => { this.applySettings({ blur: defaultBlur() }); this.onChange?.(); });
  }

  _wireColor() {
    this.root.querySelector('#cl-look').addEventListener('change', (event) => {
      if (event.target.value === 'custom') {
        try { this._applyLook(JSON.parse(localStorage.getItem('vtp-color-look-v1') || 'null')); }
        catch { this.onToast?.('لا يوجد مخصص Look محفوظ بشكل صالح'); }
      } else this._applyLook({ ...COLOR_LOOKS.natural, ...COLOR_LOOKS[event.target.value] });
    });
    this.root.querySelector('#cl-save-look').addEventListener('click', () => {
      const color = this.collect().colorLab;
      localStorage.setItem('vtp-color-look-v1', JSON.stringify(color));
      this.onToast?.('تم حفظ اللوك اللوني محليًا');
    });
    this.root.querySelector('#cl-lut-file').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const status = this.root.querySelector('#cl-lut-status');
      try {
        status.textContent = 'جارٍ فحص LUT…';
        this.lutInfo = await this.manager.engines.color.importCube(file);
        status.textContent = `${this.lutInfo.title} · ${this.lutInfo.type.toUpperCase()} ${this.lutInfo.size} · SHA-256 verified`;
        this.onChange?.();
      } catch (error) {
        this.lutInfo = null;
        status.textContent = error.message;
      } finally { event.target.value = ''; }
    });
    this.root.querySelector('#cl-clear-lut').addEventListener('click', () => {
      this.manager.engines.color.clearLut(); this.lutInfo = null;
      this.root.querySelector('#cl-lut-status').textContent = 'لا يوجد LUT محمّل';
      this.onChange?.();
    });
  }

  _applyLook(look) {
    if (!look) return;
    for (const [id] of COLOR_CONTROLS) if (look[id] != null) { this._setValue(`cl-${id}`, look[id]); this._updateOutput(`cl-${id}`); }
    this.onChange?.();
  }

  _hideSupersededLegacyControls() {
    for (const id of ['contrast', 'saturation', 'vibrance', 'sharpen', 'detail', 'denoise', 'temporalDenoise', 'antiFlicker', 'portraitSmooth', 'temperature', 'exposure', 'highlights', 'shadows', 'whites', 'blacks', 'dehaze', 'faceStrength']) {
      document.getElementById(id)?.closest('label')?.classList.add('legacy-superseded');
    }
  }

  _updateVisibility() {
    for (const [id] of QUALITY_مراحل) toggleLinked(this.root, `ql-${id}-on`, `ql-${id}`);
    for (const id of ['fl-detail', 'fl-cleanup', 'fl-smoothing', 'fl-microcontrast', 'fl-toneprotect', 'fl-eyedetail', 'fl-hairdetail']) toggleLinked(this.root, `${id}-on`, id);
    for (const id of ['tr-strength','tr-history','tr-motion-protect']) { const el=this.root.querySelector(`#${id}`); if(el) el.disabled=!this._checked('tr-enabled'); }
    for (const id of ['st-strength','st-crop','st-max-shift','st-smoothing']) { const el=this.root.querySelector(`#${id}`); if(el) el.disabled=!this._checked('st-enabled'); }
    this.root.querySelectorAll('[data-blur-control]').forEach((element) => { element.disabled = !this._checked('blur-enabled'); });
    const linkedBlur = [
      ['blur-shutter-on',['blur-shutter-angle','blur-shutter-num']],
      ['blur-amount-on',['blur-amount','blur-amount-num']],
      ['blur-output-on',['blur-output-fps','blur-custom-output']],
      ['blur-weighting-on',['blur-weighting','blur-custom-weights']],
      ['blur-gamma-on',['blur-gamma','blur-gamma-num']],
      ['blur-gaussian-on',['blur-gaussian-stddev','blur-gaussian-mean','blur-gaussian-bound']],
      ['blur-multiplier-on',['blur-multiplier']],
      ['blur-dedupe-range-on',['blur-dedupe-range']],
      ['blur-dedupe-threshold-on',['blur-dedupe-threshold']],
      ['blur-filters-enabled',['blur-filter-brightness','blur-filter-saturation','blur-filter-contrast']],
    ];
    for (const [toggleId, controlIds] of linkedBlur) for (const controlId of controlIds) {
      const el=this.root.querySelector(`#${controlId}`); if(el) el.disabled=!this._checked('blur-enabled')||!this._checked(toggleId);
    }
    if (this._checked('blur-shutter-on')) for (const id of ['blur-amount','blur-amount-num']) { const el=this.root.querySelector(`#${id}`); if(el) el.disabled=true; }
    this.root.querySelectorAll('[data-color-control]').forEach((element) => { element.disabled = !this._checked('cl-enabled'); });
    this.root.querySelectorAll('[data-sync-range]').forEach((number)=>{const range=this.root.querySelector(`#${number.dataset.syncRange}`);if(range)number.disabled=range.disabled});
    const customOutput = this.root.querySelector('#blur-custom-output');
    customOutput.hidden = this._value('blur-output-fps') !== 'custom';
    const customInterpolation = this.root.querySelector('#blur-custom-interpolation');
    customInterpolation.hidden = this._value('blur-interpolation-fps') !== 'custom';
    const gaussian = this._value('blur-weighting').startsWith('gaussian');
    this.root.querySelector('#blur-gaussian-controls').hidden = !gaussian;
    this.root.querySelector('#blur-custom-weights-row').hidden = this._value('blur-weighting') !== 'custom';
  }

  _updateOutput(id) { const input = this.root.querySelector(`#${id}`), output = this.root.querySelector(`#${id}-out`); if (input && output) output.value = Number(input.value).toFixed(input.step && Number(input.step) < 0.01 ? 3 : 2); }
  _checked(id) { return Boolean(this.root?.querySelector(`#${id}`)?.checked); }
  _number(id, fallback = 0) { const value = Number(this.root?.querySelector(`#${id}`)?.value); return Number.isFinite(value) ? value : fallback; }
  _value(id, fallback = '') { return this.root?.querySelector(`#${id}`)?.value ?? fallback; }
  _setChecked(id, value) { const element = this.root?.querySelector(`#${id}`); if (element && value != null) element.checked = Boolean(value); }
  _setValue(id, value) { const element = this.root?.querySelector(`#${id}`); if (element && value != null) element.value = Array.isArray(value) ? value.join(',') : value; }
}

function labNavigation() {
  return `<nav class="lab-nav" aria-label="محركات التحسين"><button class="active" type="button" data-lab-target="quality"><b>مختبر الجودة</b><small>تنظيف واستعادة التفاصيل</small></button><button type="button" data-lab-target="face"><b>ذكاء الوجوه</b><small>ترميم الوجه والبشرة</small></button><button type="button" data-lab-target="blur"><b>استوديو البلور</b><small>بلور زمني + رندر خاص</small></button><button type="button" data-lab-target="color"><b>الألوان الاحترافية</b><small>ألوان + Curves + LUT</small></button></nav>`;
}

function qualityMarkup() {
  const stageMap = new Map(QUALITY_مراحل.map(stage => [stage[0], stage]));
  const groups = QUALITY_GROUPS.map(group => {
    const rows = group.stages.map(id => {
      const [, label, max] = stageMap.get(id);
      return stageRow(`ql-${id}`, label, STAGE_DEFAULTS[id] || 0, max, DEFAULT_ON.has(id));
    }).join('');
    return `<section class="quality-group" data-quality-group="${group.id}"><div class="quality-group-head"><span><b>${group.title}</b><small>${group.subtitle}</small></span><em>${group.stages.length} مراحل</em></div><div class="lab-stage-list">${rows}</div></section>`;
  }).join('');
  return `<details class="advanced engine-lab premium-quality"><summary>مختبر الجودة · مراحل احترافية</summary><div class="quality-hero"><div><span>محرك جودة BARSA</span><b>تحكم احترافي مرحلة بمرحلة</b><small>أي مرحلة تطفيها يتم تجاوزها بالكامل في الرندر. ماكو تأثير وهمي.</small></div><div class="quality-hero-badge">معالجة حقيقية</div></div><div class="lab-toolbar"><label>التحسين الذكي <select id="ql-mode"><option value="natural">طبيعي</option><option value="strong">قوي</option><option value="ultra">فائق</option></select></label><label class="inline-check"><input id="ql-scene-aware" type="checkbox" checked> حماية المشاهد</label></div><small id="ql-summary" class="lab-status">كل مرحلة مطفأة يتم تجاوزها بالكامل في الرندر.</small><div class="quality-group-stack">${groups}</div><section class="quality-group temporal-reconstruction-v3"><div class="quality-group-head"><span><b>إعادة البناء الزمنية V3</b><small>دمج متعدد الإطارات بمحاذاة الحركة قبل رفع الدقة بالذكاء الاصطناعي</small></span><em>متعدد الإطارات</em></div><label class="lab-master green-master"><span><b>إعادة البناء الزمنية</b><small>يستخدم تاريخاً محدوداً ومحاذاة حركة حقيقية لتقليل الضوضاء والوميض قبل الرفع</small></span><span class="switch green-switch"><input id="tr-enabled" type="checkbox" checked><span></span></span></label><div class="lab-grid"><label>القوة <input id="tr-strength" type="number" min="0" max="1" step="0.05" value="0.45"></label><label>إطارات الذاكرة <input id="tr-history" type="number" min="1" max="3" step="1" value="3"></label><label>حماية الحركة <input id="tr-motion-protect" type="number" min="0.15" max="1" step="0.05" value="0.75"></label></div><small class="lab-status">المحرك متعدد الإطارات حقيقي لكنه ليس نموذج رفع الدقة الفائق عصبي مستقل؛ يعمل قبل نموذج Upscale الموجود عندك.</small></section><section class="quality-group stabilization-v2"><div class="quality-group-head"><span><b>تثبيت الفيديو V2</b><small>تثبيت حركة حقيقي ببحث الحركة العام على إطارات متتالية</small></span><em>حركة عامة</em></div><label class="lab-master green-master"><span><b>تثبيت الفيديو</b><small>تعويض الاهتزاز بدون تحميل الفيديو كله للذاكرة</small></span><span class="switch green-switch"><input id="st-enabled" type="checkbox"><span></span></span></label><div class="lab-grid"><label>القوة <input id="st-strength" type="number" min="0" max="1" step="0.05" value="0.55"></label><label>قص الأمان <input id="st-crop" type="number" min="0" max="0.12" step="0.005" value="0.035"></label><label>أقصى إزاحة px <input id="st-max-shift" type="number" min="2" max="48" step="1" value="14"></label><label>التنعيم <input id="st-smoothing" type="number" min="0.5" max="0.98" step="0.01" value="0.88"></label></div></section></details>`;
}

function faceMarkup() {
  return `<details class="advanced engine-lab"><summary>مختبر الوجه والبورتريه</summary><p class="lab-note">يعمل فقط داخل مناطق الوجوه المكتشفة. مفتاح ترميم الوجه في مختبر الذكاء الاصطناعي هو المفتاح الرئيسي للتشغيل والإيقاف.</p><label class="inline-check"><input id="fl-detection" type="checkbox" checked> اكتشاف الوجه</label><div class="lab-stage-list">${stageRow('fl-detail', 'تفاصيل الوجه', .18, 1, false)}${stageRow('fl-cleanup', 'تنظيف البشرة', .12, 1, false)}${stageRow('fl-smoothing', 'تنعيم البشرة', .1, 1, false)}${stageRow('fl-microcontrast', 'تباين الوجه الدقيق V2', .12, 1, false)}${stageRow('fl-toneprotect', 'حماية لون البشرة V2', .55, 1, true)}${stageRow('fl-eyedetail', 'تفاصيل العين V3', .18, 1, false)}${stageRow('fl-hairdetail', 'تفاصيل الشعر V3', .16, 1, false)}</div></details>`;
}

function blurMarkup() {
  return `<details class="advanced engine-lab blur-pro-lab" open><summary>BLUR COMPLETE · رندر مستقل</summary>
  <div class="blur-source-badge"><span>مرجع السلوك</span><b>f0e/blur · إعدادات موثقة</b><small>تنفيذ BARSA للهاتف: نفس مفاهيم البلور/الأوزان/RIFE/deduplicate، بدون تشغيل VapourSynth أو SVP المكتبي داخل Android.</small></div>
  <label class="lab-master green-master"><span><b>محرك البلور الكامل</b><small>خانة مستقلة ورندر MP4 مستقل لا يشغل AI/Face/Color إلا إذا فعّلت فلاتر البلور الخاصة أدناه</small></span><span class="switch green-switch"><input id="blur-enabled" type="checkbox"><span></span></span></label>
  <div class="blur-preset-grid"><button type="button" data-blur-preset="low">خفيف · 0.28</button><button type="button" data-blur-preset="medium">متوسط · 0.50</button><button type="button" data-blur-preset="natural">طبيعي · 1.00</button><button type="button" data-blur-preset="gameplay">ألعاب · 60FPS</button><button type="button" data-blur-preset="cinematic">سينمائي · 180°</button></div>
  <div class="blur-control-stack">
    <div class="blur-section-label">البلور</div>
    ${blurNumericRow('blur-shutter-on','زاوية الغالق','180° = 0.50 · 360° = 1.00 · 720° = 2.00','blur-shutter-angle','blur-shutter-num',0,1440,360,5)}
    ${blurNumericRow('blur-amount-on','قوة البلور','0 = بدون بلور · 1 = مزج نافذة كاملة · أعلى من 1 = أثر أطول','blur-amount','blur-amount-num',0,4,1,.05)}
    ${blurSelectRow('blur-output-on','FPS إخراج البلور','الإطارات النهائية بعد المزج','blur-output-fps',fpsOptions())}
    <label class="blur-sub-value" id="blur-custom-output-row"><span>FPS مخصص للإخراج</span><input data-blur-control id="blur-custom-output" type="number" min="1" max="480" value="60" inputmode="decimal"></label>
    ${blurSelectRow('blur-weighting-on','Blur Weighting','نفس عائلات الأوزان الموثقة في blur','blur-weighting','<option value="equal">equal · متساوي</option><option value="gaussian_sym" selected>gaussian_sym</option><option value="vegas">vegas</option><option value="pyramid">pyramid</option><option value="gaussian">gaussian</option><option value="ascending">ascending</option><option value="descending">descending</option><option value="gaussian_reverse">gaussian_reverse</option><option value="custom">custom weights</option>')}
    <label class="blur-sub-value" id="blur-custom-weights-row"><span>Custom Weights</span><input data-blur-control id="blur-custom-weights" type="text" value="5,3,3,2,1"></label>
    ${blurNumericRow('blur-gamma-on','Blur Gamma','مزج خطي عند 1.00، وقيم أخرى تغيّر استجابة الإضاءة','blur-gamma','blur-gamma-num',.25,4,1,.05)}
    <div class="blur-option-card"><div class="blur-option-title"><span><b>Gaussian Advanced</b><small>Std Dev / Mean / Bound للأوزان الغاوسية</small></span><span class="switch green-switch"><input id="blur-gaussian-on" type="checkbox" checked><span></span></span></div><div id="blur-gaussian-controls" class="blur-inline-grid"><label>Std Dev<input data-blur-control id="blur-gaussian-stddev" type="number" min="0.001" max="8" step="0.05" value="1"></label><label>Mean<input data-blur-control id="blur-gaussian-mean" type="number" min="-8" max="8" step="0.05" value="0"></label><label>Bound<input data-blur-control id="blur-gaussian-bound" type="text" value="-2,2"></label></div></div>

    <div class="blur-section-label">Interpolation · RIFE</div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>توليد الإطارات قبل البلور</b><small>RIFE الحقيقي؛ BARSA لا يستخدم SVP المكتبي على Android</small></span><span class="switch green-switch"><input data-blur-control id="blur-interpolation" type="checkbox" checked><span></span></span></div><div class="blur-inline-grid"><label>FPS داخلي<select data-blur-control id="blur-interpolation-fps">${fpsOptions('source')}</select></label><label>FPS مخصص<input data-blur-control id="blur-custom-interpolation" type="number" min="1" max="480" value="120"></label>${blurInlineNumberToggle('blur-multiplier-on','المضاعف','blur-multiplier',1,8,5,1)}</div></div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>Pre-interpolation</b><small>مرحلة RIFE إضافية قبل المزج؛ أدق لكن أبطأ</small></span><span class="switch green-switch"><input data-blur-control id="blur-pre-interpolation" type="checkbox" checked><span></span></span></div></div>

    <div class="blur-section-label">Deduplicate</div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>إزالة الإطارات المكررة</b><small>يمنع التقطيع الناتج من فريمات مكررة قبل البلور</small></span><span class="switch green-switch"><input data-blur-control id="blur-deduplicate" type="checkbox"><span></span></span></div><div class="blur-inline-grid">${blurInlineNumberToggle('blur-dedupe-range-on','Range','blur-dedupe-range',1,12,2,1)}${blurInlineNumberToggle('blur-dedupe-threshold-on','Threshold','blur-dedupe-threshold',.0001,.2,.006,.0005)}<label>Method<select data-blur-control id="blur-dedupe-method"><option value="skip">skip · تخطي</option><option value="nearest">nearest · الأقرب</option></select></label></div></div>

    <div class="blur-section-label">فلاتر blur</div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>Brightness / Saturation / Contrast</b><small>فلاتر مستقلة لرندر البلور فقط، والقيمة 1.00 محايدة</small></span><span class="switch green-switch"><input id="blur-filters-enabled" type="checkbox"><span></span></span></div><div class="blur-inline-grid"><label>Brightness<input data-blur-control id="blur-filter-brightness" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>Saturation<input data-blur-control id="blur-filter-saturation" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>Contrast<input data-blur-control id="blur-filter-contrast" type="number" min="0" max="2.5" step="0.05" value="1"></label></div></div>

    <div class="blur-section-label">Rendering</div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>جودة رندر البلور</b><small>CRF-style: رقم أقل = جودة أعلى. BARSA يحوله إلى إعدادات H.264 الآمنة للهاتف.</small></span></div><div class="blur-inline-grid"><label>Quality / CRF<input data-blur-control id="blur-render-crf" type="number" min="0" max="35" step="1" value="16"></label><label>Preset<select data-blur-control id="blur-render-preset"><option value="fast">سريع</option><option value="balanced" selected>متوازن</option><option value="quality">أعلى جودة</option></select></label><label>Encoder<select data-blur-control id="blur-encoder"><option value="auto">تلقائي</option><option value="hardware">تفضيل العتاد</option><option value="software">تفضيل البرمجيات</option></select></label></div></div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>GPU Acceleration</b><small>هذه المفاتيح توثق تفضيلات الرندر؛ H.264 يفضّل العتاد، وRIFE يحاول WebGPU ثم fallback.</small></span></div><div class="blur-check-grid"><label><input id="blur-gpu-decode" type="checkbox" checked> GPU decoding</label><label><input id="blur-gpu-interpolation" type="checkbox" checked> GPU interpolation</label><label><input id="blur-gpu-encode" type="checkbox" checked> GPU encoding</label></div></div>
    <div class="blur-option-card"><div class="blur-option-title"><span><b>تنظيم الملف</b><small>خيارات عملية متوافقة مع أسلوب blur على الكمبيوتر</small></span></div><div class="blur-check-grid"><label><input id="blur-detailed-filenames" type="checkbox" checked> اسم ملف تفصيلي</label><label><input id="blur-copy-dates" type="checkbox"> نسخ تاريخ الملف عند دعم Android</label><label><input id="blur-mobile-safe" type="checkbox" checked> حماية الهاتف من FPS/ذاكرة مبالغ بها</label></div></div>
    <div class="blur-desktop-note"><b>خيارات Desktop-only:</b> SVP presets/algorithms، VapourSynth، manual SVP JSON، وCustom FFmpeg CLI الخام ما تنعرض كأزرار وهمية على الهاتف. RIFE هو البديل الفعلي داخل BARSA.</div>
  </div>
  <div class="lab-actions blur-actions"><button id="blur-apply-to-video" class="blur-render-only" type="button" data-apply-stage="blur">تطبيق البلور على الفيديو</button><button id="blur-render-only" class="blur-render-only" type="button">رندر البلور فقط MP4 · BLUR COMPLETE</button><button id="blur-save" type="button">حفظ الإعداد</button><button id="blur-load" type="button">تحميل الإعداد</button><button id="blur-export-cfg" type="button">تصدير blur.cfg</button><button id="blur-import-cfg" type="button">استيراد blur.cfg</button><input id="blur-import-cfg-file" type="file" accept=".cfg,.txt,text/plain" hidden><button id="blur-defaults" type="button">إعادة الافتراضي</button></div>
  <small class="lab-status">رندر BLUR مستقل: يعطّل تلقائياً Upscale/Face/Quality/Color/Temporal Reconstruction/Stabilization حتى ما تختلط المعالجة، ثم يشغّل البلور + RIFE + Deduplicate + فلاتر blur فقط.</small>
  </details>`;
}

function blurNumericRow(toggleId,title,description,rangeId,numberId,min,max,value,step){return `<div class="blur-option-card"><div class="blur-option-title"><span><b>${title}</b><small>${description}</small></span><span class="switch green-switch"><input id="${toggleId}" type="checkbox" checked><span></span></span></div><div class="blur-range-number"><input data-blur-control id="${rangeId}" type="range" min="${min}" max="${max}" value="${value}" step="${step}"><input data-blur-control id="${numberId}" type="number" min="${min}" max="${max}" value="${value}" step="${step}" inputmode="decimal"><output id="${rangeId}-out">${Number(value).toFixed(2)}</output></div></div>`}
function blurSelectRow(toggleId,title,description,selectId,options){return `<div class="blur-option-card"><div class="blur-option-title"><span><b>${title}</b><small>${description}</small></span><span class="switch green-switch"><input id="${toggleId}" type="checkbox" checked><span></span></span></div><select data-blur-control id="${selectId}">${options}</select></div>`}
function blurInlineNumberToggle(toggleId,title,inputId,min,max,value,step){return `<label class="blur-inline-toggle"><span>${title}<span class="switch green-switch mini"><input id="${toggleId}" type="checkbox" checked><span></span></span></span><input data-blur-control id="${inputId}" type="number" min="${min}" max="${max}" value="${value}" step="${step}"></label>`}

function colorMarkup() {
  const controls = COLOR_CONTROLS.map(([id, label, min, max, value, step]) => `<label class="pro-value-row"><span>${label} <output id="cl-${id}-out">${Number(value).toFixed(2)}</output></span><div><input data-color-control id="cl-${id}" type="range" min="${min}" max="${max}" value="${value}" step="${step}"><input data-color-control data-sync-range="cl-${id}" type="number" min="${min}" max="${max}" value="${value}" step="${step}" inputmode="decimal"></div></label>`).join('');
  return `<details class="advanced engine-lab davinci-mini"><summary>مكتبة الألوان الاحترافية</summary><label class="lab-master"><span><b>محرك الألوان</b><small>معالجة بكسلات فعلية · BT.709 SDR · LUT / Curves / Primaries</small></span><span class="switch"><input id="cl-enabled" type="checkbox" checked><span></span></span></label><div class="look-library"><label>مكتبة المظهر اللوني <select data-color-control id="cl-look"><option value="natural">طبيعي</option><option value="clean">نظيف</option><option value="sports">رياضة</option><option value="cinema">سينمائي</option><option value="warm">دافئ</option><option value="cool">بارد</option><option value="vivid">حيوي</option><option value="contrast">تباين قوي</option><option value="night">ليلي</option><option value="custom">مخصص</option></select></label><button data-color-control id="cl-save-look" type="button">حفظ مظهر مخصص</button></div><div class="lab-grid">${controls}</div><section class="color-v3-selective"><div class="quality-group-head"><span><b>ألوان احترافية V3</b><small>تدوير الصبغة + الإزاحة + تشبع انتقائي حسب الإضاءة واللون</small></span><em>ألوان انتقائية</em></div><div class="lab-grid"><label>الإزاحة <input data-color-control id="cl-v3-offset" type="number" min="-0.5" max="0.5" step="0.01" value="0"></label><label>تدوير الصبغة° <input data-color-control id="cl-v3-hue" type="number" min="-180" max="180" step="1" value="0"></label><label>تشبع الظلال <input data-color-control id="cl-v3-shadow-sat" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>تشبع الدرجات الوسطى <input data-color-control id="cl-v3-mid-sat" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>تشبع الإضاءات <input data-color-control id="cl-v3-highlight-sat" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>تشبع الأحمر <input data-color-control id="cl-v3-red-sat" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>تشبع الأخضر <input data-color-control id="cl-v3-green-sat" type="number" min="0" max="2.5" step="0.05" value="1"></label><label>تشبع الأزرق <input data-color-control id="cl-v3-blue-sat" type="number" min="0" max="2.5" step="0.05" value="1"></label></div></section><section class="rgb-mixer-v2"><div class="quality-group-head"><span><b>مزج قنوات RGB V2</b><small>مزج القنوات الحقيقي قبل Curves وLUT</small></span><em>مصفوفة 3×3</em></div><div class="lab-grid"><label>R ← R <input data-color-control id="cl-mix-rr" type="number" min="-1.5" max="2.5" step="0.01" value="1"></label><label>R ← G <input data-color-control id="cl-mix-rg" type="number" min="-1.5" max="2.5" step="0.01" value="0"></label><label>R ← B <input data-color-control id="cl-mix-rb" type="number" min="-1.5" max="2.5" step="0.01" value="0"></label><label>G ← R <input data-color-control id="cl-mix-gr" type="number" min="-1.5" max="2.5" step="0.01" value="0"></label><label>G ← G <input data-color-control id="cl-mix-gg" type="number" min="-1.5" max="2.5" step="0.01" value="1"></label><label>G ← B <input data-color-control id="cl-mix-gb" type="number" min="-1.5" max="2.5" step="0.01" value="0"></label><label>B ← R <input data-color-control id="cl-mix-br" type="number" min="-1.5" max="2.5" step="0.01" value="0"></label><label>B ← G <input data-color-control id="cl-mix-bg" type="number" min="-1.5" max="2.5" step="0.01" value="0"></label><label>B ← B <input data-color-control id="cl-mix-bb" type="number" min="-1.5" max="2.5" step="0.01" value="1"></label></div></section><div class="curve-grid"><label>منحنى الإضاءة <input data-color-control id="cl-curve-luma" type="text" value="0:0,1:1"></label><label>منحنى الأحمر <input data-color-control id="cl-curve-red" type="text" value="0:0,1:1"></label><label>منحنى الأخضر <input data-color-control id="cl-curve-green" type="text" value="0:0,1:1"></label><label>منحنى الأزرق <input data-color-control id="cl-curve-blue" type="text" value="0:0,1:1"></label></div><div class="lut-row"><label class="model-button">استيراد LUT بصيغة .cube<input id="cl-lut-file" type="file" accept=".cube,text/plain" hidden></label><label>قوة LUT <output id="cl-lut-strength-out">0.00</output><input data-color-control id="cl-lut-strength" type="range" min="0" max="100" value="0" step="1"></label><button id="cl-clear-lut" type="button">مسح LUT</button></div><small id="cl-lut-status" class="lab-status">لا يوجد LUT محمّل</small></details>`;
}

function stageRow(id, label, value, max, enabled) {
  return `<label class="stage-row pro-stage-row"><span class="stage-name"><input id="${id}-on" type="checkbox" ${enabled ? 'checked' : ''}> ${label}</span><div class="stage-value-control"><input id="${id}" type="range" min="0" max="${max}" step="0.01" value="${value}"><input data-sync-range="${id}" type="number" min="0" max="${max}" step="0.01" value="${value}" inputmode="decimal"><output id="${id}-out">${Number(value).toFixed(2)}</output></div></label>`;
}

function fpsOptions(selected = 'source') { return [['source', 'نفس المصدر'], ['30', '30'], ['60', '60'], ['90', '90'], ['120', '120'], ['144', '144'], ['240', '240'], ['custom', 'مخصص']].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label} FPS</option>`).join(''); }
function toggleLinked(root, toggleId, controlId) { const toggle = root.querySelector(`#${toggleId}`), control = root.querySelector(`#${controlId}`); if (toggle && control) control.disabled = !toggle.checked; }
function stageValue(ui, id) { return { enabled: ui._checked(`${id}-on`), strength: ui._number(id, 0) }; }
function applyStageSetting(ui, id, stage) { if (!stage) return; ui._setChecked(`${id}-on`, stage.enabled !== false); ui._setValue(id, stage.strength); }
function parseF0eBlurConfig(text) {
  const map = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#') || line.startsWith('[') || line.startsWith('- ')) continue;
    const at = line.indexOf(':'); if (at < 1) continue;
    map.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  if (!map.size) throw new Error('لا توجد إعدادات key: value');
  const bool = (key, fallback = false) => map.has(key) ? /^(true|1|yes|on)$/i.test(map.get(key)) : fallback;
  const num = (key, fallback) => { const n = Number(map.get(key)); return Number.isFinite(n) ? n : fallback; };
  const out = { ...defaultBlur() };
  out.enabled = bool('blur', out.enabled);
  out.amount = num('blur amount', out.amount);
  out.shutterAngle = Math.round(out.amount * 360);
  if (map.has('blur output fps')) out.outputFps = normalizeCfgFps(map.get('blur output fps'), 'source');
  if (map.has('blur weighting')) out.weighting = map.get('blur weighting').toLowerCase().replace(/\s+/g, '_');
  out.gamma = num('blur gamma', out.gamma);
  out.interpolation = bool('interpolate', out.interpolation);
  if (map.has('interpolated fps')) {
    const value = map.get('interpolated fps').toLowerCase();
    const m = value.match(/^([0-9.]+)x$/);
    if (m) { out.interpolationFps = 'source'; out.interpolationMultiplier = Math.max(1, Math.min(8, Number(m[1]) || 1)); }
    else out.interpolationFps = normalizeCfgFps(value, 'source');
  }
  out.preInterpolation = bool('pre-interpolation', out.preInterpolation);
  out.deduplicate = bool('deduplicate', out.deduplicate);
  out.deduplicateRange = num('deduplicate range', out.deduplicateRange);
  out.deduplicateThreshold = num('deduplicate threshold', out.deduplicateThreshold);
  out.detailedFilenames = bool('detailed filenames', out.detailedFilenames);
  out.copyDates = bool('copy dates', out.copyDates);
  out.gpuInterpolation = bool('gpu interpolation', out.gpuInterpolation);
  out.gpuEncoding = bool('gpu encoding', out.gpuEncoding);
  out.filtersEnabled = bool('filters', out.filtersEnabled);
  out.filterBrightness = num('brightness', out.filterBrightness);
  out.filterSaturation = num('saturation', out.filterSaturation);
  out.filterContrast = num('contrast', out.filterContrast);
  out.renderQualityCrf = num('quality', out.renderQualityCrf);
  out.gaussian = {
    stdDev: num('blur weighting gaussian std dev', out.gaussian.stdDev),
    mean: num('blur weighting gaussian mean', out.gaussian.mean),
    bound: map.get('blur weighting gaussian bound') || map.get('blur weighting bound') || out.gaussian.bound,
  };
  return out;
}
function serializeF0eBlurConfig(b) {
  const fps = b.outputFps === 'source' ? 'source' : b.outputFps === 'custom' ? String(b.customOutputFps || 60) : String(b.outputFps);
  const interp = b.interpolationFps === 'source' ? `${Math.max(1, Number(b.interpolationMultiplier) || 1)}x` : b.interpolationFps === 'custom' ? String(b.customInterpolationFps || 120) : String(b.interpolationFps);
  const yes = value => value ? 'true' : 'false';
  const bound = Array.isArray(b.gaussian?.bound) ? JSON.stringify(b.gaussian.bound) : String(b.gaussian?.bound || '[-2,2]');
  return `[blur BARSA mobile-compatible]\n- blur\nblur: ${yes(b.enabled)}\nblur amount: ${Number(b.amount || 0)}\nblur output fps: ${fps}\nblur weighting: ${b.weighting || 'gaussian_sym'}\nblur gamma: ${Number(b.gamma || 1)}\n\n- interpolation\ninterpolate: ${yes(b.interpolation)}\ninterpolated fps: ${interp}\npre-interpolation: ${yes(b.preInterpolation)}\n\n- rendering\nquality: ${Number(b.renderQualityCrf ?? 16)}\ndeduplicate: ${yes(b.deduplicate)}\ndetailed filenames: ${yes(b.detailedFilenames)}\n\n- gpu acceleration\ngpu interpolation: ${yes(b.gpuInterpolation !== false)}\ngpu encoding: ${yes(b.gpuEncoding !== false)}\n\n- filters\nfilters: ${yes(b.filtersEnabled)}\nbrightness: ${Number(b.filterBrightness ?? 1)}\nsaturation: ${Number(b.filterSaturation ?? 1)}\ncontrast: ${Number(b.filterContrast ?? 1)}\n\n[advanced options]\ndeduplicate range: ${Number(b.deduplicateRange || 2)}\ndeduplicate threshold: ${Number(b.deduplicateThreshold || .006)}\ncopy dates: ${yes(b.copyDates)}\nblur weighting gaussian std dev: ${Number(b.gaussian?.stdDev ?? 1)}\nblur weighting gaussian mean: ${Number(b.gaussian?.mean ?? 0)}\nblur weighting gaussian bound: ${bound}\n`;
}
function normalizeCfgFps(value, fallback) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'source' || v === 'same' || v === 'original') return 'source';
  const n = Number(v); return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : fallback;
}
function defaultBlur() { return { enabled: false, shutterAngle: null, amount: 1, outputFps: 'source', weighting: 'gaussian_sym', gamma: 1, interpolation: true, preInterpolation: true, interpolationFps: 'source', interpolationMultiplier: 5, deduplicate: false, deduplicateRange: 2, deduplicateThreshold: .006, deduplicateMethod: 'skip', encoderSelection: 'auto', renderQualityCrf: 16, renderPreset: 'balanced', detailedFilenames: true, copyDates: false, gpuDecoding: true, gpuInterpolation: true, gpuEncoding: true, filtersEnabled: false, filterBrightness: 1, filterSaturation: 1, filterContrast: 1, mobileSafeMode: true, gaussian: { stdDev: 1, mean: 0, bound: [-2, 2] } }; }
