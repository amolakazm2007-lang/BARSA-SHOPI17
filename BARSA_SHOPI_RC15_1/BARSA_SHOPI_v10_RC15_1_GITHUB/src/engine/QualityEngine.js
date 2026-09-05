const STAGE_DEFAULTS = Object.freeze({
  denoise: 0.15,
  temporalDenoise: 0.12,
  deblock: 0,
  deband: 0,
  artifactRemoval: 0,
  chromaDenoise: 0,
  mosquitoNoise: 0,
  compressionRecovery: 0,
  detailFusion: 0,
  detailRecovery: 0.15,
  fineDetailRecovery: 0,
  textureRecovery: 0,
  microTexture: 0,
  structureRecovery: 0,
  edgeRecovery: 0,
  clarity: 0,
  localContrast: 0,
  smartSharpen: 0.35,
  dehalo: 0,
  antiRinging: 0,
  antiFlicker: 0.1,
  temporalDetailStability: 0,
});

const PRE_EFFECT_KEYS = new Set(['denoiseAmount', 'deblockAmount', 'debandAmount', 'artifactRemoval']);
const TEMPORAL_KEYS = new Set(['temporalDenoise', 'antiFlicker', 'temporalDetailStability']);
const NEUTRAL_EFFECTS = Object.freeze({
  brightness: 0, contrast: 1, saturation: 1, vibrance: 0, gamma: 1, temperature: 0,
  sharpenAmount: 0, sharpenThreshold: 0.02, highPassAmount: 0, denoiseAmount: 0,
  detailAmount: 0, portraitSmooth: 0, exposure: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, dehaze: 0, vignette: 0, grain: 0, deblockAmount: 0,
  debandAmount: 0, artifactRemoval: 0, chromaDenoise: 0, mosquitoNoise: 0, compressionRecovery: 0, detailFusion: 0, fineDetailRecovery: 0, textureRecovery: 0, microTexture: 0, structureRecovery: 0,
  edgeRecovery: 0, clarity: 0, localContrast: 0, dehalo: 0, antiRinging: 0,
});

export class QualityEngine {
  analyze(imageData) {
    return analyzeQualityFrame(imageData);
  }

  smartPlan(metrics, mode = 'natural') {
    return buildSmartEnhancePlan(metrics, mode);
  }

  resolve(legacyEffects = {}, qualityLab = null) {
    return resolveQualityEffects(legacyEffects, qualityLab);
  }

  adaptToScene(effects, metrics, enabled = true) {
    return enabled ? adaptEffectsToScene(effects, metrics) : effects;
  }

  inspectSettings(effects) {
    return inspectQualityRisks(effects);
  }
}

export function resolveQualityEffects(legacyEffects = {}, qualityLab = null) {
  if (!qualityLab?.stages) return { ...NEUTRAL_EFFECTS, ...legacyEffects };
  const stages = qualityLab.stages;
  const value = (name, fallback = STAGE_DEFAULTS[name] || 0) => {
    const stage = stages[name];
    if (!stage) return fallback;
    return stage.enabled === false ? 0 : clamp(Number(stage.strength ?? fallback), 0, 2);
  };
  return {
    ...NEUTRAL_EFFECTS,
    ...legacyEffects,
    denoiseAmount: value('denoise', legacyEffects.denoiseAmount),
    temporalDenoise: value('temporalDenoise', legacyEffects.temporalDenoise),
    deblockAmount: value('deblock'),
    debandAmount: value('deband'),
    artifactRemoval: value('artifactRemoval'),
    chromaDenoise: value('chromaDenoise'),
    mosquitoNoise: value('mosquitoNoise'),
    compressionRecovery: value('compressionRecovery'),
    detailFusion: value('detailFusion'),
    detailAmount: value('detailRecovery', legacyEffects.detailAmount),
    fineDetailRecovery: value('fineDetailRecovery'),
    textureRecovery: value('textureRecovery'),
    microTexture: value('microTexture'),
    structureRecovery: value('structureRecovery'),
    edgeRecovery: value('edgeRecovery'),
    clarity: value('clarity'),
    localContrast: value('localContrast'),
    sharpenAmount: value('smartSharpen', legacyEffects.sharpenAmount),
    dehalo: value('dehalo'),
    antiRinging: value('antiRinging'),
    antiFlicker: value('antiFlicker', legacyEffects.antiFlicker),
    temporalDetailStability: value('temporalDetailStability'),
  };
}

/** Cleanup runs before AI; reconstruction/detail/color/finish run after AI and Blur. */
export function splitEffectsForPipeline(effects = {}) {
  const cleanup = { ...NEUTRAL_EFFECTS };
  const finish = { ...NEUTRAL_EFFECTS };
  const temporal = {};
  for (const [key, value] of Object.entries({ ...NEUTRAL_EFFECTS, ...effects })) {
    if (PRE_EFFECT_KEYS.has(key)) cleanup[key] = value;
    else if (TEMPORAL_KEYS.has(key)) temporal[key] = value;
    else finish[key] = value;
  }
  return { cleanup, temporal, finish };
}

export function analyzeQualityFrame(imageData) {
  if (!imageData?.data?.length || !(imageData.width > 2) || !(imageData.height > 2)) throw new TypeError('Quality analysis requires ImageData');
  const { data, width, height } = imageData;
  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 120_000)));
  let count = 0, sum = 0, square = 0, noise = 0, detail = 0, blocks = 0, flat = 0, clippedBlack = 0, clippedWhite = 0, saturation = 0;
  for (let y = 1; y < height - 1; y += step) for (let x = 1; x < width - 1; x += step) {
    const index = (y * width + x) * 4;
    const center = lumaAt(data, index), left = lumaAt(data, index - 4), right = lumaAt(data, index + 4), top = lumaAt(data, index - width * 4), bottom = lumaAt(data, index + width * 4);
    const gradient = Math.abs(right - left) + Math.abs(bottom - top);
    const laplacian = Math.abs(center * 4 - left - right - top - bottom);
    const maximum = Math.max(data[index], data[index + 1], data[index + 2]);
    const minimum = Math.min(data[index], data[index + 1], data[index + 2]);
    sum += center; square += center * center; detail += gradient;
    if (gradient < 20) noise += laplacian;
    if (gradient < 3) flat++;
    if ((x % 8 <= 1 || y % 8 <= 1) && gradient > 12) blocks += gradient;
    if (center <= 4) clippedBlack++;
    if (center >= 251) clippedWhite++;
    saturation += maximum ? (maximum - minimum) / maximum : 0;
    count++;
  }
  const mean = sum / Math.max(1, count), deviation = Math.sqrt(Math.max(0, square / Math.max(1, count) - mean * mean));
  return {
    exposure: mean / 255,
    contrast: clamp(deviation / 86, 0, 1.5),
    noise: clamp(noise / Math.max(1, count) / 20, 0, 1),
    detail: clamp(detail / Math.max(1, count) / 68, 0, 1),
    blocking: clamp(blocks / Math.max(1, count) / 34, 0, 1),
    banding: clamp((flat / Math.max(1, count) - 0.38) / 0.5, 0, 1),
    clippedShadows: clippedBlack / Math.max(1, count),
    clippedHighlights: clippedWhite / Math.max(1, count),
    saturation: saturation / Math.max(1, count),
  };
}

export function mergeQualityMetrics(samples) {
  if (!samples?.length) throw new Error('At least one quality sample is required');
  const keys = Object.keys(samples[0]);
  return Object.fromEntries(keys.map((key) => {
    const values = samples.map((sample) => Number(sample[key]) || 0).sort((a, b) => a - b);
    return [key, values[Math.floor(values.length / 2)]];
  }));
}

export function buildSmartEnhancePlan(metrics, mode = 'natural') {
  const scale = ({ natural: 0.78, strong: 1, ultra: 1.24 })[mode] || 0.78;
  const stage = (enabled, strength) => ({ enabled: Boolean(enabled), strength: round(clamp(strength * scale, 0, 1.35)) });
  const compressed = metrics.blocking > 0.12;
  const noisy = metrics.noise > 0.16;
  const soft = metrics.detail < 0.48;
  const verySoft = metrics.detail < 0.3;
  const banded = metrics.banding > 0.2;
  return {
    mode,
    stages: {
      denoise: stage(noisy, 0.18 + metrics.noise * 0.55),
      temporalDenoise: stage(noisy, 0.14 + metrics.noise * 0.38),
      deblock: stage(compressed, 0.2 + metrics.blocking * 0.62),
      deband: stage(banded, 0.14 + metrics.banding * 0.42),
      artifactRemoval: stage(compressed, 0.18 + metrics.blocking * 0.5),
      chromaDenoise: stage(noisy, 0.12 + metrics.noise * 0.42),
      mosquitoNoise: stage(compressed, 0.16 + metrics.blocking * 0.44),
      compressionRecovery: stage(compressed, 0.20 + metrics.blocking * 0.58),
      detailFusion: stage(soft && !noisy, 0.14 + (1 - metrics.detail) * 0.38),
      detailRecovery: stage(soft || compressed, 0.16 + (1 - metrics.detail) * 0.55),
      fineDetailRecovery: stage(verySoft, 0.12 + (0.35 - metrics.detail) * 0.65),
      textureRecovery: stage(soft && !noisy, 0.12 + (1 - metrics.detail) * 0.34),
      microTexture: stage(soft && !noisy, 0.10 + (1 - metrics.detail) * 0.26),
      structureRecovery: stage(soft || compressed, 0.12 + (1 - metrics.detail) * 0.28),
      edgeRecovery: stage(soft, 0.14 + (1 - metrics.detail) * 0.38),
      clarity: stage(soft && metrics.contrast < 0.8, 0.12 + (0.8 - metrics.contrast) * 0.25),
      localContrast: stage(metrics.contrast < 0.68, 0.1 + (0.68 - metrics.contrast) * 0.3),
      smartSharpen: stage(soft, noisy ? 0.28 : 0.42 + (1 - metrics.detail) * 0.25),
      dehalo: stage(soft && mode !== 'natural', 0.14),
      antiRinging: stage(compressed || mode === 'ultra', 0.18 + metrics.blocking * 0.18),
      antiFlicker: stage(true, 0.1),
      temporalDetailStability: stage(soft || compressed, 0.16 + metrics.blocking * 0.25),
    },
    summary: smartSummary({ compressed, noisy, soft, banded }),
  };
}

export function adaptEffectsToScene(base, metrics) {
  const effects = { ...base };
  const noiseGate = clamp(1 - metrics.noise * 0.72, 0.42, 1);
  const softness = clamp((0.62 - metrics.detail) / 0.62, 0, 1);
  if (effects.denoiseAmount > 0) effects.denoiseAmount *= clamp(0.52 + metrics.noise * 1.25, 0.45, 1.2);
  if (effects.deblockAmount > 0) effects.deblockAmount *= clamp(0.55 + metrics.blocking * 1.35, 0.5, 1.25);
  if (effects.debandAmount > 0) effects.debandAmount *= clamp(0.55 + metrics.banding, 0.5, 1.2);
  for (const key of ['sharpenAmount', 'fineDetailRecovery', 'textureRecovery', 'microTexture', 'structureRecovery', 'edgeRecovery', 'detailFusion']) {
    if (effects[key] > 0) effects[key] *= noiseGate * (0.65 + softness * 0.5);
  }
  return effects;
}

export function inspectQualityRisks(effects = {}) {
  const warnings = [];
  const sharpenLoad = (effects.sharpenAmount || 0) + (effects.fineDetailRecovery || 0) * 0.7 + (effects.edgeRecovery || 0) * 0.5 + (effects.highPassAmount || 0) * 0.6;
  if (sharpenLoad > 1.65 && !(effects.dehalo > 0 || effects.antiRinging > 0)) warnings.push('HALO_RISK');
  if ((effects.denoiseAmount || 0) > 0.78 && (effects.textureRecovery || 0) < 0.1) warnings.push('PLASTIC_TEXTURE_RISK');
  if ((effects.saturation || 1) > 1.55 || (effects.vibrance || 0) > 0.75) warnings.push('SATURATION_RISK');
  if ((effects.exposure || 0) > 1.2 || (effects.whites || 0) > 0.75) warnings.push('HIGHLIGHT_CLIP_RISK');
  if ((effects.blacks || 0) < -0.75 || (effects.contrast || 1) > 1.55) warnings.push('CRUSHED_BLACK_RISK');
  return warnings;
}

/** Detects catastrophic RIFE frames without retaining full-resolution history. */
export class TemporalArtifactGuard {
  constructor({ width = 48, height = 27 } = {}) {
    this.canvas = makeCanvas(width, height);
    this.context = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.rejected = 0;
    this.checked = 0;
  }

  inspect(first, second, candidate) {
    const a = this._signature(first), b = this._signature(second), c = this._signature(candidate);
    const ab = signatureDifference(a.values, b.values);
    const ac = signatureDifference(a.values, c.values);
    const bc = signatureDifference(b.values, c.values);
    const catastrophic = c.clipped > 0.86
      || (ab < 0.35 && ac > Math.max(0.24, ab * 2.8 + 0.05) && bc > Math.max(0.24, ab * 2.8 + 0.05));
    this.checked++;
    if (catastrophic) this.rejected++;
    return { safe: !catastrophic, endpointDifference: ab, firstDifference: ac, secondDifference: bc, clipped: c.clipped };
  }

  _signature(source) {
    this.context.globalCompositeOperation = 'copy';
    this.context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    const pixels = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    const values = new Uint8Array(pixels.length / 4);
    let clipped = 0;
    for (let index = 0, out = 0; index < pixels.length; index += 4, out++) {
      const value = Math.round(lumaAt(pixels, index));
      values[out] = value;
      if (value <= 2 || value >= 253) clipped++;
    }
    return { values, clipped: clipped / values.length };
  }

  diagnostics() { return { checked: this.checked, rejected: this.rejected }; }
  destroy() { this.canvas.width = 1; this.canvas.height = 1; }
}

function smartSummary({ compressed, noisy, soft, banded }) {
  const items = [];
  if (compressed) items.push('compression cleanup');
  if (noisy) items.push('noise cleanup');
  if (soft) items.push('detail recovery');
  if (banded) items.push('deband');
  return items.length ? items.join(' · ') : 'clean source · conservative finish only';
}

function signatureDifference(first, second) {
  let total = 0;
  for (let index = 0; index < first.length; index++) total += Math.abs(first[index] - second[index]);
  return total / (first.length * 255);
}
function lumaAt(data, index) { return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)); }
function round(value) { return Math.round(value * 1000) / 1000; }
function makeCanvas(width, height) { if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }

export { STAGE_DEFAULTS, NEUTRAL_EFFECTS };
