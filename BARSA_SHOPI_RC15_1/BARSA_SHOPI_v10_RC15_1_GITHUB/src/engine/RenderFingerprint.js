function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
}
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic non-cryptographic fallback is marked explicitly by prefix.
  let h = 2166136261;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619); }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Fingerprints only render semantics, excluding adaptive queue/preview knobs. */
export async function createQualityLockFingerprint({ settings = {}, width, height, fps, bitrate, models = {} } = {}) {
  const semantic = {
    width, height, fps, bitrate,
    models,
    upscaleModelId: settings.upscaleModelId || null,
    rifeModelId: settings.rifeModelId || null,
    faceModelId: settings.faceModelId || null,
    effects: settings.effects || null,
    colorLab: settings.colorLab || null,
    audioEnabled: settings.audioEnabled !== false,
    outputFormat: settings.outputFormat || 'mp4',
    qualityLocked: true,
  };
  const canonical = JSON.stringify(stable(semantic));
  return { algorithm: globalThis.crypto?.subtle ? 'SHA-256' : 'FNV1A-FALLBACK', hash: await sha256Hex(canonical), canonicalBytes: canonical.length };
}
