import { BarsaError } from './CrashProofRuntime.js';

export const REQUIRED_CRASH_PROOF_PROOFS = Object.freeze([
  'hard-timeout',
  'graphics-fallback',
  'webgl-context-loss',
  'webgpu-device-loss',
  'worker-crash',
  'worker-messageerror',
  'worker-hang-timeout',
  'periodic-resume-integrity',
  'quality-lock',
  'end-to-end-render',
  'android-coldstart-3x',
  'android-logcat-clean',
]);

export function evaluateCrashProofRelease(proofs = {}) {
  const missing = REQUIRED_CRASH_PROOF_PROOFS.filter((name) => proofs[name] !== true);
  if (missing.length) {
    throw new BarsaError('CRASH_PROOF_GATE_FAILED', `Crash-proof release evidence missing: ${missing.join(', ')}`, {
      recoverable: false,
      details: { missing, proofs },
    });
  }
  return { ok: true, proofs: REQUIRED_CRASH_PROOF_PROOFS.slice() };
}
