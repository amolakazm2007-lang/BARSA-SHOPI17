/**
 * Android native ONNX client using BARSA's localhost binary API.
 * Models and float tensors travel as raw bytes, never Base64.
 */
export class NativeAiClient {
  constructor({ api = globalThis.BarsaAndroid, origin = globalThis.location?.origin || '' } = {}) {
    this.api = api || null;
    this.origin = origin;
    try { this.token = String(this.api?.getNativeAiToken?.() || ''); } catch { this.token = ''; }
    this.registered = new Map();
    this.disabledModels = new Set();
  }

  get available() {
    if (!this.api || typeof this.api.getNativeAiInfo !== 'function') return false;
    try {
      const info = JSON.parse(this.api.getNativeAiInfo());
      return Boolean(info?.available && info?.binaryTileApi && this.token.length >= 16 && /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(this.origin));
    } catch { return false; }
  }

  _headers(extra = {}) { return { ...extra, 'X-Barsa-Token': this.token }; }

  async modelReady(modelId, { bytes = 0, sha256 = '' } = {}) {
    if (!this.available || this.disabledModels.has(modelId)) return false;
    const query = new URLSearchParams({ id: modelId, bytes: String(Math.max(0, Number(bytes) || 0)), sha: sha256 || '' });
    const response = await fetch(`${this.origin}/native-ai/model?${query}`, { cache: 'no-store', headers: this._headers() }).catch(() => null);
    if (!response?.ok) return false;
    const state = await response.json().catch(() => null);
    if (!state?.ready) return false;
    this.registered.set(modelId, `${Number(state.bytes) || Number(bytes) || 0}:${sha256 || ''}`);
    return true;
  }

  async ensureModelLazy(modelId, { bytes = 0, sha256 = '', load } = {}) {
    if (!this.available || this.disabledModels.has(modelId)) return false;
    if (await this.modelReady(modelId, { bytes, sha256 })) return true;
    if (typeof load !== 'function') throw new Error('Native model loader is required when Android cache is missing');
    const buffer = await load();
    return this.ensureModel(modelId, buffer, { sha256 });
  }

  async ensureModel(modelId, modelBody, { sha256 = '' } = {}) {
    if (!this.available || this.disabledModels.has(modelId)) return false;
    const isBlob = typeof Blob !== 'undefined' && modelBody instanceof Blob;
    const bytes = isBlob ? Number(modelBody.size || 0) : Number(modelBody?.byteLength || 0);
    if (!bytes) throw new Error('Native model registration received an empty model');
    const fingerprint = `${bytes}:${sha256 || ''}`;
    if (this.registered.get(modelId) === fingerprint) return true;
    const check = await fetch(`${this.origin}/native-ai/model?id=${encodeURIComponent(modelId)}&bytes=${bytes}&sha=${encodeURIComponent(sha256 || '')}`, { cache: 'no-store', headers: this._headers() }).catch(() => null);
    if (check?.ok) { const state = await check.json().catch(() => null); if (state?.ready) { this.registered.set(modelId, fingerprint); return true; } }
    // Pass OPFS File/Blob bodies directly to fetch so Chromium can stream large
    // ONNX weights to the localhost Android bridge without first duplicating
    // hundreds of MB into a JavaScript ArrayBuffer.
    const body = isBlob ? modelBody : modelBody;
    const response = await fetch(`${this.origin}/native-ai/register?id=${encodeURIComponent(modelId)}&sha=${encodeURIComponent(sha256 || '')}`, {
      method: 'POST', headers: this._headers({ 'Content-Type': 'application/octet-stream', 'X-Barsa-Model-Bytes': String(bytes) }), body,
    });
    if (!response.ok) throw new Error(`Native model registration failed (${response.status})`);
    const status = await response.json();
    if (!status?.registered) throw new Error('Android rejected native ONNX model registration');
    this.registered.set(modelId, fingerprint);
    return true;
  }

  async infer(modelId, input, { channels, width, height, scale = 1, fidelity = 0.5, signal = null } = {}) {
    if (!(input instanceof Float32Array)) throw new TypeError('Native AI input must be Float32Array');
    if (!this.available || this.disabledModels.has(modelId)) throw new Error('Native AI tile path unavailable');
    const params = new URLSearchParams({
      id: modelId,
      c: String(channels),
      w: String(width),
      h: String(height),
      scale: String(scale),
      fidelity: String(Math.max(0, Math.min(1, Number(fidelity) || 0))),
    });
    const body = input.byteOffset === 0 && input.byteLength === input.buffer.byteLength ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    const response = await fetch(`${this.origin}/native-ai/infer?${params}`, { method: 'POST', headers: this._headers({ 'Content-Type': 'application/octet-stream' }), body, signal });
    if (!response.ok) throw new Error(`Native AI inference failed (${response.status}): ${await response.text().catch(() => '')}`);
    const widthOut = Number(response.headers.get('X-Barsa-Width'));
    const heightOut = Number(response.headers.get('X-Barsa-Height'));
    const channelsOut = Number(response.headers.get('X-Barsa-Channels'));
    const provider = response.headers.get('X-Barsa-Provider') || 'android-native';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength % 4) throw new Error('Native AI returned an invalid float tensor');
    const data = new Float32Array(buffer);
    const expected = channelsOut * widthOut * heightOut;
    if (!widthOut || !heightOut || !channelsOut || data.length !== expected) throw new Error(`Native AI output mismatch: ${data.length} vs ${expected}`);
    return { data, width: widthOut, height: heightOut, channels: channelsOut, provider, native: true };
  }

  async inferRife(modelId, frame0, frame1, { width, height, timestep = 0.5, signal = null } = {}) {
    if (!(frame0 instanceof Float32Array) || !(frame1 instanceof Float32Array)) throw new TypeError('Native RIFE inputs must be Float32Array');
    if (!this.available || this.disabledModels.has(modelId)) throw new Error('Native RIFE path unavailable');
    const expected = 3 * width * height;
    if (frame0.length !== expected || frame1.length !== expected) throw new Error('Native RIFE tensor geometry mismatch');
    const body = new Float32Array(expected * 2); body.set(frame0, 0); body.set(frame1, expected);
    const params = new URLSearchParams({ id:modelId, w:String(width), h:String(height), t:String(Math.max(0, Math.min(1, Number(timestep) || 0.5))) });
    const response = await fetch(`${this.origin}/native-ai/rife?${params}`, { method:'POST', headers:this._headers({'Content-Type':'application/octet-stream'}), body:body.buffer, signal });
    if (!response.ok) throw new Error(`Native RIFE inference failed (${response.status}): ${await response.text().catch(()=> '')}`);
    const provider = response.headers.get('X-Barsa-Provider') || 'android-native';
    const widthOut = Number(response.headers.get('X-Barsa-Width')) || width;
    const heightOut = Number(response.headers.get('X-Barsa-Height')) || height;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength % 4) throw new Error('Native RIFE returned invalid tensor bytes');
    const data = new Float32Array(buffer);
    if (data.length !== 3 * widthOut * heightOut) throw new Error(`Native RIFE output mismatch: ${data.length}`);
    return { data, width:widthOut, height:heightOut, channels:3, provider, native:true };
  }

  async releaseSession(modelId) {
    if (!this.available || !modelId) return false;
    const response = await fetch(`${this.origin}/native-ai/session?id=${encodeURIComponent(modelId)}`, { method: 'DELETE', cache: 'no-store', headers: this._headers() }).catch(() => null);
    return Boolean(response?.ok);
  }

  disableModel(modelId) { this.disabledModels.add(modelId); }
  enableModel(modelId) { this.disabledModels.delete(modelId); }
}
