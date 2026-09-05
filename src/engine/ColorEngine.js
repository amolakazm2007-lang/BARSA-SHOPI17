const IDENTITY_CURVE = '0:0,1:1';

/** High-precision CPU color/LUT pass used only when Color Lab features need it. */
export class ColorEngine {
  constructor({ stripeRows = 128 } = {}) {
    this.stripeRows = stripeRows;
    this.activeLut = null;
    this.activeLutInfo = null;
    this.lastDiagnostics = null;
  }

  async importCube(file) {
    if (!(file instanceof Blob)) throw new TypeError('LUT import requires a .cube file');
    if (!/\.cube$/i.test(file.name || '')) throw new Error('Only .cube LUT files are supported');
    if (!file.size || file.size > 16 * 1024 * 1024) throw new Error('LUT file is empty or exceeds the 16 MB safety limit');
    const text = await file.text();
    const lut = parseCubeLUT(text);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    this.activeLut = lut;
    this.activeLutInfo = {
      name: file.name,
      title: lut.title || file.name.replace(/\.cube$/i, ''),
      type: lut.type,
      size: lut.size,
      sha256: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''),
      importedAt: Date.now(),
    };
    return { ...this.activeLutInfo };
  }

  clearLut() {
    this.activeLut = null;
    this.activeLutInfo = null;
  }

  isLutReady(expectedHash = null) {
    return Boolean(this.activeLut && (!expectedHash || this.activeLutInfo?.sha256 === expectedHash));
  }

  needsPass(settings = {}) {
    if (settings.enabled === false) return false;
    const curves = settings.curves || {};
    return Boolean(
      Math.abs(Number(settings.tint) || 0) > 1e-4
      || Math.abs(Number(settings.lift) || 0) > 1e-4
      || Math.abs((Number(settings.colorGamma) || 1) - 1) > 1e-4
      || Math.abs((Number(settings.gain) || 1) - 1) > 1e-4
      || Math.abs(Number(settings.offset) || 0) > 1e-4
      || Math.abs(Number(settings.hueRotate) || 0) > 1e-4
      || Math.abs((Number(settings.shadowSat) || 1) - 1) > 1e-4
      || Math.abs((Number(settings.midSat) || 1) - 1) > 1e-4
      || Math.abs((Number(settings.highlightSat) || 1) - 1) > 1e-4
      || Math.abs((Number(settings.redSat) || 1) - 1) > 1e-4
      || Math.abs((Number(settings.greenSat) || 1) - 1) > 1e-4
      || Math.abs((Number(settings.blueSat) || 1) - 1) > 1e-4
      || !isIdentityMixer(settings.rgbMixer)
      || Object.values(curves).some((value) => value && normalizeCurveText(value) !== IDENTITY_CURVE)
      || (Number(settings.lutStrength) > 0 && this.activeLut),
    );
  }

  /** Serializable compiled payload for the background CPU fallback worker. */
  compileForWorker(settings = {}) {
    if (!this.needsPass(settings)) return null;
    if (Number(settings.lutStrength) > 0 && settings.lutHash && !this.isLutReady(settings.lutHash)) {
      throw new Error('The selected LUT is no longer loaded; import the same .cube file again');
    }
    return compileColorSettings(settings, this.activeLut);
  }

  /** Mutates an output canvas in bounded stripes; no full-frame float copy. */
  async applyToCanvas(canvas, context, settings = {}, { signal = null } = {}) {
    if (!this.needsPass(settings)) return { applied: false, lut: null, stripes: 0 };
    if (Number(settings.lutStrength) > 0 && settings.lutHash && !this.isLutReady(settings.lutHash)) {
      throw new Error('The selected LUT is no longer loaded; import the same .cube file again');
    }
    const compiled = compileColorSettings(settings, this.activeLut);
    let stripes = 0;
    for (let y = 0; y < canvas.height; y += this.stripeRows) {
      abortIfNeeded(signal);
      const rows = Math.min(this.stripeRows, canvas.height - y);
      const image = context.getImageData(0, y, canvas.width, rows, { colorSpace: 'srgb' });
      applyColorToImageData(image, compiled);
      context.putImageData(image, 0, y);
      stripes++;
      await Promise.resolve();
    }
    this.lastDiagnostics = {
      applied: true,
      stripes,
      precision: 'float32-intermediate',
      colorSpace: 'BT.709/sRGB SDR',
      lut: compiled.lut ? { ...this.activeLutInfo, strength: compiled.lutStrength } : null,
      curves: compiled.curvesActive,
    };
    return this.lastDiagnostics;
  }

  diagnostics() {
    return this.lastDiagnostics || { applied: false, lut: this.activeLutInfo ? { ...this.activeLutInfo } : null };
  }

  destroy() {
    this.clearLut();
    this.lastDiagnostics = null;
  }
}

export function parseCubeLUT(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('LUT file is empty');
  let title = null;
  let size = null;
  let type = null;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    const upper = keyword.toUpperCase();
    if (upper === 'TITLE') {
      title = line.slice(keyword.length).trim().replace(/^"|"$/g, '');
    } else if (upper === 'LUT_3D_SIZE' || upper === 'LUT_1D_SIZE') {
      if (size != null) throw new Error('LUT declares more than one size');
      size = Number(rest[0]);
      type = upper === 'LUT_3D_SIZE' ? '3d' : '1d';
      if (!Number.isInteger(size) || size < 2 || size > (type === '3d' ? 65 : 65536)) throw new Error(`Unsupported ${upper} value`);
    } else if (upper === 'DOMAIN_MIN' || upper === 'DOMAIN_MAX') {
      const parsed = rest.slice(0, 3).map(Number);
      if (parsed.length !== 3 || !parsed.every(Number.isFinite)) throw new Error(`Invalid ${upper}`);
      if (upper === 'DOMAIN_MIN') domainMin = parsed;
      else domainMax = parsed;
    } else if (/^[+-]?(?:\d|\.\d)/.test(keyword)) {
      const row = [keyword, ...rest].slice(0, 3).map(Number);
      if (row.length !== 3 || !row.every(Number.isFinite)) throw new Error('LUT contains an invalid color row');
      values.push(...row);
    }
  }
  if (!size || !type) throw new Error('LUT_3D_SIZE or LUT_1D_SIZE is required');
  const expected = type === '3d' ? size ** 3 * 3 : size * 3;
  if (values.length !== expected) throw new Error(`LUT contains ${values.length / 3} rows; expected ${expected / 3}`);
  for (let channel = 0; channel < 3; channel++) {
    if (!(domainMax[channel] > domainMin[channel])) throw new Error('LUT DOMAIN_MAX must be greater than DOMAIN_MIN');
  }
  return { title, type, size, domainMin, domainMax, data: new Float32Array(values) };
}

export function parseCurve(value = IDENTITY_CURVE) {
  const points = String(value).split(',').map((part) => {
    const [x, y] = part.trim().split(':').map(Number);
    return { x, y };
  });
  if (points.length < 2 || points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)) {
    throw new Error('Curve points must use x:y pairs between 0 and 1');
  }
  points.sort((a, b) => a.x - b.x);
  if (points[0].x !== 0 || points.at(-1).x !== 1) throw new Error('Curve must start at x=0 and end at x=1');
  for (let index = 1; index < points.length; index++) if (points[index].x <= points[index - 1].x) throw new Error('Curve x values must be unique and increasing');
  return points;
}

export function buildCurveTable(value = IDENTITY_CURVE, entries = 4096) {
  const points = Array.isArray(value) ? value : parseCurve(value);
  const table = new Float32Array(entries);
  let segment = 0;
  for (let index = 0; index < entries; index++) {
    const x = index / (entries - 1);
    while (segment < points.length - 2 && x > points[segment + 1].x) segment++;
    const first = points[segment], second = points[segment + 1];
    const amount = (x - first.x) / Math.max(1e-8, second.x - first.x);
    table[index] = clamp01(first.y + (second.y - first.y) * amount);
  }
  return table;
}

export function compileColorSettings(settings = {}, lut = null) {
  const curves = settings.curves || {};
  const curveTexts = {
    luma: normalizeCurveText(curves.luma),
    red: normalizeCurveText(curves.red),
    green: normalizeCurveText(curves.green),
    blue: normalizeCurveText(curves.blue),
  };
  return {
    tint: clamp(Number(settings.tint) || 0, -1, 1),
    lift: clamp(Number(settings.lift) || 0, -0.5, 0.5),
    gamma: clamp(Number(settings.colorGamma) || 1, 0.1, 3),
    gain: clamp(Number(settings.gain) || 1, 0.1, 3),
    offset: clamp(Number(settings.offset) || 0, -0.5, 0.5),
    hueRotate: clamp(Number(settings.hueRotate) || 0, -180, 180),
    shadowSat: clamp(Number(settings.shadowSat) || 1, 0, 2.5),
    midSat: clamp(Number(settings.midSat) || 1, 0, 2.5),
    highlightSat: clamp(Number(settings.highlightSat) || 1, 0, 2.5),
    redSat: clamp(Number(settings.redSat) || 1, 0, 2.5),
    greenSat: clamp(Number(settings.greenSat) || 1, 0, 2.5),
    blueSat: clamp(Number(settings.blueSat) || 1, 0, 2.5),
    rgbMixer: normalizeMixer(settings.rgbMixer),
    curveTables: Object.fromEntries(Object.entries(curveTexts).map(([key, value]) => [key, buildCurveTable(value)])),
    curvesActive: Object.values(curveTexts).some((value) => value !== IDENTITY_CURVE),
    lut: Number(settings.lutStrength) > 0 ? lut : null,
    lutStrength: clamp((Number(settings.lutStrength) || 0) / 100, 0, 1),
  };
}

export function applyColorToImageData(imageData, compiled) {
  const { data } = imageData;
  const tint = compiled.tint * 0.055;
  const inverseGamma = 1 / compiled.gamma;
  for (let index = 0; index < data.length; index += 4) {
    let r = data[index] / 255;
    let g = data[index + 1] / 255;
    let b = data[index + 2] / 255;
    r = Math.pow(clamp01(r + compiled.lift + tint * 0.45), inverseGamma) * compiled.gain;
    g = Math.pow(clamp01(g + compiled.lift - tint), inverseGamma) * compiled.gain;
    b = Math.pow(clamp01(b + compiled.lift + tint * 0.45), inverseGamma) * compiled.gain;
    r = clamp01(r + compiled.offset); g = clamp01(g + compiled.offset); b = clamp01(b + compiled.offset);

    if (Math.abs(compiled.hueRotate) > 1e-4 || compiled.shadowSat !== 1 || compiled.midSat !== 1 || compiled.highlightSat !== 1 || compiled.redSat !== 1 || compiled.greenSat !== 1 || compiled.blueSat !== 1) {
      let hsv = rgbToHsv(r,g,b);
      hsv[0] = (hsv[0] + compiled.hueRotate / 360 + 1) % 1;
      const lum = luma(r,g,b);
      const shadowW = smoothBand(lum, 0.0, 0.0, 0.45);
      const midW = smoothBand(lum, 0.15, 0.5, 0.85);
      const highW = smoothBand(lum, 0.55, 1.0, 1.0);
      let satMul = compiled.shadowSat * shadowW + compiled.midSat * midW + compiled.highlightSat * highW;
      const totalW = Math.max(1e-6, shadowW + midW + highW); satMul /= totalW;
      const h = hsv[0];
      const redW = hueWeight(h,0), greenW = hueWeight(h,1/3), blueW = hueWeight(h,2/3);
      const hueMul = (compiled.redSat*redW + compiled.greenSat*greenW + compiled.blueSat*blueW) / Math.max(1e-6, redW+greenW+blueW);
      hsv[1] = clamp01(hsv[1] * satMul * hueMul);
      [r,g,b] = hsvToRgb(hsv[0],hsv[1],hsv[2]);
    }

    if (compiled.rgbMixer) {
      const m = compiled.rgbMixer, rr = r, gg = g, bb = b;
      r = rr * m[0] + gg * m[1] + bb * m[2];
      g = rr * m[3] + gg * m[4] + bb * m[5];
      b = rr * m[6] + gg * m[7] + bb * m[8];
    }

    const beforeLuma = luma(r, g, b);
    const afterLuma = sampleTable(compiled.curveTables.luma, beforeLuma);
    const lumaDelta = afterLuma - beforeLuma;
    r = sampleTable(compiled.curveTables.red, clamp01(r + lumaDelta));
    g = sampleTable(compiled.curveTables.green, clamp01(g + lumaDelta));
    b = sampleTable(compiled.curveTables.blue, clamp01(b + lumaDelta));

    if (compiled.lut && compiled.lutStrength > 0) {
      const mapped = sampleCubeLUT(compiled.lut, r, g, b);
      r += (mapped[0] - r) * compiled.lutStrength;
      g += (mapped[1] - g) * compiled.lutStrength;
      b += (mapped[2] - b) * compiled.lutStrength;
    }
    data[index] = byte(r * 255);
    data[index + 1] = byte(g * 255);
    data[index + 2] = byte(b * 255);
  }
  return imageData;
}



function rgbToHsv(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;if(h<0)h+=1;}return[h,max?d/max:0,max];}
function hsvToRgb(h,s,v){const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);switch(i%6){case 0:return[v,t,p];case 1:return[q,v,p];case 2:return[p,v,t];case 3:return[p,q,v];case 4:return[t,p,v];default:return[v,p,q];}}
function hueWeight(h,center){let d=Math.abs(h-center);d=Math.min(d,1-d);return Math.max(0,1-d/0.34);}
function smoothBand(x,left,center,right){if(center===left&&x<=center)return 1;if(center===right&&x>=center)return 1;if(x<center)return clamp01((x-left)/Math.max(1e-6,center-left));return clamp01((right-x)/Math.max(1e-6,right-center));}

function normalizeMixer(value) {
  const v = value || {};
  const matrix = [
    num(v.rr, 1), num(v.rg, 0), num(v.rb, 0),
    num(v.gr, 0), num(v.gg, 1), num(v.gb, 0),
    num(v.br, 0), num(v.bg, 0), num(v.bb, 1),
  ].map((x, i) => clamp(x, i in {0:1,4:1,8:1} ? 0 : -1.5, 2.5));
  return matrix;
}
function isIdentityMixer(value) {
  const m = normalizeMixer(value), id = [1,0,0,0,1,0,0,0,1];
  return m.every((v,i)=>Math.abs(v-id[i])<1e-4);
}
function num(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
export function sampleCubeLUT(lut, r, g, b) {
  const normalized = [r, g, b].map((value, channel) => clamp01((value - lut.domainMin[channel]) / (lut.domainMax[channel] - lut.domainMin[channel])));
  if (lut.type === '1d') return normalized.map((value, channel) => sample1D(lut, channel, value));
  const scale = lut.size - 1;
  const position = normalized.map((value) => value * scale);
  const low = position.map(Math.floor);
  const high = low.map((value) => Math.min(lut.size - 1, value + 1));
  const mix = position.map((value, channel) => value - low[channel]);
  const output = [0, 0, 0];
  for (let bz = 0; bz < 2; bz++) for (let gy = 0; gy < 2; gy++) for (let rx = 0; rx < 2; rx++) {
    const redIndex = rx ? high[0] : low[0], greenIndex = gy ? high[1] : low[1], blueIndex = bz ? high[2] : low[2];
    const weight = (rx ? mix[0] : 1 - mix[0]) * (gy ? mix[1] : 1 - mix[1]) * (bz ? mix[2] : 1 - mix[2]);
    const offset = ((blueIndex * lut.size + greenIndex) * lut.size + redIndex) * 3;
    for (let channel = 0; channel < 3; channel++) output[channel] += lut.data[offset + channel] * weight;
  }
  return output.map(clamp01);
}

function sample1D(lut, channel, value) {
  const position = value * (lut.size - 1), low = Math.floor(position), high = Math.min(lut.size - 1, low + 1), amount = position - low;
  return clamp01(lut.data[low * 3 + channel] + (lut.data[high * 3 + channel] - lut.data[low * 3 + channel]) * amount);
}

function sampleTable(table, value) {
  const position = clamp01(value) * (table.length - 1), low = Math.floor(position), high = Math.min(table.length - 1, low + 1), amount = position - low;
  return table[low] + (table[high] - table[low]) * amount;
}

function normalizeCurveText(value) {
  if (!value) return IDENTITY_CURVE;
  const points = parseCurve(value);
  return points.map(({ x, y }) => `${compact(x)}:${compact(y)}`).join(',');
}

function compact(value) { return Number(value.toFixed(5)).toString(); }
function luma(r, g, b) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }
function byte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function abortIfNeeded(signal) { if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError'); }

export { IDENTITY_CURVE };
