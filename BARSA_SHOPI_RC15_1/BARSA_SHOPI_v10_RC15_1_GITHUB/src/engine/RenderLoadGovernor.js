/**
 * v8.7 mobile long-render governor.
 * It never drops frames or lowers requested output resolution/FPS. Instead it
 * reduces concurrency and queue depth as pixel/AI load rises, trading speed
 * for bounded memory and deterministic frame delivery.
 */
export class RenderLoadGovernor {
  plan({ width, height, fps, aiUpscale = false, rife = false, face = false, deviceMemoryGB = null, deviceProfile = null } = {}) {
    const pixels = Math.max(1, Number(width) * Number(height));
    const rate = Math.max(1, Number(fps) || 30);
    const mp = pixels / 1_000_000;
    const aiWeight = (aiUpscale ? 2.4 : 0) + (rife ? 1.8 : 0) + (face ? 1.2 : 0);
    const load = mp * (rate / 30) * (1 + aiWeight);
    const lowMemory = deviceMemoryGB != null && Number(deviceMemoryGB) <= 4;
    const pocoF6 = /POCO[_ ]F6/i.test(String(deviceProfile?.id || deviceProfile?.label || ''));
    const extreme = pixels >= 3840 * 2160 || rate > 60 || load >= 20 || lowMemory;
    const heavy = extreme || pixels >= 2560 * 1440 || load >= 10;
    return Object.freeze({
      loadScore: Number(load.toFixed(2)),
      tier: extreme ? 'EXTREME' : heavy ? 'HEAVY' : 'NORMAL',
      codecQueue: extreme ? 1 : heavy ? 2 : 3,
      writeBacklog: extreme ? 1 : heavy ? 2 : 3,
      tileConcurrency: heavy ? 1 : 2,
      blurSamples: extreme ? 8 : heavy ? 12 : 24,
      // Checkpoints are durability boundaries, not per-frame telemetry. Writing
      // IndexedDB/OPFS metadata every 4 frames can dominate a 60/120fps mobile
      // render. Keep crash-loss bounded to roughly 0.5–1 second instead.
      checkpointEvery: Math.max(12, Math.round(rate * (extreme ? 0.5 : heavy ? 0.75 : 1))),
      yieldEvery: extreme ? 4 : heavy ? 6 : 10,
      sustainedMobile: Boolean(pocoF6 && (heavy || extreme)),
      thermalBias: pocoF6 && extreme ? 'SUSTAINED' : 'BALANCED',
    });
  }

  async yieldIfNeeded(frameIndex, plan, signal) {
    if (!plan || frameIndex <= 0 || frameIndex % plan.yieldEvery !== 0) return;
    if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
