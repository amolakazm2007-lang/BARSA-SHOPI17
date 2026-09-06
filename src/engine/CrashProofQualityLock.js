import { BarsaError } from './CrashProofRuntime.js';

export function assertFinalQualityLock(before, after) {
  const keys = ['width', 'height', 'fps', 'bitrate', 'expectedFrames'];
  const changed = keys.filter((key) => Number(before?.[key]) !== Number(after?.[key]));
  if (changed.length) {
    throw new BarsaError('QUALITY_LOCK_VIOLATION', `Crash recovery attempted to change final quality: ${changed.join(', ')}`, {
      recoverable: false,
      details: { before, after, changed },
    });
  }
  return true;
}

export function safeRecoveryPlan({ final, pressure = 'normal', queueDepth = 2, concurrency = 2, previewScale = 1 } = {}) {
  const severe = pressure === 'critical';
  const high = severe || pressure === 'high';
  return {
    final: { ...final },
    queueDepth: severe ? 1 : high ? Math.min(2, queueDepth) : queueDepth,
    concurrency: severe ? 1 : high ? 1 : concurrency,
    previewScale: severe ? Math.min(0.35, previewScale) : high ? Math.min(0.5, previewScale) : previewScale,
    qualityLocked: true,
  };
}
