import { withHardTimeout } from './CrashProofRuntime.js';

export function isOrtTimeout(error) {
  return error?.code === 'OPERATION_TIMEOUT' || error?.name === 'TimeoutError';
}

/**
 * Runs one ONNX inference behind a hard wall-clock timeout. A timed-out
 * session is invalidated and recreated for the SAME model, then retried once.
 * Model substitution is intentionally outside this helper and forbidden here.
 */
export async function runOrtInferenceWithRecovery({
  modelId,
  getSession,
  invalidateSession,
  run,
  timeoutMs = 30_000,
  label = 'ORT inference',
  signal = null,
  logger = console,
} = {}) {
  if (!modelId) throw new Error('runOrtInferenceWithRecovery requires modelId');
  if (typeof getSession !== 'function' || typeof invalidateSession !== 'function' || typeof run !== 'function') {
    throw new TypeError('runOrtInferenceWithRecovery requires getSession, invalidateSession, and run callbacks');
  }

  let session = await getSession(modelId);
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal?.aborted) throw signal.reason || new DOMException('ONNX inference cancelled', 'AbortError');
    try {
      return await withHardTimeout(() => run(session, attempt), {
        timeoutMs,
        label: `${label} attempt ${attempt}`,
        signal,
        onTimeout: () => invalidateSession(modelId, session, 'timeout'),
      });
    } catch (error) {
      lastError = error;
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      if (!isOrtTimeout(error) || attempt >= 2) throw error;
      try { await invalidateSession(modelId, session, 'timeout-recovery'); }
      catch (invalidateError) { logger.error?.('[BARSA][ORT][session-invalidate-failed]', { modelId, invalidateError }); }
      logger.warn?.('[BARSA][ORT][same-model-session-retry]', { modelId, attempt, error: error?.message || String(error) });
      session = await getSession(modelId);
    }
  }
  throw lastError || new Error(`${label} failed`);
}
