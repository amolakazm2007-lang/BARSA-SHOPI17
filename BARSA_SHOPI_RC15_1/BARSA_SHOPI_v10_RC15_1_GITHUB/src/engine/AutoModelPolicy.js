export function evaluateExtendedModelDownload({
  expectedSizeBytes = 0,
  storage = null,
  connection = null,
  force = false,
} = {}) {
  if (force) return { allowed: true, reason: 'forced' };
  const saveData = Boolean(connection?.saveData);
  if (saveData) return { allowed: false, reason: 'data-saver' };
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  if (['slow-2g', '2g'].includes(effectiveType)) return { allowed: false, reason: 'slow-network' };
  if (storage?.quotaBytes != null && storage?.usageBytes != null && expectedSizeBytes > 0) {
    const free = Math.max(0, storage.quotaBytes - storage.usageBytes);
    const reserve = Math.max(256 * 1024 * 1024, Math.ceil(expectedSizeBytes * 0.25));
    if (free < expectedSizeBytes + reserve) return { allowed: false, reason: 'low-storage', freeBytes: free };
  }
  return { allowed: true, reason: 'ok' };
}

export function connectionSnapshot(navigatorLike = globalThis.navigator) {
  const connection = navigatorLike?.connection || navigatorLike?.mozConnection || navigatorLike?.webkitConnection || null;
  return connection ? {
    saveData: Boolean(connection.saveData),
    effectiveType: connection.effectiveType || null,
    downlink: Number.isFinite(connection.downlink) ? connection.downlink : null,
  } : null;
}
