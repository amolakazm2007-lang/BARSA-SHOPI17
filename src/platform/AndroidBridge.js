const CHUNK_BYTES = 512 * 1024;
const UI_PROGRESS_INTERVAL_MS = 100;
const YIELD_EVERY_BYTES = 8 * 1024 * 1024;

export class AndroidBridge {
  constructor(api = globalThis.BarsaAndroid) {
    this.api = api || null;
  }

  get available() { return Boolean(this.api && typeof this.api.getDeviceInfo === 'function'); }

  getDeviceInfo() {
    if (!this.available) return null;
    try { return JSON.parse(this.api.getDeviceInfo()); } catch { return null; }
  }

  getNativeAiInfo() {
    if (!this.available || typeof this.api.getNativeAiInfo !== 'function') return null;
    try { return JSON.parse(this.api.getNativeAiInfo()); } catch { return null; }
  }

  getThermalInfo() {
    if (!this.available || typeof this.api.getThermalInfo !== 'function') return null;
    try { return JSON.parse(this.api.getThermalInfo()); } catch { return null; }
  }

  runNativeAiSelfTest() {
    if (!this.available || typeof this.api.runNativeAiSelfTest !== 'function') return { passed: false, reason: 'native_ai_unavailable' };
    try { return JSON.parse(this.api.runNativeAiSelfTest()); } catch (error) { return { passed: false, error: error?.message || 'native_ai_parse_failed' }; }
  }

  releaseNativeAiMemory() {
    if (!this.available || typeof this.api.releaseNativeAiMemory !== 'function') return;
    try { this.api.releaseNativeAiMemory(); } catch {}
  }

  setKeepScreenOn(enabled) {
    if (!this.available || typeof this.api.setKeepScreenOn !== 'function') return;
    try { this.api.setKeepScreenOn(Boolean(enabled)); } catch {}
  }

  vibrate(ms = 30) {
    if (!this.available || typeof this.api.vibrate !== 'function') return;
    try { this.api.vibrate(Math.max(1, Math.min(500, Math.round(ms)))); } catch {}
  }

  async saveBlob(blob, fileName, { mimeType = 'video/mp4', onProgress = () => {}, sourceDateMs = 0 } = {}) {
    if (!this.available) throw new Error('Android native export bridge is not available');
    if (!(blob instanceof Blob) || !blob.size) throw new Error('Export blob is empty');
    const safeName = sanitizeFileName(fileName || `BARSA_${Date.now()}.mp4`);
    const exportId = String(this.api.beginExport(safeName, mimeType, String(blob.size), String(Math.max(0, Number(sourceDateMs) || 0))) || '');
    if (!exportId) throw new Error('Android refused to start export');
    let sent = 0, sequence = 0, lastProgressAt = 0, bytesSinceYield = 0;
    try {
      for (let start = 0; start < blob.size; start += CHUNK_BYTES) {
        const end = Math.min(blob.size, start + CHUNK_BYTES);
        const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
        const encoded = bytesToBase64(bytes);
        const ok = this.api.appendExportChunk(exportId, encoded, sequence++);
        if (ok !== true && ok !== 'true') throw new Error('Android export stream rejected a chunk');
        sent = end; bytesSinceYield += bytes.length;
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (now - lastProgressAt >= UI_PROGRESS_INTERVAL_MS || sent === blob.size) { onProgress(sent / blob.size); lastProgressAt = now; }
        if (bytesSinceYield >= YIELD_EVERY_BYTES) { bytesSinceYield = 0; await new Promise((resolve) => setTimeout(resolve, 0)); }
      }
      const uri = String(this.api.finishExport(exportId) || '');
      if (!uri) throw new Error('Android failed to publish MP4 to MediaStore');
      onProgress(1);
      return { uri, fileName: safeName, bytes: blob.size };
    } catch (error) {
      try { this.api.cancelExport(exportId); } catch {}
      throw error;
    }
  }
}

export function sanitizeFileName(name) {
  const clean = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  const withExt = /\.mp4$/i.test(clean) ? clean : `${clean}.mp4`;
  return withExt.slice(0, 120) || `BARSA_${Date.now()}.mp4`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}
